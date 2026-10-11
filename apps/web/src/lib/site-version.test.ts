import { describe, expect, it, vi } from "vitest";

import { GitHubApiError, type GitHubRepoClient, type OpenPullRequest, type PullRequestResult } from "./integrations/github";
import { gitBlobSha } from "./site-scaffold";
import {
  dependabotBumpVersion,
  fetchLatestPackageVersion,
  findUpdatePullRequest,
  isDependabotBump,
  type LatestRelease,
  readSiteVersion,
  siteVersionInfo,
  versionSpecKind,
} from "./site-version";
import { upgradePullRequestTitle } from "./site-upgrade";

const pkg = (spec?: string) =>
  JSON.stringify({ dependencies: { next: "^15.5.27", ...(spec ? { "@jclaw-labs/musician-site": spec } : {}) } });
const stamp = (packageVersion: string | null) =>
  JSON.stringify({ template: "musician-site", templateVersion: "1.0.0", packageVersion, manifest: {}, createdAt: "2026-10-01T00:00:00.000Z" });
const published = (version: string): LatestRelease => ({ status: "published", version });
const UNREACHABLE: LatestRelease = { status: "unreachable", version: null };

const pull = (overrides: Partial<OpenPullRequest>): OpenPullRequest => ({
  number: 1,
  htmlUrl: "https://github.com/jclaw/site/pull/1",
  title: "Some change",
  headRef: "feature",
  ...overrides,
});
/** The platform's upgrade pull request, opened for `version` (1.4.1, the default target). */
const upgradePull = (number = 7, version = "1.4.1"): PullRequestResult => ({
  number,
  htmlUrl: `https://github.com/jclaw/site/pull/${number}`,
  title: upgradePullRequestTitle(version),
  state: "open",
});

/** `siteVersionInfo` with the platform's bundle and npm both on 1.4.1 unless overridden. */
const info = (args: Partial<Parameters<typeof siteVersionInfo>[0]>) =>
  siteVersionInfo({ packageJson: null, stamp: null, target: "1.4.1", latest: published("1.4.1"), upgradePull: null, pulls: [], ...args });

