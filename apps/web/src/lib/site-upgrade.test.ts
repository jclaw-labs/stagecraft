import { describe, expect, it, vi } from "vitest";

import { gitBlobSha, MUSICIAN_SITE_PACKAGE, TEMPLATE_STAMP_PATH } from "./site-scaffold";
import {
  changedCodeFiles,
  fetchTargetSchemaVersion,
  isArtistPath,
  isCodePath,
  isCollectionFile,
  isDraftBranch,
  isIgnoredPath,
  isOnOrPastRelease,
  isUpgradeCommitMessage,
  isVersionSpec,
  manifestBaseline,
  migrateCollections,
  overwrittenFiles,
  packageJsonChangedBeyondVersions,
  pinnedPackageVersion,
  readStamp,
  targetShell,
  templatePushBaseline,
  UnsupportedSchemaVersionError,
  upgradeCommitMessage,
  upgradeDeletions,
  upgradePullRequestBody,
  upgradePullRequestTitle,
} from "./site-upgrade";

const tree = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([path, content]) => [path, gitBlobSha(content)]));

describe("path classes", () => {
  it.each([
    "src/lib/a.ts",
    "src/components/x/Y.tsx",
    "src/puck/config.tsx",
    "src/app/page.tsx",
    "src/admin/pages/page.tsx",
    "src/api/collections/route.ts",
    "src/middleware.ts",
    "next.config.ts",
  ])(
    "%s is our code",
    (path) => expect(isCodePath(path)).toBe(true),
  );

  it.each(["src/content/pages/home.json", "src/librarian.ts", "package.json", "tsconfig.json", "src/middleware.tsx"])(
    "%s isn't a code path",
    (path) => expect(isCodePath(path)).toBe(false),
  );

  it("treats src/content/ and public/images/ as the artist's, as the stamp's manifest does", () => {
    expect(isArtistPath("src/content/a.json")).toBe(true);
    expect(isArtistPath("public/images/a.webp")).toBe(true);
    expect(isArtistPath("public/robots.txt")).toBe(false);
    expect(isArtistPath("src/lib/a.ts")).toBe(false);
  });

  it("ignores .github/, the stamp and lockfiles", () => {
    expect(isIgnoredPath(".github/dependabot.yml")).toBe(true);
    expect(isIgnoredPath(TEMPLATE_STAMP_PATH)).toBe(true);
    for (const lockfile of ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]) {
      expect(isIgnoredPath(lockfile)).toBe(true);
    }
    expect(isIgnoredPath("package.json")).toBe(false);
  });

  it("recognizes draft branches and collection files", () => {
    expect(isDraftBranch("draft")).toBe(true);
    expect(isDraftBranch("draft-abc123")).toBe(true);
    expect(isDraftBranch("drafts")).toBe(false);
    expect(isDraftBranch("main")).toBe(false);
    expect(isCollectionFile("src/content/_collection.json")).toBe(true);
    expect(isCollectionFile("src/content/shows/_collection.json")).toBe(true);
    expect(isCollectionFile("src/content/shows/item.json")).toBe(false);
    expect(isCollectionFile("src/lib/_collection.json")).toBe(false);
  });
});

