import { describe, expect, it, vi } from "vitest";

import type { GitHubRepoClient, OpenPullRequest } from "./integrations/github";
import {
  fetchLatestPackageVersion,
  findUpdatePullRequest,
  readSiteVersion,
  siteVersionInfo,
  updatePullRequestKind,
} from "./site-version";

const pkg = (spec?: string) =>
  JSON.stringify({ dependencies: { next: "^15.5.27", ...(spec ? { "@jclaw-labs/musician-site": spec } : {}) } });
const stamp = (packageVersion: string | null) =>
  JSON.stringify({ template: "musician-site", templateVersion: "1.0.0", packageVersion, manifest: {}, createdAt: "2026-10-01T00:00:00.000Z" });

const pull = (overrides: Partial<OpenPullRequest>): OpenPullRequest => ({
  number: 1,
  htmlUrl: "https://github.com/jclaw/site/pull/1",
  title: "Some change",
  headRef: "feature",
  ...overrides,
});

describe("siteVersionInfo", () => {
  it("reads the version from package.json over the stamp, which Dependabot never updates", () => {
    expect(siteVersionInfo({ packageJson: pkg("1.4.1"), stamp: stamp("1.2.0"), latest: "1.4.1", pulls: [] })).toEqual({
      current: "1.4.1",
      source: "package_json",
      latest: "1.4.1",
      updateAvailable: false,
      pullRequest: null,
    });
  });

  it("flags a site behind npm's latest", () => {
    const info = siteVersionInfo({ packageJson: pkg("1.2.0"), stamp: stamp("1.2.0"), latest: "1.4.1", pulls: [] });
    expect(info).toMatchObject({ current: "1.2.0", latest: "1.4.1", updateAvailable: true });
  });

  it("doesn't flag a site ahead of latest, or on a range that admits it", () => {
    expect(siteVersionInfo({ packageJson: pkg("1.5.0"), stamp: null, latest: "1.4.1", pulls: [] }).updateAvailable).toBe(false);
    expect(siteVersionInfo({ packageJson: pkg("^1.2.0"), stamp: null, latest: "1.4.1", pulls: [] })).toMatchObject({
      current: "^1.2.0",
      updateAvailable: false,
    });
  });

  it("falls back to the stamp when package.json doesn't name the package", () => {
    const info = siteVersionInfo({ packageJson: pkg(), stamp: stamp("1.2.0"), latest: "1.4.1", pulls: [] });
    expect(info).toMatchObject({ current: "1.2.0", source: "stamp", updateAvailable: true });
  });

  it("falls back to the stamp when package.json is missing or unreadable", () => {
    for (const packageJson of [null, "{ not json"]) {
      expect(siteVersionInfo({ packageJson, stamp: stamp("1.2.0"), latest: null, pulls: [] })).toMatchObject({
        current: "1.2.0",
        source: "stamp",
      });
    }
  });

  it("reads a missing, unreadable or pre-package stamp as no version: a full copy, behind any release", () => {
    for (const s of [null, "{ not json", "[]", stamp(null), JSON.stringify({ packageVersion: 3 })]) {
      expect(siteVersionInfo({ packageJson: pkg(), stamp: s, latest: "1.4.1", pulls: [] })).toMatchObject({
        current: null,
        source: null,
        updateAvailable: true,
      });
    }
  });

  it("leaves whether an update is available unknown when latest couldn't be read", () => {
    expect(siteVersionInfo({ packageJson: pkg("1.2.0"), stamp: null, latest: null, pulls: [] }).updateAvailable).toBeNull();
  });

  it("links the open pull request that updates the package", () => {
    const info = siteVersionInfo({
      packageJson: pkg("1.2.0"),
      stamp: null,
      latest: "1.4.1",
      pulls: [pull({ number: 7, htmlUrl: "https://github.com/jclaw/site/pull/7", headRef: "stagecraft/upgrade" })],
    });
    expect(info.pullRequest).toEqual({ number: 7, url: "https://github.com/jclaw/site/pull/7", kind: "upgrade" });
  });
});