describe("siteVersionInfo", () => {
  it("reads the version from package.json over the stamp, which Dependabot never updates", () => {
    expect(info({ packageJson: pkg("1.4.1"), stamp: stamp("1.2.0") })).toEqual({
      current: "1.4.1",
      currentKind: "version",
      source: "package_json",
      target: "1.4.1",
      needsHandUpgrade: false,
      updateAvailable: false,
      latest: "1.4.1",
      latestStatus: "published",
      newerRelease: null,
      pullRequest: null,
    });
  });

  it("offers an update when the site is behind the platform's release", () => {
    expect(info({ packageJson: pkg("1.2.0"), stamp: stamp("1.2.0") })).toMatchObject({
      current: "1.2.0",
      target: "1.4.1",
      updateAvailable: true,
      newerRelease: null,
    });
  });

  it("doesn't offer one to a site ahead of the platform's release, or on a range that admits it", () => {
    expect(info({ packageJson: pkg("1.5.0") }).updateAvailable).toBe(false);
    expect(info({ packageJson: pkg("^1.2.0") })).toMatchObject({ current: "^1.2.0", currentKind: "range", updateAvailable: false });
  });

  it("decides by the platform's release, as upgrade_site does, not by npm's latest", () => {
    // npm is past the bundle: the job would find the site up to date.
    const ahead = info({ packageJson: pkg("1.4.1"), target: "1.4.1", latest: published("1.5.0") });
    expect(ahead).toMatchObject({ updateAvailable: false, latest: "1.5.0", newerRelease: "dependabot" });
    // The bundle is past npm (a deploy built before npm's tag moved back): the job would act.
    const behind = info({ packageJson: pkg("1.4.1"), target: "1.5.0", latest: published("1.4.1") });
    expect(behind).toMatchObject({ updateAvailable: true, newerRelease: null });
  });

  it("doesn't count a newer release the site's range already admits", () => {
    expect(info({ packageJson: pkg("^1.4.0"), target: "1.4.1", latest: published("1.5.0") }).newerRelease).toBeNull();
  });

  it("routes a newer release in the site's major through Dependabot, and a new major through the platform", () => {
    expect(info({ packageJson: pkg("1.4.1"), latest: published("1.5.0") }).newerRelease).toBe("dependabot");
    expect(info({ packageJson: pkg("~1.4.0"), latest: published("1.5.0") }).newerRelease).toBe("dependabot");
    expect(info({ packageJson: pkg("1.4.1"), latest: published("2.0.0") }).newerRelease).toBe("platform");
    // Behind the target: the major it moves onto with the update on offer counts.
    expect(info({ packageJson: pkg("1.2.0"), target: "2.0.0", latest: published("2.1.0") }).newerRelease).toBe("dependabot");
    expect(info({ packageJson: pkg("1.2.0"), target: "1.4.1", latest: published("2.0.0") }).newerRelease).toBe("platform");
    // A full copy reaches the package only through the platform.
    expect(info({ packageJson: pkg(), target: null, latest: published("1.4.1") }).newerRelease).toBe("platform");
  });

  it("never counts a prerelease on latest as newer", () => {
    for (const target of ["1.4.1", null]) {
      expect(info({ packageJson: pkg("1.4.1"), target, latest: published("2.0.0-rc.0") })).toMatchObject({
        latest: "2.0.0-rc.0",
        newerRelease: null,
      });
    }
  });

  it("offers nothing when the platform bundles no release, but says when npm has one", () => {
    expect(info({ packageJson: pkg("1.2.0"), target: null, latest: published("1.4.1") })).toMatchObject({
      target: null,
      updateAvailable: false,
      newerRelease: "dependabot",
    });
    expect(info({ packageJson: null, stamp: null, target: null, latest: { status: "not_published", version: null } })).toMatchObject({
      current: null,
      updateAvailable: false,
      latest: null,
      latestStatus: "not_published",
      newerRelease: null,
    });
  });

  it("falls back to the stamp when package.json doesn't name the package, and offers no update the job would refuse", () => {
    // upgrade_site counts a package.json that dropped the package as a customization.
    const devDependency = JSON.stringify({ devDependencies: { "@jclaw-labs/musician-site": "1.2.0" } });
    for (const packageJson of [pkg(), devDependency]) {
      expect(info({ packageJson, stamp: stamp("1.2.0"), latest: published("1.5.0") })).toMatchObject({
        current: "1.2.0",
        source: "stamp",
        needsHandUpgrade: true,
        updateAvailable: false,
        newerRelease: null,
      });
    }
  });

  it("falls back to the stamp when package.json is missing or unreadable", () => {
    for (const packageJson of [null, "{ not json"]) {
      expect(info({ packageJson, stamp: stamp("1.2.0"), latest: UNREACHABLE })).toMatchObject({
        current: "1.2.0",
        source: "stamp",
        needsHandUpgrade: true,
        updateAvailable: false,
      });
    }
  });

  it("offers no update to a site naming the package by a spec that isn't a version or range", () => {
    for (const spec of ["latest", "github:jclaw-labs/musician-site", "git+https://github.com/x/y.git", "file:../musician-site"]) {
      expect(info({ packageJson: pkg(spec), stamp: stamp("1.2.0") }), spec).toMatchObject({
        current: spec,
        source: "package_json",
        needsHandUpgrade: true,
        updateAvailable: false,
      });
    }
    // `*` is a range the job reads: it admits the target, so the site is on it.
    expect(info({ packageJson: pkg("*"), stamp: stamp("1.2.0") })).toMatchObject({ needsHandUpgrade: false, updateAvailable: false });
  });

  it("reads a missing, unreadable or pre-package stamp as no version: a full copy, behind any release", () => {
    for (const s of [null, "{ not json", "[]", stamp(null), JSON.stringify({ packageVersion: 3 })]) {
      expect(info({ packageJson: pkg(), stamp: s })).toMatchObject({
        current: null,
        currentKind: null,
        source: null,
        needsHandUpgrade: false,
        updateAvailable: true,
      });
    }
  });

  it("still knows whether an update is available when npm couldn't be read", () => {
    expect(info({ packageJson: pkg("1.2.0"), latest: UNREACHABLE })).toMatchObject({
      latest: null,
      latestStatus: "unreachable",
      updateAvailable: true,
      newerRelease: null,
    });
  });

  it("links the open pull request that updates the package", () => {
    expect(info({ packageJson: pkg("1.2.0"), upgradePull: upgradePull(7) }).pullRequest).toEqual({
      number: 7,
      url: "https://github.com/jclaw/site/pull/7",
      kind: "upgrade",
      reachesTarget: true,
      updatesSite: true,
    });
  });

  it("counts an upgrade pull request as the update only when the release in its title reaches the platform's release", () => {
    // Opened for 1.4.1; the platform's release has since moved to 2.0.0.
    expect(info({ packageJson: pkg("1.2.0"), target: "2.0.0", latest: published("2.0.0"), upgradePull: upgradePull(7, "1.4.1") })).toMatchObject({
      updateAvailable: true,
      pullRequest: { kind: "upgrade", reachesTarget: false, updatesSite: true },
    });
    expect(info({ packageJson: pkg("1.2.0"), upgradePull: upgradePull(7, "1.4.1") }).pullRequest).toMatchObject({ reachesTarget: true, updatesSite: true });
    // An edited title names no release: the job rewrites it on its next run, so it's taken as the update.
    const edited = { ...upgradePull(7), title: "Site code update (please review)" };
    expect(info({ packageJson: pkg("1.2.0"), target: "2.0.0", upgradePull: edited }).pullRequest).toMatchObject({ reachesTarget: true, updatesSite: true });
  });

  it("doesn't count a pull request at or below the site's release as updating it", () => {
    // Dependabot moved the site onto 1.4.1 while the old upgrade pull request stayed open.
    expect(info({ packageJson: pkg("1.4.1"), upgradePull: upgradePull(7, "1.4.1") })).toMatchObject({
      updateAvailable: false,
      pullRequest: { kind: "upgrade", reachesTarget: true, updatesSite: false },
    });
    expect(info({ packageJson: pkg("1.4.1"), upgradePull: upgradePull(7, "1.3.0") }).pullRequest?.updatesSite).toBe(false);
    const bump = [pull({ headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.3.0" })];
    expect(info({ packageJson: pkg("1.4.1"), pulls: bump }).pullRequest).toMatchObject({ kind: "dependabot", updatesSite: false });
    expect(info({ packageJson: pkg("1.2.0"), pulls: bump }).pullRequest?.updatesSite).toBe(true);
    // A site naming no release (a full copy) is updated by any.
    expect(info({ packageJson: pkg(), upgradePull: upgradePull(7, "1.4.1") }).pullRequest?.updatesSite).toBe(true);
  });

  it("counts a Dependabot bump as the update only when it reaches the platform's release", () => {
    const bump = (version: string) => [pull({ number: 4, htmlUrl: "u4", headRef: `dependabot/npm_and_yarn/jclaw-labs/musician-site-${version}` })];
    // A major on offer: Dependabot ignores majors, so its bump stays in 1.x.
    expect(info({ packageJson: pkg("1.4.1"), target: "2.0.0", latest: published("2.0.0"), pulls: bump("1.4.2") })).toMatchObject({
      updateAvailable: true,
      pullRequest: { kind: "dependabot", reachesTarget: false },
    });
    // An older bump left open (its build gate failed) while the platform moved on.
    expect(info({ packageJson: pkg("1.2.0"), pulls: bump("1.3.0") }).pullRequest?.reachesTarget).toBe(false);
    expect(info({ packageJson: pkg("1.2.0"), pulls: bump("1.4.1") }).pullRequest?.reachesTarget).toBe(true);
    expect(info({ packageJson: pkg("1.2.0"), pulls: bump("1.5.0") }).pullRequest?.reachesTarget).toBe(true);
  });

  it("needs upgrading by hand when package.json changed beyond versions since the manifest, as the job reads it", () => {
    const baseline = JSON.stringify({ dependencies: { next: "^15.5.0", "@jclaw-labs/musician-site": "1.0.0" } }, null, 2);
    const leftPad = JSON.stringify({ dependencies: { next: "^15.5.27", "left-pad": "1.3.0", "@jclaw-labs/musician-site": "1.2.0" } });
    const script = JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "^15.5.27", "@jclaw-labs/musician-site": "1.2.0" } });
    for (const packageJson of [leftPad, script]) {
      expect(info({ packageJson, baselinePackageJson: baseline, stamp: stamp("1.0.0") }), packageJson).toMatchObject({
        current: "1.2.0",
        needsHandUpgrade: true,
        updateAvailable: false,
      });
    }
    // Dependabot's bumps alone aren't a change, and without the manifest's package.json nothing is compared.
    expect(info({ packageJson: pkg("1.2.0"), baselinePackageJson: baseline })).toMatchObject({ needsHandUpgrade: false, updateAvailable: true });
    expect(info({ packageJson: leftPad, baselinePackageJson: null })).toMatchObject({ needsHandUpgrade: false, updateAvailable: true });
  });
});

