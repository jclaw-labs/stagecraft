import type { SiteUpdatePullRequestKind, SiteVersionInfo } from "@stagecraft/shared";

import type { GitHubRepoClient, OpenPullRequest } from "@/lib/integrations/github";
import { MUSICIAN_SITE_PACKAGE, TEMPLATE_STAMP_PATH } from "@/lib/site-scaffold";
import { isOnOrPastRelease, NPM_REGISTRY, pinnedPackageVersion, readStamp, UPGRADE_BRANCH } from "@/lib/site-upgrade";

/**
 * The release a site is on and the latest one on npm, for the site page
 * ("on 1.2.0, latest 1.4.1"), and the open pull request that would update
 * it (ADR-016 Consequences).
 */

/** Branches Dependabot opens its npm update pull requests from. */
const DEPENDABOT_BRANCH_PREFIX = "dependabot/npm_and_yarn/";

/**
 * npm's `latest` release of the package. Throws when the registry can't be
 * read or doesn't name a version.
 */
export async function fetchLatestPackageVersion(
  { fetchImpl = fetch, registry = NPM_REGISTRY }: { fetchImpl?: typeof fetch; registry?: string } = {},
): Promise<string> {
  const url = `${registry}/${MUSICIAN_SITE_PACKAGE.replace("/", "%2f")}/latest`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Reading ${MUSICIAN_SITE_PACKAGE}@latest from ${url} failed with HTTP ${res.status}`);
  const manifest = (await res.json()) as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error(`${url} names no version`);
  return manifest.version;
}

/**
 * Which kind of update a pull request is, or null when it doesn't update
 * the package: the platform's upgrade branch, or a Dependabot bump of the
 * package (named in its branch, or in its title for a grouped update).
 */
export function updatePullRequestKind(pull: Pick<OpenPullRequest, "headRef" | "title">): SiteUpdatePullRequestKind | null {
  if (pull.headRef === UPGRADE_BRANCH) return "upgrade";
  if (
    pull.headRef.startsWith(DEPENDABOT_BRANCH_PREFIX) &&
    (pull.headRef.includes(MUSICIAN_SITE_PACKAGE.slice(1)) || pull.title.includes(MUSICIAN_SITE_PACKAGE))
  ) {
    return "dependabot";
  }
  return null;
}

/** The open pull request that updates the package, the platform's upgrade first. */
export function findUpdatePullRequest(pulls: readonly OpenPullRequest[]): SiteVersionInfo["pullRequest"] {
  const kinds: SiteUpdatePullRequestKind[] = ["upgrade", "dependabot"];
  for (const kind of kinds) {
    const pull = pulls.find((p) => updatePullRequestKind(p) === kind);
    if (pull) return { number: pull.number, url: pull.htmlUrl, kind };
  }
  return null;
}

/**
 * Put together what the page shows. The site's package.json is read first:
 * Dependabot keeps it current, but never updates the stamp, whose
 * `packageVersion` is the release the site was created on. The stamp only
 * answers for a site whose package.json doesn't name the package (or is
 * missing or unreadable). A missing or unreadable stamp is no version.
 */
export function siteVersionInfo(args: {
  packageJson: string | null;
  stamp: string | null;
  latest: string | null;
  pulls: readonly OpenPullRequest[];
}): SiteVersionInfo {
  const pinned = pinnedPackageVersion(args.packageJson);
  const stamped = pinned === null ? readStamp(args.stamp).packageVersion : null;
  const current = pinned ?? stamped;
  return {
    current,
    source: pinned !== null ? "package_json" : stamped !== null ? "stamp" : null,
    latest: args.latest,
    updateAvailable: args.latest === null ? null : !isOnOrPastRelease(current, args.latest),
    pullRequest: findUpdatePullRequest(args.pulls),
  };
}

/**
 * Read a site's version from its repo's `branch` and npm. npm being
 * unreachable leaves `latest` unknown rather than failing the read; GitHub
 * errors are thrown.
 */
export async function readSiteVersion(
  client: GitHubRepoClient,
  branch: string,
  options: { fetchImpl?: typeof fetch; registry?: string } = {},
): Promise<SiteVersionInfo> {
  const [packageJson, stamp, pulls, latest] = await Promise.all([
    client.getFileText("package.json", branch),
    client.getFileText(TEMPLATE_STAMP_PATH, branch),
    client.listOpenPullRequests(),
    fetchLatestPackageVersion(options).catch(() => null),
  ]);
  return siteVersionInfo({ packageJson, stamp, latest, pulls });
}