describe("updatePullRequestKind", () => {
  it("knows the platform's upgrade branch", () => {
    expect(updatePullRequestKind({ headRef: "stagecraft/upgrade", title: "Upgrade" })).toBe("upgrade");
  });

  it("knows a Dependabot bump of the package by its branch or, grouped, by its title", () => {
    expect(updatePullRequestKind({ headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1", title: "Bump" })).toBe(
      "dependabot",
    );
    expect(
      updatePullRequestKind({
        headRef: "dependabot/npm_and_yarn/npm_and_yarn-1a2b3c",
        title: "Bump the npm_and_yarn group with 2 updates: @jclaw-labs/musician-site and next",
      }),
    ).toBe("dependabot");
  });

  it("ignores other Dependabot bumps and other branches", () => {
    expect(updatePullRequestKind({ headRef: "dependabot/npm_and_yarn/next-15.6.0", title: "Bump next from 15.5.27 to 15.6.0" })).toBeNull();
    expect(updatePullRequestKind({ headRef: "musician-site-notes", title: "@jclaw-labs/musician-site notes" })).toBeNull();
    expect(updatePullRequestKind({ headRef: "dependabot/github_actions/jclaw-labs/musician-site-1", title: "Bump" })).toBeNull();
  });
});

describe("findUpdatePullRequest", () => {
  it("prefers the platform's upgrade over a Dependabot bump", () => {
    const pulls = [
      pull({ number: 3, htmlUrl: "u3", headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1" }),
      pull({ number: 2, htmlUrl: "u2", headRef: "stagecraft/upgrade" }),
    ];
    expect(findUpdatePullRequest(pulls)).toEqual({ number: 2, url: "u2", kind: "upgrade" });
  });

  it("takes a Dependabot bump when there's no upgrade", () => {
    const pulls = [pull({ number: 4, htmlUrl: "u4", headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1" })];
    expect(findUpdatePullRequest(pulls)).toEqual({ number: 4, url: "u4", kind: "dependabot" });
  });

  it("is null when nothing updates the package", () => {
    expect(findUpdatePullRequest([])).toBeNull();
    expect(findUpdatePullRequest([pull({})])).toBeNull();
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("fetchLatestPackageVersion", () => {
  it("reads the version of the package's latest dist-tag", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ name: "@jclaw-labs/musician-site", version: "1.4.1" }));
    await expect(fetchLatestPackageVersion({ fetchImpl, registry: "https://registry.test" })).resolves.toBe("1.4.1");
    expect(fetchImpl).toHaveBeenCalledWith("https://registry.test/@jclaw-labs%2fmusician-site/latest", expect.anything());
  });

  it("throws on an HTTP error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "Not found" }, 404));
    await expect(fetchLatestPackageVersion({ fetchImpl })).rejects.toThrow("HTTP 404");
  });

  it("throws when the registry names no version", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ name: "@jclaw-labs/musician-site" }));
    await expect(fetchLatestPackageVersion({ fetchImpl })).rejects.toThrow("names no version");
  });
});

describe("readSiteVersion", () => {
  function client(files: Record<string, string>, pulls: OpenPullRequest[] = []) {
    return {
      getFileText: vi.fn(async (path: string) => files[path] ?? null),
      listOpenPullRequests: vi.fn(async () => pulls),
    } as unknown as GitHubRepoClient & { getFileText: ReturnType<typeof vi.fn> };
  }

  it("reads package.json and the stamp from the default branch, and latest from npm", async () => {
    const repo = client(
      { "package.json": pkg("1.2.0"), ".stagecraft-template.json": stamp("1.2.0") },
      [pull({ number: 9, htmlUrl: "u9", headRef: "dependabot/npm_and_yarn/jclaw-labs/musician-site-1.4.1" })],
    );
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.4.1" }));

    expect(await readSiteVersion(repo, "trunk", { fetchImpl })).toEqual({
      current: "1.2.0",
      source: "package_json",
      latest: "1.4.1",
      updateAvailable: true,
      pullRequest: { number: 9, url: "u9", kind: "dependabot" },
    });
    expect(repo.getFileText).toHaveBeenCalledWith("package.json", "trunk");
    expect(repo.getFileText).toHaveBeenCalledWith(".stagecraft-template.json", "trunk");
  });

  it("leaves latest unknown when npm can't be read", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const info = await readSiteVersion(client({ "package.json": pkg("1.2.0") }), "main", { fetchImpl });
    expect(info).toMatchObject({ current: "1.2.0", latest: null, updateAvailable: null });
  });

  it("throws when GitHub can't be read", async () => {
    const repo = client({});
    repo.getFileText.mockRejectedValue(new Error("GitHub API error (500)"));
    const fetchImpl = vi.fn(async () => jsonResponse({ version: "1.4.1" }));
    await expect(readSiteVersion(repo, "main", { fetchImpl })).rejects.toThrow("GitHub API error (500)");
  });
});
