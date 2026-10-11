import semver from "semver";
import type {
  SiteLatestReleaseStatus,
  SiteNewerReleaseRoute,
  SiteUpdatePullRequest,
  SiteVersionInfo,
  SiteVersionSpecKind,
} from "@stagecraft/shared";

import type { GitHubRepoClient, OpenPullRequest, PullRequestResult } from "@/lib/integrations/github";
import { availableUpgradeVersion } from "@/lib/jobs/queue-upgrade";
import { MUSICIAN_SITE_PACKAGE, TEMPLATE_STAMP_PATH } from "@/lib/site-scaffold";
import {
  isOnOrPastRelease,
  isVersionSpec,
  NPM_REGISTRY,
  packageJsonChangedBeyondVersions,
  packageMetadataUrl,
  pinnedPackageVersion,
  readStamp,
  UPGRADE_BRANCH,
} from "@/lib/site-upgrade";

/**
 * The release a site is on, the one "Upgrade site" would move it to, and the
 * latest one on npm, for the site page ("on 1.2.0, latest 1.4.1"), and the
 * open pull request that would update it (ADR-016 Consequences).
 */

/**
 * The branch of a Dependabot npm bump of the package, in the repo's root or
 * a subdirectory: `dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1`.
 * The version right after the name keeps out lookalikes such as
 * `musician-site-shell`, and is the release the bump moves the site to.
 */
const DEPENDABOT_BUMP_BRANCH = new RegExp(`^dependabot/npm_and_yarn/(?:.+/)?${MUSICIAN_SITE_PACKAGE.slice(1)}-(\\d\\S*)`);

/** npm's `latest` release of the package, or why there isn't one. */
export interface LatestRelease {
  status: SiteLatestReleaseStatus;
  version: string | null;
}

/**
 * npm's `latest` release of the package: `not_published` when the registry
 * has no such package (a 404, before the first publish). Throws when the
 * registry can't be read or doesn't name a version.
 */
export async function fetchLatestPackageVersion(
  { fetchImpl = fetch, registry = NPM_REGISTRY }: { fetchImpl?: typeof fetch; registry?: string } = {},
): Promise<LatestRelease> {
  const url = packageMetadataUrl("latest", registry);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return { status: "not_published", version: null };
  if (!res.ok) throw new Error(`Reading ${MUSICIAN_SITE_PACKAGE}@latest from ${url} failed with HTTP ${res.status}`);
  const manifest = (await res.json()) as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error(`${url} names no version`);
  return { status: "published", version: manifest.version };
}

/**
 * Whether a pull request is Dependabot bumping the package, by its branch.
 * Titles aren't read: a single bump's branch names the package, and a
 * grouped update's title ("Bump the npm_and_yarn group with 2 updates")
 * doesn't, nor does the generated `dependabot.yml` define any groups.
 */
export function isDependabotBump(pull: Pick<OpenPullRequest, "headRef">): boolean {
  return DEPENDABOT_BUMP_BRANCH.test(pull.headRef);
}

/**
 * The release a Dependabot bump of the package moves the site to, from its
 * branch, or null when the branch names no valid release.
 */
export function dependabotBumpVersion(pull: Pick<OpenPullRequest, "headRef">): string | null {
  const version = DEPENDABOT_BUMP_BRANCH.exec(pull.headRef)?.[1];
  return version === undefined ? null : semver.valid(version);
}

/**
 * The open pull request that updates the package, the platform's upgrade
 * first, and whether merging it moves the site onto `target` or later. A
 * Dependabot bump only does when its release is `target` or later: it
 * never crosses a major (ADR-016 §3), and a bump whose build gate failed
 * stays open while the platform's release moves on.
 */
export function findUpdatePullRequest(
  upgrade: PullRequestResult | null,
  pulls: readonly OpenPullRequest[],
  target: string | null,
): SiteUpdatePullRequest | null {
  if (upgrade) return { number: upgrade.number, url: upgrade.htmlUrl, kind: "upgrade", reachesTarget: true };
  const bump = pulls.find(isDependabotBump);
  if (!bump) return null;
  const version = dependabotBumpVersion(bump);
  const reachesTarget = version !== null && target !== null && semver.valid(target) !== null && semver.gte(version, target);
  return { number: bump.number, url: bump.htmlUrl, kind: "dependabot", reachesTarget };
}

/**
 * What kind of spec a version is, for how the page words it. A spec the
 * upgrade doesn't read as a version or range (`isVersionSpec`) is `other`,
 * even where npm would take it as one (`x`, `X`, `x.x` for any release).
 */
export function versionSpecKind(spec: string): SiteVersionSpecKind {
  if (!isVersionSpec(spec)) return "other";
  if (semver.valid(spec) !== null) return "version";
  const range = semver.validRange(spec);
  if (range === "*") return "any";
  return range === null ? "other" : "range";
}

/** Whether `latest` is a stable release past `target` (any stable release when there's no target). */
function isPastTarget(latest: string, target: string | null): boolean {
  if (semver.valid(latest) === null || semver.prerelease(latest) !== null) return false;
  if (target === null) return true;
  return semver.valid(target) !== null && semver.gt(latest, target);
}

