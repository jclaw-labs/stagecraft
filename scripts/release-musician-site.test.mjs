import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  diffFileTrees,
  distTagFor,
  gitTagFor,
  isPublished,
  NPM_REGISTRY,
  planRelease,
  PRERELEASE_DIST_TAG,
} from "./release-musician-site.mjs";

describe("distTagFor", () => {
  it("sends a release to latest and any prerelease to rc", () => {
    expect(distTagFor("1.2.3")).toBe("latest");
    expect(distTagFor("1.0.0-rc.0")).toBe(PRERELEASE_DIST_TAG);
    expect(distTagFor("2.0.0-beta.1")).toBe("rc");
    expect(PRERELEASE_DIST_TAG).toBe("rc");
  });

  it("refuses anything that isn't a plain version", () => {
    for (const version of ["", "1.2", "v1.2.3", "^1.2.3", "1.2.3+build", "latest"]) {
      expect(() => distTagFor(version)).toThrow(/Not a version/);
    }
  });
});

describe("gitTagFor", () => {
  it("prefixes the version", () => {
    expect(gitTagFor("1.0.0-rc.0")).toBe("musician-site@1.0.0-rc.0");
  });
});

describe("isPublished", () => {
  const fetchWith = (status, urls = []) =>
    async (url) => {
      urls.push(url);
      return new Response("{}", { status });
    };

  it("asks the registry for the exact version", async () => {
    const urls = [];
    expect(await isPublished("@jclaw-labs/content-upgraders", "1.0.0-rc.0", { fetchImpl: fetchWith(200, urls) })).toBe(true);
    expect(urls).toEqual([`${NPM_REGISTRY}/@jclaw-labs%2fcontent-upgraders/1.0.0-rc.0`]);
  });

  it("is false on 404 and throws on any other status", async () => {
    expect(await isPublished("@x/y", "1.0.0", { fetchImpl: fetchWith(404) })).toBe(false);
    await expect(isPublished("@x/y", "1.0.0", { fetchImpl: fetchWith(500) })).rejects.toThrow(/HTTP 500/);
  });
});

describe("planRelease", () => {
  const template = { name: "@jclaw-labs/musician-site", version: "1.1.0" };
  const upgraders = { name: "@jclaw-labs/content-upgraders", version: "1.1.0" };

  it("publishes a version npm doesn't have yet", async () => {
    expect(
      await planRelease({ template, upgraders, published: async () => false, tagged: () => false }),
    ).toEqual({
      version: "1.1.0",
      dist_tag: "latest",
      git_tag: "musician-site@1.1.0",
      publish: true,
      upgraders_published: false,
      tagged: false,
    });
  });

  it("skips publishing the template when its version is on npm, and reports the upgraders separately", async () => {
    const onNpm = new Set(["@jclaw-labs/content-upgraders@1.1.0"]);
    const plan = await planRelease({
      template,
      upgraders,
      published: async (name, version) => onNpm.has(`${name}@${version}`),
      tagged: (tag) => tag === "musician-site@1.1.0",
    });
    expect(plan).toMatchObject({ publish: true, upgraders_published: true, tagged: true });

    onNpm.add("@jclaw-labs/musician-site@1.1.0");
    expect(
      await planRelease({ template, upgraders, published: async (n, v) => onNpm.has(`${n}@${v}`), tagged: () => false }),
    ).toMatchObject({ publish: false, tagged: false });
  });

  it("sends a release candidate to rc", async () => {
    const plan = await planRelease({
      template: { ...template, version: "2.0.0-rc.1" },
      upgraders: { ...upgraders, version: "2.0.0-rc.1" },
      published: async () => false,
      tagged: () => false,
    });
    expect(plan.dist_tag).toBe("rc");
  });

  it("refuses versions out of lockstep, or the wrong upgraders package", async () => {
    const args = { published: async () => false, tagged: () => false };
    await expect(planRelease({ template, upgraders: { ...upgraders, version: "1.0.0" }, ...args })).rejects.toThrow(
      /must share a version/,
    );
    await expect(planRelease({ template, upgraders: { ...upgraders, name: "@x/other" }, ...args })).rejects.toThrow(
      /Expected @jclaw-labs\/content-upgraders/,
    );
  });
});

describe("diffFileTrees", () => {
  let root;
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "diff-trees-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("is empty for the same files, whatever their timestamps", () => {
    write("a/package/package.json", "{}");
    write("a/package/dist/index.js", "x");
    write("b/package/package.json", "{}");
    write("b/package/dist/index.js", "x");
    fs.utimesSync(path.join(root, "b/package/dist/index.js"), new Date(0), new Date(0));
    expect(diffFileTrees(path.join(root, "a"), path.join(root, "b"))).toEqual([]);
  });

  it("lists missing, extra and changed files", () => {
    write("pub/package/package.json", "{}");
    write("pub/package/dist/old.js", "old");
    write("pub/package/dist/index.js", "x");
    write("loc/package/package.json", "{}");
    write("loc/package/dist/new.js", "new");
    write("loc/package/dist/index.js", "y");
    expect(diffFileTrees(path.join(root, "pub"), path.join(root, "loc"))).toEqual([
      "differs: package/dist/index.js",
      "only in the local pack: package/dist/new.js",
      "only in the published package: package/dist/old.js",
    ]);
  });
});