describe("versionSpecKind", () => {
  it("tells versions, ranges, any release and other specs apart", () => {
    expect(versionSpecKind("1.4.1")).toBe("version");
    for (const spec of ["^1.0.0", "~1.2.0", "1.2.x", ">=1.2.0 <2.0.0"]) expect(versionSpecKind(spec)).toBe("range");
    expect(versionSpecKind("*")).toBe("any");
    // npm reads `x` as any release, but the upgrade doesn't take it for a version spec.
    for (const spec of ["x", "X", "x.x", "latest", "git+https://github.com/jclaw-labs/stagecraft.git", "file:../musician-site"]) {
      expect(versionSpecKind(spec)).toBe("other");
    }
  });
});

describe("isDependabotBump", () => {
  it("knows a Dependabot bump of the package by its branch, in the root or a subdirectory", () => {
    expect(isDependabotBump({ headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1" })).toBe(true);
    expect(isDependabotBump({ headRef: "dependabot/npm_and_yarn/site/jclaw-labs/musician-site-1.4.1" })).toBe(true);
  });

  it("ignores other Dependabot bumps, lookalike packages and other branches", () => {
    for (const headRef of [
      "dependabot/npm_and_yarn/next-15.6.0",
      "dependabot/npm_and_yarn/jclaw-labs/musician-site-shell-1.0.0",
      "dependabot/npm_and_yarn/jclaw-labs/musician-site-extras-1.0.0",
      "dependabot/npm_and_yarn/other/jclaw-labs/musician-site-tools-2.0.0",
      "dependabot/npm_and_yarn/npm_and_yarn-1a2b3c",
      "dependabot/github_actions/jclaw-labs/musician-site-1",
      "musician-site-notes",
      "fork/dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1",
    ]) {
      expect(isDependabotBump({ headRef }), headRef).toBe(false);
    }
  });
});

describe("findUpdatePullRequest", () => {
  it("prefers the platform's upgrade over a Dependabot bump", () => {
    const pulls = [pull({ number: 3, htmlUrl: "u3", headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1" })];
    expect(findUpdatePullRequest({ number: 2, htmlUrl: "u2", title: upgradePullRequestTitle("1.4.1"), state: "open" }, pulls, "1.4.1")).toEqual({
      number: 2,
      url: "u2",
      kind: "upgrade",
      reachesTarget: true,
      updatesSite: true,
    });
  });

  it("takes a Dependabot bump when there's no upgrade", () => {
    const pulls = [pull({}), pull({ number: 4, htmlUrl: "u4", headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1" })];
    expect(findUpdatePullRequest(null, pulls, "1.4.1")).toEqual({ number: 4, url: "u4", kind: "dependabot", reachesTarget: true, updatesSite: true });
  });

  it("says a Dependabot bump reaches the target only at or past it, and never without one", () => {
    const at = (version: string, target: string | null) =>
      findUpdatePullRequest(null, [pull({ headRef: `dependabot/npm_and_yarn/jclaw-labs/musician-site-${version}` })], target)?.reachesTarget;
    expect(at("1.4.2", "2.0.0")).toBe(false);
    expect(at("1.3.0", "1.4.1")).toBe(false);
    expect(at("1.4.1", "1.4.1")).toBe(true);
    expect(at("1.5.0", "1.4.1")).toBe(true);
    expect(at("2.0.0-rc.0", "2.0.0")).toBe(false);
    expect(at("1.4.1", null)).toBe(false);
  });

  it("says an upgrade pull request reaches the target by the release in its title, or when its title names none", () => {
    const at = (title: string, target: string | null) =>
      findUpdatePullRequest({ ...upgradePull(), title }, [], target)?.reachesTarget;
    expect(at(upgradePullRequestTitle("1.4.1"), "2.0.0")).toBe(false);
    expect(at(upgradePullRequestTitle("1.4.1"), "1.4.1")).toBe(true);
    expect(at(upgradePullRequestTitle("2.0.0-rc.0"), "2.0.0")).toBe(false);
    expect(at(upgradePullRequestTitle("1.4.1"), null)).toBe(false);
    expect(at("Upgrade the site", "2.0.0")).toBe(true);
  });

  it("says a pull request updates the site only past the release package.json names", () => {
    const updates = (version: string, pinned: string | null) =>
      findUpdatePullRequest(upgradePull(7, version), [], "1.4.1", pinned)?.updatesSite;
    expect(updates("1.4.1", "1.2.0")).toBe(true);
    expect(updates("1.4.1", "1.4.1")).toBe(false);
    expect(updates("1.3.0", "1.4.1")).toBe(false);
    expect(updates("1.4.1", "^1.4.0")).toBe(false);
    expect(updates("1.4.1", null)).toBe(true);
    expect(findUpdatePullRequest({ ...upgradePull(), title: "Edited" }, [], "1.4.1", "1.4.1")?.updatesSite).toBe(true);
  });

  it("is null when nothing updates the package", () => {
    expect(findUpdatePullRequest(null, [], "1.4.1")).toBeNull();
    expect(findUpdatePullRequest(null, [pull({}), pull({ headRef: "stagecraft/upgrade" })], "1.4.1")).toBeNull();
  });
});

describe("dependabotBumpVersion", () => {
  it("reads the release from a bump's branch, or null when it names none", () => {
    expect(dependabotBumpVersion({ headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.2" })).toBe("1.4.2");
    expect(dependabotBumpVersion({ headRef: "dependabot/npm_and_yarn/site/jclaw-labs/musician-site-2.0.0-rc.1" })).toBe("2.0.0-rc.1");
    expect(dependabotBumpVersion({ headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4" })).toBeNull();
    expect(dependabotBumpVersion({ headRef: "dependabot/npm_and_yarn/next-15.6.0" })).toBeNull();
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fetchLatestPackageVersion", () => {
  it("reads the version of the package's latest dist-tag", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ name: "@jclaw-labs/musician-site", version: "1.4.1" }));
    await expect(fetchLatestPackageVersion({ fetchImpl, registry: "https://registry.test" })).resolves.toEqual(published("1.4.1"));
    expect(fetchImpl).toHaveBeenCalledWith("https://registry.test/@jclaw-labs%2fmusician-site/latest", expect.anything());
  });

  it("reads a 404 as not published yet", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "Not found" }, 404));
    await expect(fetchLatestPackageVersion({ fetchImpl })).resolves.toEqual({ status: "not_published", version: null });
  });

  it("throws on another HTTP error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "Bad gateway" }, 502));
    await expect(fetchLatestPackageVersion({ fetchImpl })).rejects.toThrow("HTTP 502");
  });

  it("throws when the registry names no version", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ name: "@jclaw-labs/musician-site" }));
    await expect(fetchLatestPackageVersion({ fetchImpl })).rejects.toThrow("names no version");
  });
});

describe("readSiteVersion", () => {
  function client(
    files: Record<string, string>,
    pulls: OpenPullRequest[] = [],
    upgrade: PullRequestResult | null = null,
    blobs: Record<string, string> = {},
  ) {
    return {
      getFileText: vi.fn(async (path: string) => files[path] ?? null),
      getBlobText: vi.fn(async (sha: string) => blobs[sha]),
      findOpenPullRequest: vi.fn(async () => upgrade),
      listOpenPullRequests: vi.fn(async () => pulls),
    } as unknown as GitHubRepoClient & {
      getFileText: ReturnType<typeof vi.fn>;
      getBlobText: ReturnType<typeof vi.fn>;
      findOpenPullRequest: ReturnType<typeof vi.fn>;
    };
  }
  const target = (version: string | null) => async () => version;

  it("reads package.json and the stamp from the default branch, the target from the bundle, and latest from npm", async () => {
    const repo = client(
      { "package.json": pkg("1.2.0"), ".stagecraft-template.json": stamp("1.2.0") },
      [pull({ number: 9, htmlUrl: "u9", headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1" })],
    );
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.5.0" }));

    expect(await readSiteVersion(repo, "trunk", { fetchImpl, readTarget: target("1.4.1") })).toEqual({
      current: "1.2.0",
      currentKind: "version",
      source: "package_json",
      target: "1.4.1",
      needsHandUpgrade: false,
      updateAvailable: true,
      latest: "1.5.0",
      latestStatus: "published",
      newerRelease: "dependabot",
      pullRequest: { number: 9, url: "u9", kind: "dependabot", reachesTarget: true, updatesSite: true },
    });
    expect(repo.getFileText).toHaveBeenCalledWith("package.json", "trunk");
    expect(repo.getFileText).toHaveBeenCalledWith(".stagecraft-template.json", "trunk");
    expect(repo.getBlobText).not.toHaveBeenCalled();
  });

  it("compares package.json with the one the stamp's manifest records", async () => {
    const baseline = JSON.stringify({ dependencies: { "@jclaw-labs/musician-site": "1.2.0" } });
    const withManifest = JSON.stringify({ packageVersion: "1.2.0", manifest: { "package.json": "b1", "src/app/page.tsx": "b2" } });
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.4.1" }));
    const read = (packageJson: string) => {
      const repo = client({ "package.json": packageJson, ".stagecraft-template.json": withManifest }, [], null, { b1: baseline });
      return readSiteVersion(repo, "main", { fetchImpl, readTarget: target("1.4.1") }).then((info) => ({ info, repo }));
    };

    const bumped = await read(JSON.stringify({ dependencies: { "@jclaw-labs/musician-site": "1.3.0" } }));
    expect(bumped.info).toMatchObject({ needsHandUpgrade: false, updateAvailable: true });
    expect(bumped.repo.getBlobText).toHaveBeenCalledWith("b1");
    const added = await read(JSON.stringify({ dependencies: { "@jclaw-labs/musician-site": "1.3.0", "left-pad": "1.3.0" } }));
    expect(added.info).toMatchObject({ needsHandUpgrade: true, updateAvailable: false });
  });

  it("reads the manifest's package.json only when the job would compare it", async () => {
    const baseline = JSON.stringify({ dependencies: { "@jclaw-labs/musician-site": "1.2.0" } });
    const stampWith = (sha: string) => JSON.stringify({ packageVersion: "1.2.0", manifest: { "package.json": sha } });
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.4.1" }));
    // package.json is the blob the manifest records: the job skips it as unchanged.
    const same = client({ "package.json": baseline, ".stagecraft-template.json": stampWith(gitBlobSha(baseline)) });
    expect(await readSiteVersion(same, "main", { fetchImpl, readTarget: target("1.4.1") })).toMatchObject({ needsHandUpgrade: false, updateAvailable: true });
    expect(same.getBlobText).not.toHaveBeenCalled();
    // No package.json: nothing to compare (the stamp alone says it needs upgrading by hand).
    const none = client({ ".stagecraft-template.json": stampWith("b1") });
    expect(await readSiteVersion(none, "main", { fetchImpl, readTarget: target("1.4.1") })).toMatchObject({ needsHandUpgrade: true });
    expect(none.getBlobText).not.toHaveBeenCalled();
  });

  it("skips the comparison when GitHub won't return the manifest's package.json, but for a 401", async () => {
    const withManifest = JSON.stringify({ packageVersion: "1.2.0", manifest: { "package.json": "missing" } });
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.4.1" }));
    // The site's package.json adds a dependency: compared, it would need upgrading by hand.
    const leftPad = JSON.stringify({ dependencies: { "@jclaw-labs/musician-site": "1.2.0", "left-pad": "1.3.0" } });
    const failing = (status: number) => {
      const repo = client({ "package.json": leftPad, ".stagecraft-template.json": withManifest });
      repo.getBlobText.mockRejectedValue(new GitHubApiError(status, "nope"));
      return readSiteVersion(repo, "main", { fetchImpl, readTarget: target("1.4.1") });
    };
    for (const status of [404, 403]) {
      expect(await failing(status), String(status)).toMatchObject({ current: "1.2.0", needsHandUpgrade: false, updateAvailable: true });
    }
    await expect(failing(401)).rejects.toMatchObject({ status: 401 });
  });

  it("looks the upgrade pull request up by its branch into the default branch", async () => {
    const repo = client({ "package.json": pkg("1.2.0") }, [], upgradePull(12));
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.4.1" }));
    const read = await readSiteVersion(repo, "trunk", { fetchImpl, readTarget: target("1.4.1") });
    expect(read.pullRequest).toEqual({
      number: 12,
      url: "https://github.com/jclaw/site/pull/12",
      kind: "upgrade",
      reachesTarget: true,
      updatesSite: true,
    });
    expect(repo.findOpenPullRequest).toHaveBeenCalledWith("stagecraft/upgrade", "trunk");
  });

  it("has no target when the bundle names no release", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "Not found" }, 404));
    const read = await readSiteVersion(client({ "package.json": pkg("1.2.0") }), "main", { fetchImpl, readTarget: target(null) });
    expect(read).toMatchObject({ target: null, updateAvailable: false, latestStatus: "not_published" });
  });

  it("leaves latest unknown when npm can't be read", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const read = await readSiteVersion(client({ "package.json": pkg("1.2.0") }), "main", { fetchImpl, readTarget: target("1.4.1") });
    expect(read).toMatchObject({ current: "1.2.0", latest: null, latestStatus: "unreachable", updateAvailable: true });
  });

  it("throws when GitHub can't be read", async () => {
    const repo = client({});
    repo.getFileText.mockRejectedValue(new Error("GitHub API error (500)"));
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.4.1" }));
    await expect(readSiteVersion(repo, "main", { fetchImpl, readTarget: target("1.4.1") })).rejects.toThrow("GitHub API error (500)");
  });
});