/**
 * Whether upgrade_site would stop on the site with `customized` because of
 * its package.json alone. Every site on the package has a stamp manifest
 * (or a template push) whose package.json names the package at an exact
 * release, and `changedCodeFiles` counts a package.json that no longer
 * names it there, or names it by a spec that isn't a version or range
 * (`isVersionSpec`: a dist-tag, a git, file or URL spec), as a
 * customization. A full copy of the template (no package.json pin and no
 * stamp release) never named it, so it isn't one.
 *
 * With the manifest's package.json (`baselinePackageJson`) in hand, any
 * other change but dependency versions counts too, by the job's own
 * `packageJsonChangedBeyondVersions`. Without it (a stamp from before the
 * manifest, measured from the template push in the repo's history), and
 * for every other file of ours, the page can't see what the job would.
 */
function needsHandUpgrade(
  pinned: string | null,
  stamped: string | null,
  packageJson: string | null,
  baselinePackageJson: string | null,
): boolean {
  if (pinned === null ? stamped !== null : !isVersionSpec(pinned)) return true;
  return packageJson !== null && baselinePackageJson !== null && packageJsonChangedBeyondVersions(baselinePackageJson, packageJson);
}

/** The major release a site is on: the lowest its pin admits. */
function pinnedMajor(pinned: string | null): number | null {
  const range = pinned === null ? null : semver.validRange(pinned);
  const floor = range === null ? null : semver.minVersion(range);
  return floor === null ? null : floor.major;
}

/**
 * Put together what the page shows. The site's package.json is read first:
 * Dependabot keeps it current, but never updates the stamp, whose
 * `packageVersion` is the release the site was created on. The stamp only
 * answers for a site whose package.json doesn't name the package (or is
 * missing or unreadable). A missing or unreadable stamp is no version.
 *
 * Whether an update is available is the upgrade job's own test, against its
 * own target (the platform's bundled release, `checkBaseline`), on a site
 * whose package.json the job would accept (`needsHandUpgrade`).
 *
 * A newer release on npm reaches the site through Dependabot when it's in
 * the major the site is on (or will be, after the upgrade on offer), since
 * sites take patch and minor releases that way; a new major waits for the
 * platform to bundle it (ADR-016 §3).
 */
export function siteVersionInfo(args: {
  packageJson: string | null;
  /** The package.json the stamp's manifest records, or null when it records none or there's no manifest. */
  baselinePackageJson?: string | null;
  stamp: string | null;
  target: string | null;
  latest: LatestRelease;
  upgradePull: PullRequestResult | null;
  pulls: readonly OpenPullRequest[];
}): SiteVersionInfo {
  const pinned = pinnedPackageVersion(args.packageJson);
  const stamped = pinned === null ? readStamp(args.stamp).packageVersion : null;
  const current = pinned ?? stamped;
  const latest = args.latest.status === "published" ? args.latest.version : null;
  const byHand = needsHandUpgrade(pinned, stamped, args.packageJson, args.baselinePackageJson ?? null);
  const updateAvailable = !byHand && args.target !== null && !isOnOrPastRelease(pinned, args.target);
  const newer = !byHand && latest !== null && isPastTarget(latest, args.target) && !isOnOrPastRelease(pinned, latest);
  const major = updateAvailable ? pinnedMajor(args.target) : pinnedMajor(pinned);
  const newerRelease: SiteNewerReleaseRoute | null = !newer
    ? null
    : major !== null && major === semver.major(latest!)
      ? "dependabot"
      : "platform";
  return {
    current,
    currentKind: current === null ? null : versionSpecKind(current),
    source: pinned !== null ? "package_json" : stamped !== null ? "stamp" : null,
    target: args.target,
    needsHandUpgrade: byHand,
    updateAvailable,
    latest,
    latestStatus: args.latest.status,
    newerRelease,
    pullRequest: findUpdatePullRequest(args.upgradePull, args.pulls, args.target),
  };
}

/**
 * Read a site's version from its repo's `branch`, the platform's bundle and
 * npm. npm being unreachable leaves `latest` unknown rather than failing the
 * read; GitHub errors are thrown. When the stamp has a manifest, the
 * package.json it records is read too, to tell other edits to package.json
 * from Dependabot's bumps as the job does. The upgrade pull request is
 * looked up by its branch, so it's found however many pull requests are
 * open; Dependabot bumps come from the first page of open ones, which its
 * `open-pull-requests-limit` of 5 keeps short.
 */
export async function readSiteVersion(
  client: GitHubRepoClient,
  branch: string,
  options: { fetchImpl?: typeof fetch; registry?: string; readTarget?: () => Promise<string | null> } = {},
): Promise<SiteVersionInfo> {
  const { readTarget = availableUpgradeVersion, ...npm } = options;
  const [packageJson, stamp, upgradePull, pulls, latest, target] = await Promise.all([
    client.getFileText("package.json", branch),
    client.getFileText(TEMPLATE_STAMP_PATH, branch),
    client.findOpenPullRequest(UPGRADE_BRANCH, branch),
    client.listOpenPullRequests(),
    fetchLatestPackageVersion(npm).catch((): LatestRelease => ({ status: "unreachable", version: null })),
    readTarget(),
  ]);
  const baselineSha = readStamp(stamp).manifest?.["package.json"];
  const baselinePackageJson = baselineSha ? await client.getBlobText(baselineSha) : null;
  return siteVersionInfo({ packageJson, baselinePackageJson, stamp, target, latest, upgradePull, pulls });
}