describe("readStamp", () => {
  it("reads a stamp with a manifest", () => {
    const stamp = readStamp(
      JSON.stringify({ packageVersion: "1.2.3", manifest: { "a.ts": "abc" }, createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(stamp).toEqual({ manifest: { "a.ts": "abc" }, packageVersion: "1.2.3", createdAt: "2026-01-01T00:00:00.000Z" });
  });

  it.each([
    ["no stamp", null],
    ["unparseable JSON", "{"],
    ["a stamp from before the manifest", '{"template":"musician-site","templateVersion":"0.0.1"}'],
    ["an empty manifest", '{"manifest":{}}'],
    ["a manifest with non-string SHAs", '{"manifest":{"a.ts":1}}'],
    ["a non-object", '"stamp"'],
  ])("reads %s as having no manifest", (_label, content) => {
    expect(readStamp(content).manifest).toBeNull();
  });
});

describe("packageJsonChangedBeyondVersions", () => {
  const base = JSON.stringify({ name: "s", scripts: { build: "next build" }, dependencies: { next: "^15.0.0", react: "^19.0.0" } });

  it("ignores version bumps and key order", () => {
    const bumped = JSON.stringify({ dependencies: { react: "^19.1.0", next: "^15.5.27" }, scripts: { build: "next build" }, name: "s" });
    expect(packageJsonChangedBeyondVersions(base, bumped)).toBe(false);
  });

  it("counts an added dependency, a changed script and a new field", () => {
    const parsed = JSON.parse(base);
    expect(packageJsonChangedBeyondVersions(base, JSON.stringify({ ...parsed, dependencies: { ...parsed.dependencies, lodash: "1" } }))).toBe(true);
    expect(packageJsonChangedBeyondVersions(base, JSON.stringify({ ...parsed, scripts: { build: "next build && x" } }))).toBe(true);
    expect(packageJsonChangedBeyondVersions(base, JSON.stringify({ ...parsed, engines: { node: ">=22" } }))).toBe(true);
  });

  it("counts a dependency moved to a git, file, alias or URL spec, or a dist-tag", () => {
    const parsed = JSON.parse(base);
    for (const spec of [
      "github:artist/next#patched",
      "npm:@artist/next-fork@15.2.0",
      "file:./vendor/next",
      "https://example.com/next.tgz",
      "canary",
    ]) {
      const forked = JSON.stringify({ ...parsed, dependencies: { ...parsed.dependencies, next: spec } });
      expect(packageJsonChangedBeyondVersions(base, forked), spec).toBe(true);
    }
  });

  it("compares unparseable text as is", () => {
    expect(packageJsonChangedBeyondVersions("{", "{")).toBe(false);
    expect(packageJsonChangedBeyondVersions("{", "{ ")).toBe(true);
  });
});

describe("isVersionSpec", () => {
  it.each(["1.2.3", "^15.2.0", "~4.0", ">=1 <2", "1.x", "*", "v1.0.0", "=2.0.0"])("%s is a version", (spec) =>
    expect(isVersionSpec(spec)).toBe(true),
  );

  it.each(["github:a/b", "npm:x@1.0.0", "file:../x", "git+https://x/y.git", "latest", "a/b#c", 1])("%s isn't", (spec) =>
    expect(isVersionSpec(spec)).toBe(false),
  );
});

describe("changedCodeFiles", () => {
  const blobs = new Map<string, string>();
  const read = async (sha: string) => blobs.get(sha)!;
  const remember = (files: Record<string, string>) => {
    for (const content of Object.values(files)) blobs.set(gitBlobSha(content), content);
    return tree(files);
  };

  it("reports changed, deleted and added code files, sorted", async () => {
    const push = remember({ "src/lib/a.ts": "a", "src/lib/b.ts": "b", "next.config.ts": "n", "README.md": "r" });
    const current = remember({ "src/lib/a.ts": "a2", "next.config.ts": "n", "src/app/new/page.tsx": "p", "README.md": "edited" });
    const changed = await changedCodeFiles(templatePushBaseline(push, current), current, read);
    expect(changed).toEqual(["src/app/new/page.tsx", "src/lib/a.ts", "src/lib/b.ts"]);
  });

  it("checks every manifest file, but never the artist's or ignored paths", async () => {
    const current = remember({
      "tsconfig.json": "edited",
      "src/content/x.json": "content",
      ".github/dependabot.yml": "edited",
    });
    const baseline = manifestBaseline({
      "tsconfig.json": gitBlobSha("{}"),
      ".github/dependabot.yml": gitBlobSha("v"),
      "public/images/a.webp": gitBlobSha("r"),
    });
    expect(await changedCodeFiles(baseline, current, read)).toEqual(["tsconfig.json"]);
  });

  it("reads package.json only when its SHA changed", async () => {
    const pkg = JSON.stringify({ dependencies: { next: "^15.0.0" } });
    const bumped = JSON.stringify({ dependencies: { next: "^15.5.27" } });
    const push = remember({ "package.json": pkg });
    const current = remember({ "package.json": bumped });
    const spy = vi.fn(read);
    expect(await changedCodeFiles(templatePushBaseline(push, current), current, spy)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("templatePushBaseline", () => {
  it("keeps code paths and package.json, plus other pushed files the artist hasn't changed", () => {
    const push = tree({
      "src/lib/a.ts": "a",
      "package.json": "{}",
      "eslint.config.mjs": "e",
      "tsconfig.json": "t",
      "README.md": "r",
      "src/content/x.json": "x",
      ".github/dependabot.yml": "d",
    });
    const current = tree({ "src/lib/a.ts": "changed", "package.json": "{}", "eslint.config.mjs": "e", "tsconfig.json": "mine" });
    const baseline = templatePushBaseline(push, current);
    expect(Object.keys(baseline.files).sort()).toEqual(["eslint.config.mjs", "package.json", "src/lib/a.ts"]);
    expect(baseline.inScope("eslint.config.mjs")).toBe(false);
    expect(baseline.inScope("src/puck/x.ts")).toBe(true);
    expect(baseline.inScope("package.json")).toBe(true);
  });
});

describe("upgradeDeletions", () => {
  it("deletes code paths, lockfiles and baseline files the upgrade doesn't write back", () => {
    const current = tree({
      "src/lib/a.ts": "a",
      "src/app/layout.tsx": "old",
      "src/app/admin/page.tsx": "admin",
      "eslint.config.mjs": "e",
      "package-lock.json": "{}",
      "README.md": "r",
      "src/content/x.json": "x",
      "public/images/a.txt": "i",
      ".github/dependabot.yml": "d",
      "notes.md": "mine",
    });
    const baseline = manifestBaseline({ "eslint.config.mjs": gitBlobSha("e"), ".github/dependabot.yml": gitBlobSha("d") });
    const writes = [{ path: "src/app/layout.tsx", content: "shell" }];
    expect(upgradeDeletions(current, baseline, writes)).toEqual([
      "eslint.config.mjs",
      "package-lock.json",
      "src/app/admin/page.tsx",
      "src/lib/a.ts",
    ]);
  });
});

describe("targetShell and isOnOrPastRelease", () => {
  const shellPackage = JSON.stringify({ dependencies: { "@jclaw-labs/musician-site": "1.4.0" } });

  it("is the bundle without its starter content when the bundle pins the package", () => {
    const shell = targetShell([
      { path: "package.json", content: shellPackage },
      { path: "src/app/layout.tsx", content: "l" },
      { path: "src/content/home.json", content: "{}" },
    ]);
    expect(shell?.packageVersion).toBe("1.4.0");
    expect(shell?.files.map((f) => f.path)).toEqual(["package.json", "src/app/layout.tsx"]);
  });

  it("is null for a full copy of the template", () => {
    expect(targetShell([{ path: "package.json", content: JSON.stringify({ dependencies: { next: "^15.5.27" } }) }])).toBeNull();
  });

  it("reads the pinned release from package.json", () => {
    expect(pinnedPackageVersion(shellPackage)).toBe("1.4.0");
    expect(pinnedPackageVersion(JSON.stringify({ dependencies: { next: "^15.5.27" } }))).toBeNull();
    expect(pinnedPackageVersion(null)).toBeNull();
    expect(pinnedPackageVersion("not json")).toBeNull();
  });

  it("keeps a range or other spec the artist pinned", () => {
    const pin = (spec: string) => JSON.stringify({ dependencies: { [MUSICIAN_SITE_PACKAGE]: spec } });
    expect(pinnedPackageVersion(pin("^1.2.0"))).toBe("^1.2.0");
    expect(pinnedPackageVersion(pin(">=1.2.0"))).toBe(">=1.2.0");
    expect(pinnedPackageVersion(pin("github:a/b"))).toBe("github:a/b");
  });

  it("is up to date on the target or a later release, and never downgrades", () => {
    expect(isOnOrPastRelease("1.4.0", "1.4.0")).toBe(true);
    // Dependabot moved the site past the platform's bundle.
    expect(isOnOrPastRelease("1.4.3", "1.4.0")).toBe(true);
    expect(isOnOrPastRelease("1.10.0", "1.9.0")).toBe(true);
    expect(isOnOrPastRelease("2.0.0", "1.9.9")).toBe(true);
    expect(isOnOrPastRelease("1.3.9", "1.4.0")).toBe(false);
    expect(isOnOrPastRelease("1.4.0", "1.4.3")).toBe(false);
    expect(isOnOrPastRelease("1.4.0", "1.5.0")).toBe(false);
    expect(isOnOrPastRelease("1.4.0", "2.0.0")).toBe(false);
    expect(isOnOrPastRelease(null, "1.4.0")).toBe(false);
  });

  it("reads a range by its lower bound, and a prerelease as behind its release", () => {
    expect(isOnOrPastRelease("^1.4.0", "1.4.0")).toBe(true);
    expect(isOnOrPastRelease("^1.2.0", "1.1.0")).toBe(true);
    expect(isOnOrPastRelease("~1.2.0", "1.3.0")).toBe(false);
    expect(isOnOrPastRelease("2.0.0-rc.1", "1.1.0")).toBe(true);
    expect(isOnOrPastRelease("2.0.0-rc.1", "2.0.0")).toBe(false);
    expect(isOnOrPastRelease("2.0.0", "2.0.0-rc.1")).toBe(true);
    expect(isOnOrPastRelease("2.0.0-rc.1", "2.0.0-rc.1")).toBe(true);
    expect(isOnOrPastRelease("2.0.0-rc.1", "2.0.0-rc.2")).toBe(false);
  });

  it("doesn't read an upper bound as a lower one", () => {
    expect(isOnOrPastRelease("<2.0.0", "1.1.0")).toBe(false);
    expect(isOnOrPastRelease("<=1.2.0", "1.1.0")).toBe(false);
  });

  it("matches a pin that isn't a release only to itself", () => {
    expect(isOnOrPastRelease("latest", "1.4.0")).toBe(false);
    expect(isOnOrPastRelease("github:a/b", "1.4.0")).toBe(false);
  });
});

describe("migrateCollections", () => {
  // The real chain is empty (every collection is on version 1), so only
  // target 1 is reachable: nothing is rewritten.
  it("rewrites nothing when the target is the version the content is on", () => {
    expect(
      migrateCollections([{ path: "src/content/pages/_collection.json", content: '{"schemaVersion":1}' }], 1),
    ).toEqual([]);
  });

  it("skips files that aren't collections or don't parse", () => {
    expect(
      migrateCollections(
        [
          { path: "src/content/pages/home.json", content: '{"schemaVersion":0}' },
          { path: "src/content/pages/_collection.json", content: "{" },
        ],
        1,
      ),
    ).toEqual([]);
  });

  it.each([0, 99, 1.5])("refuses target %s outside the chain", (target) => {
    expect(() => migrateCollections([], target)).toThrow(UnsupportedSchemaVersionError);
  });
});

describe("fetchTargetSchemaVersion", () => {
  it("reads stagecraft.schemaVersion from the release's registry metadata", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ stagecraft: { schemaVersion: 3 } })));
    expect(await fetchTargetSchemaVersion("1.4.0", { fetchImpl: fetchImpl as unknown as typeof fetch, registry: "https://r.test" })).toBe(3);
    expect(fetchImpl).toHaveBeenCalledWith("https://r.test/@jclaw-labs%2fmusician-site/1.4.0", expect.anything());
  });

  it("throws when the release carries no schemaVersion", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: "1.4.0" })));
    await expect(fetchTargetSchemaVersion("1.4.0", { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      "no stagecraft.schemaVersion",
    );
  });

  it("throws when the registry answers an error", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    await expect(fetchTargetSchemaVersion("1.4.0", { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow("HTTP 503");
  });
});

describe("overwrittenFiles", () => {
  const shell = [
    { path: "tsconfig.json", content: "shell" },
    { path: "src/app/layout.tsx", content: "layout" },
    { path: ".gitignore", content: "node_modules\n" },
    { path: "CLAUDE.md", content: "new" },
    { path: "package.json", content: "{}" },
  ];

  it("lists shell files written over a file that isn't ours as the baseline left it", () => {
    const current = tree({
      "tsconfig.json": "artist's",
      "src/app/layout.tsx": "old",
      ".gitignore": "node_modules\n",
      "CLAUDE.md": "notes",
      "package.json": '{"bumped":true}',
    });
    // tsconfig.json was ours and the artist changed it; CLAUDE.md is the
    // artist's own. package.json is never listed: a change beyond versions
    // stops the upgrade, and a version bump is what the shell replaces.
    const baseline = templatePushBaseline(tree({ "tsconfig.json": "{}", "src/app/layout.tsx": "old" }), current);
    expect(overwrittenFiles(current, baseline, shell)).toEqual(["CLAUDE.md", "tsconfig.json"]);
  });

  it("is empty when every written file is ours unchanged, identical, or new", () => {
    const current = tree({ "tsconfig.json": "{}", ".gitignore": "node_modules\n" });
    const baseline = templatePushBaseline(tree({ "tsconfig.json": "{}" }), current);
    expect(overwrittenFiles(current, baseline, shell)).toEqual([]);
  });
});

describe("the pull request", () => {
  it("recognizes its own commit message", () => {
    expect(isUpgradeCommitMessage(upgradeCommitMessage("1.4.0"))).toBe(true);
    expect(isUpgradeCommitMessage("Fix the build")).toBe(false);
    expect(isUpgradeCommitMessage(`${upgradeCommitMessage("1.4.0")}\n\nplus my fix`)).toBe(false);
  });

  it("lists shell files that replace the artist's changes", () => {
    const body = upgradePullRequestBody({
      packageVersion: "1.4.0",
      deletedCount: 1,
      migratedFiles: [],
      addsWorkflow: false,
      removesLockfile: false,
      overwrittenFiles: ["tsconfig.json"],
    });
    expect(body).toContain("This file was changed in your repository");
    expect(body).toContain("- `tsconfig.json`");
  });

  it("names the release in the title", () => {
    expect(upgradePullRequestTitle("1.4.0")).toBe("Upgrade to @jclaw-labs/musician-site 1.4.0");
  });

  it("describes a shell-only upgrade without asking about drafts", () => {
    const body = upgradePullRequestBody({ packageVersion: "1.4.0", deletedCount: 1, migratedFiles: [], addsWorkflow: false, removesLockfile: false });
    expect(body).toContain("1 file of Stagecraft's code is deleted");
    expect(body).not.toContain("Before you merge");
    expect(body).not.toContain("lockfile");
    expect(body).not.toContain("changed in your repository");
  });

  it("lists rewritten content and asks for pending edits to be published first", () => {
    const body = upgradePullRequestBody({
      packageVersion: "2.0.0",
      deletedCount: 120,
      migratedFiles: ["src/content/shows/_collection.json"],
      addsWorkflow: true,
      removesLockfile: true,
    });
    expect(body).toContain("120 files of Stagecraft's code are deleted");
    expect(body).toContain("- `src/content/shows/_collection.json`");
    expect(body).toContain("**Before you merge, publish or discard any edits");
    expect(body).toContain("which your repository didn't have");
    expect(body).toContain("lockfile is deleted");
  });
});
