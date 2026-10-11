import { describe, expect, it, vi } from "vitest";

import type { GitHubRepoClient, OpenPullRequest, PullRequestResult } from "./integrations/github";
import {
  fetchLatestPackageVersion,
  findUpdatePullRequest,
  isDependabotBump,
  type LatestRelease,
  readSiteVersion,
  siteVersionInfo,
  versionSpecKind,
} from "./site-version";

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
const upgradePull = (number = 7): PullRequestResult => ({ number, htmlUrl: `https://github.com/jclaw/site/pull/${number}`, state: "open" });

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
    });
  });
});

describe("versionSpecKind", () => {
  it("tells versions, ranges, any release and other specs apart", () => {
    expect(versionSpecKind("1.4.1")).toBe("version");
    for (const spec of ["^1.0.0", "~1.2.0", "1.2.x", ">=1.2.0 <2.0.0"]) expect(versionSpecKind(spec)).toBe("range");
    for (const spec of ["*", "x"]) expect(versionSpecKind(spec)).toBe("any");
    for (const spec of ["latest", "git+https://github.com/jclaw-labs/stagecraft.git", "file:../musician-site"]) {
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
    expect(findUpdatePullRequest({ number: 2, htmlUrl: "u2", state: "open" }, pulls)).toEqual({ number: 2, url: "u2", kind: "upgrade" });
  });

  it("takes a Dependabot bump when there's no upgrade", () => {
    const pulls = [pull({}), pull({ number: 4, htmlUrl: "u4", headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1" })];
    expect(findUpdatePullRequest(null, pulls)).toEqual({ number: 4, url: "u4", kind: "dependabot" });
  });

  it("is null when nothing updates the package", () => {
    expect(findUpdatePullRequest(null, [])).toBeNull();
    expect(findUpdatePullRequest(null, [pull({}), pull({ headRef: "stagecraft/upgrade" })])).toBeNull();
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
  function client(files: Record<string, string>, pulls: OpenPullRequest[] = [], upgrade: PullRequestResult | null = null) {
    return {
      getFileText: vi.fn(async (path: string) => files[path] ?? null),
      findOpenPullRequest: vi.fn(async () => upgrade),
      listOpenPullRequests: vi.fn(async () => pulls),
    } as unknown as GitHubRepoClient & {
      getFileText: ReturnType<typeof vi.fn>;
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
      pullRequest: { number: 9, url: "u9", kind: "dependabot" },
    });
    expect(repo.getFileText).toHaveBeenCalledWith("package.json", "trunk");
    expect(repo.getFileText).toHaveBeenCalledWith(".stagecraft-template.json", "trunk");
  });

  it("looks the upgrade pull request up by its branch into the default branch", async () => {
    const repo = client({ "package.json": pkg("1.2.0") }, [], upgradePull(12));
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.4.1" }));
    const read = await readSiteVersion(repo, "trunk", { fetchImpl, readTarget: target("1.4.1") });
    expect(read.pullRequest).toEqual({ number: 12, url: "https://github.com/jclaw/site/pull/12", kind: "upgrade" });
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
