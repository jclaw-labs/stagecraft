import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectShellFiles,
  collectSiteFiles,
  collectTemplateFiles,
  fetchLatestVersion,
  fetchReleasedShellDigest,
  generateTemplateBundle,
  LATEST_OVERRIDE_ENV,
  NPM_REGISTRY,
  resolveSitePackageVersion,
  SHELL_DIR,
  shellDigest,
  shellSitePackageJson,
  sitePackageVersion,
  STARTER_CONTENT_DIR,
  sitePackageJson,
  TEST_FILE,
  TEST_ONLY_DEV_DEPENDENCIES,
} from "./generate-template-bundle.mjs";

const REAL_TEMPLATE_DIR = path.resolve(__dirname, "../../../templates/musician-site");

let root: string;

async function write(relativePath: string, content = relativePath) {
  const full = path.join(root, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "template-bundle-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("collectTemplateFiles", () => {
  it("returns nested text files with posix relative paths, sorted", async () => {
    await write("src/b.ts", "b");
    await write("package.json", "{}");
    await write("src/app/a.tsx", "a");

    expect(await collectTemplateFiles(root)).toEqual([
      { path: "package.json", content: sitePackageJson("{}") },
      { path: "src/app/a.tsx", content: "a" },
      { path: "src/b.ts", content: "b" },
    ]);
  });

  it("skips excluded directories at any depth", async () => {
    await write("keep.ts");
    for (const dir of ["node_modules", "dist", ".next", ".turbo", ".git", "tests", "scripts", "e2e", "capture", "__snapshots__"]) {
      await write(`${dir}/x.ts`);
      await write(`src/${dir}/y.ts`);
    }

    expect((await collectTemplateFiles(root)).map((f) => f.path)).toEqual(["keep.ts"]);
  });

  it("skips excluded files by name, including in subdirectories", async () => {
    await write("keep.ts");
    for (const file of [
      "package-lock.json",
      "playwright.config.ts",
      "playwright.capture.config.ts",
      "vitest.config.ts",
      "vitest.setup.ts",
      "CLAUDE.md",
      "EDITING.md",
      "README.md",
      "CHANGELOG.md",
      "tsconfig.build.json",
      "test-fixtures.ts",
    ]) {
      await write(file);
      await write(`docs/${file}`);
    }

    expect((await collectTemplateFiles(root)).map((f) => f.path)).toEqual(["keep.ts"]);
  });

  it("skips test files wherever they sit", async () => {
    await write("keep.ts");
    await write("src/testing.ts");
    for (const file of ["a.test.ts", "src/b.test.tsx", "src/lib/c.test.mjs", "next.config.test.ts", "src/d.spec.ts"]) {
      await write(file);
    }

    expect((await collectTemplateFiles(root)).map((f) => f.path)).toEqual(["keep.ts", "src/testing.ts"]);
  });

  it("skips binary extensions case-insensitively", async () => {
    await write("keep.css");
    await write("public/logo.png");
    await write("public/LOGO.SVG");
    await write("fonts/a.woff2");

    expect((await collectTemplateFiles(root)).map((f) => f.path)).toEqual(["keep.css"]);
  });

  it("rejects a missing template directory", async () => {
    await expect(collectTemplateFiles(path.join(root, "missing"))).rejects.toThrow();
  });
});

describe("sitePackageJson", () => {
  const PACKAGE = {
    name: "@jclaw-labs/musician-site",
    version: "1.0.0",
    description: "The package",
    type: "module",
    repository: { type: "git", url: "git+https://example.com/x.git" },
    imports: { "#lib/*": { source: "./src/lib/*", default: "./dist/lib/*" } },
    exports: { "./*": "./dist/*.js" },
    files: ["dist"],
    bin: { "stagecraft-site": "./dist/cli/stagecraft-site.js" },
    scripts: {
      build: "next build",
      "build:package": "node scripts/build-package.mjs",
      prepublishOnly: "node scripts/prepublish-guard.mjs",
      test: "vitest run",
      "test:e2e": "playwright test",
      "capture:screenshots": "playwright test --config playwright.capture.config.ts",
      "refresh:demo": "node scripts/refresh-demo-content.mjs",
    },
    peerDependencies: { next: ">=15.5.27 <16", react: "^19.0.0" },
    dependencies: { zod: "4.4.2", "@jclaw-labs/content-upgraders": "file:../../packages/content-upgraders" },
    devDependencies: { next: "^15.5.27", typescript: "^5.7.0", vitest: "^4.0.0", "@playwright/test": "^1.59.1" },
  };

  const site = JSON.parse(sitePackageJson(JSON.stringify(PACKAGE)));

  it("makes a private app named musician-site", () => {
    expect(site.name).toBe("musician-site");
    expect(site.private).toBe(true);
    expect(Object.keys(site).slice(0, 2)).toEqual(["name", "private"]);
  });

  it("drops the publish-only fields and the scripts a site can't run, keeping the build", () => {
    for (const field of ["exports", "files", "bin", "repository", "description", "peerDependencies"]) {
      expect(site).not.toHaveProperty(field);
    }
    expect(site.scripts).toEqual({ build: "next build" });
  });

  it("points imports at src/, since a site has no dist/", () => {
    expect(site.imports).toEqual({ "#lib/*": { source: "./src/lib/*", default: "./src/lib/*" } });
  });

  it("moves peers into dependencies, preferring the dev range, and points file: deps at the vendored copy", () => {
    expect(site.dependencies).toEqual({
      "@jclaw-labs/content-upgraders": "file:./vendor/content-upgraders",
      next: "^15.5.27",
      react: "^19.0.0",
      zod: "^4.4.2",
    });
    expect(site.devDependencies).toEqual({ typescript: "^5.7.0" });
  });

  it("drops the test-only dev dependencies", () => {
    for (const name of TEST_ONLY_DEV_DEPENDENCIES) expect(site.devDependencies).not.toHaveProperty(name);
  });

  it("turns exact runtime pins back into ^ ranges and leaves other specs alone", () => {
    const deps = JSON.parse(
      sitePackageJson(
        JSON.stringify({
          dependencies: { a: "1.2.3", b: "1.0.0-rc.0", c: "^2.0.0", d: "~3.1.0", e: ">=4 <5", f: "github:x/y" },
        }),
      ),
    ).dependencies;
    expect(deps).toEqual({ a: "^1.2.3", b: "^1.0.0-rc.0", c: "^2.0.0", d: "~3.1.0", e: ">=4 <5", f: "github:x/y" });
  });

  it("ends with a newline", () => {
    expect(sitePackageJson("{}").endsWith("}\n")).toBe(true);
  });

  it("reads the real template as an app that installs outside the monorepo", async () => {
    const files = await collectTemplateFiles(REAL_TEMPLATE_DIR);
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content);
    expect(pkg.dependencies.next).toBeDefined();
    const paths = new Set(files.map((f) => f.path));
    for (const spec of Object.values(pkg.dependencies) as string[]) {
      if (!spec.startsWith("file:")) {
        expect(spec).toMatch(/^\^/);
        continue;
      }
      // A file: dependency names a directory the copy vendors, with its entry.
      const dir = spec.slice("file:./".length);
      const vendored = JSON.parse(files.find((f) => f.path === `${dir}/package.json`)!.content);
      expect(paths).toContain(`${dir}/${vendored.exports["."].replace(/^\.\//, "")}`);
    }
    for (const target of Object.values(pkg.imports) as { default: string }[]) expect(target.default).toMatch(/^\.\/src\//);
  });

  it("copies no file that imports a dropped test-only dev dependency", async () => {
    const files = await collectTemplateFiles(REAL_TEMPLATE_DIR);
    const importsDropped = new RegExp(
      `(?:from\\s+|import\\s*\\(?\\s*|require\\s*\\(\\s*|types=)["'](?:${TEST_ONLY_DEV_DEPENDENCIES.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})(?:/[^"']*)?["']`,
    );
    expect(files.filter((f) => importsDropped.test(f.content)).map((f) => f.path)).toEqual([]);
    expect(files.some((f) => /(?:^|\/)(?:e2e|capture)\//.test(f.path))).toBe(false);
  });

  it("ships the real site without test tooling in its dev dependencies", async () => {
    // Literal patterns, not TEST_ONLY_DEV_DEPENDENCIES, so a name dropped from
    // that list, or new test tooling added to the template, fails here (#473).
    const files = await collectTemplateFiles(REAL_TEMPLATE_DIR);
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content);
    const testTooling =
      /^(?:vitest|@vitest\/.+|vite|@vitejs\/.+|@playwright\/test|playwright|jsdom|happy-dom|msw|@testing-library\/.+)$/;
    expect(Object.keys(pkg.devDependencies ?? {}).filter((name) => testTooling.test(name))).toEqual([]);
  });

  it("keeps every script the site's package.json lists runnable from the copied files", async () => {
    const files = await collectTemplateFiles(REAL_TEMPLATE_DIR);
    const paths = new Set(files.map((f) => f.path));
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content);
    for (const command of Object.values(pkg.scripts) as string[]) {
      for (const file of command.match(/\S+\.(?:m?js|ts)\b/g) ?? []) expect(paths, command).toContain(file);
    }
  });
});

describe("vendoredPackageFiles", () => {
  it("vendors every non-test source file of the real template's file: packages", async () => {
    const files = await collectTemplateFiles(REAL_TEMPLATE_DIR);
    const { dependencies } = JSON.parse(await fs.readFile(path.join(REAL_TEMPLATE_DIR, "package.json"), "utf-8"));
    const fileDeps = Object.values(dependencies as Record<string, string>).filter((spec) => spec.startsWith("file:"));
    expect(fileDeps.length).toBeGreaterThan(0);
    for (const spec of fileDeps) {
      const srcDir = path.join(path.resolve(REAL_TEMPLATE_DIR, spec.slice("file:".length)), "src");
      const sources = (await fs.readdir(srcDir, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile() && !TEST_FILE.test(entry.name))
        .map((entry) => path.relative(srcDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
        .sort();
      expect(sources.length).toBeGreaterThan(0);
      const prefix = `vendor/${path.basename(spec)}/src/`;
      const vendored = files.filter((f) => f.path.startsWith(prefix)).map((f) => f.path.slice(prefix.length));
      expect(vendored).toEqual(sources);
    }
  });

  it("refuses two file: packages that would vendor to the same directory", async () => {
    for (const dir of ["a/up", "b/up"]) {
      await write(`${dir}/package.json`, JSON.stringify({ name: `@x/${dir.replace("/", "-")}`, exports: { ".": { source: "./src/index.ts" } } }));
      await write(`${dir}/src/index.ts`, "export {};");
    }
    await write("template/package.json", JSON.stringify({ dependencies: { "@x/a": "file:../a/up", "@x/b": "file:../b/up" } }));
    await expect(collectTemplateFiles(path.join(root, "template"))).rejects.toThrow(/both vendor to vendor\/up/);
  });

  it("vendors each file: package's src/ and a source-only package.json, without tests", async () => {
    await write("packages/up/package.json", JSON.stringify({
      name: "@x/up",
      version: "1.2.3",
      type: "module",
      exports: { ".": { source: "./src/index.ts", default: "./dist/index.js" } },
      scripts: { build: "tsc" },
    }));
    await write("packages/up/src/index.ts", "export const a = 1;");
    await write("packages/up/src/index.test.ts", "test");
    await write("packages/up/dist/index.js", "built");
    await write("template/package.json", JSON.stringify({ dependencies: { "@x/up": "file:../packages/up", zod: "1.0.0" } }));
    await write("template/src/page.ts", "page");

    const files = await collectTemplateFiles(path.join(root, "template"));
    expect(files.map((f) => f.path)).toEqual([
      "package.json",
      "src/page.ts",
      "vendor/up/package.json",
      "vendor/up/src/index.ts",
    ]);
    expect(JSON.parse(files[2].content)).toEqual({
      name: "@x/up",
      version: "1.2.3",
      private: true,
      type: "module",
      exports: { ".": "./src/index.ts" },
    });
    expect(JSON.parse(files[0].content).dependencies["@x/up"]).toBe("file:./vendor/up");
  });

  it("refuses a file: package without a source export", async () => {
    await write("packages/up/package.json", JSON.stringify({ name: "@x/up", exports: { ".": "./dist/index.js" } }));
    await write("template/package.json", JSON.stringify({ dependencies: { "@x/up": "file:../packages/up" } }));
    await expect(collectTemplateFiles(path.join(root, "template"))).rejects.toThrow(/no "source" export/);
  });
});

describe("collectSiteFiles", () => {
  it("adds the starter content under src/content/, sorted with the template's files", async () => {
    await write("template/package.json", '{"name":"t"}');
    await write("template/src/page.tsx", "export default 1;");
    await write("content/collections/pages/items/home.json", "{}");
    await write("content/collections/pages/items/home.test.ts", "skipped");

    expect(await collectSiteFiles(path.join(root, "template"), path.join(root, "content"))).toEqual([
      { path: "package.json", content: sitePackageJson('{"name":"t"}') },
      { path: "src/content/collections/pages/items/home.json", content: "{}" },
      { path: "src/page.tsx", content: "export default 1;" },
    ]);
  });

  it("refuses a template with content of its own", async () => {
    await write("template/src/content/collections/pages/_collection.json", "{}");
    await write("content/collections/pages/_collection.json", "{}");

    await expect(collectSiteFiles(path.join(root, "template"), path.join(root, "content"))).rejects.toThrow(
      /has src\/content\/collections\/pages\/_collection\.json; starter content belongs in .*set STAGECRAFT_CONTENT_DIR/,
    );
  });

  it("refuses missing or empty starter content", async () => {
    await write("template/package.json", '{"name":"t"}');
    await expect(collectSiteFiles(path.join(root, "template"), path.join(root, "missing"))).rejects.toThrow();
    await fs.mkdir(path.join(root, "content"));
    await expect(collectSiteFiles(path.join(root, "template"), path.join(root, "content"))).rejects.toThrow(
      /No starter content/,
    );
  });

  it("ships the shell's starter content with the real template", async () => {
    const files = await collectSiteFiles(REAL_TEMPLATE_DIR, STARTER_CONTENT_DIR);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/content/collections/pages/_collection.json");
    expect(paths).toContain("src/content/collections/pages/items/home.json");
    expect(STARTER_CONTENT_DIR).toBe(path.resolve(__dirname, "../../../templates/musician-site-shell/src/content"));
  });
});

describe("generateTemplateBundle", () => {
  async function content() {
    await write("content/collections/pages/items/home.json", "{}");
    return path.join(root, "content");
  }
  const HOME = { path: "src/content/collections/pages/items/home.json", content: "{}" };

  it("writes the collected files as JSON and reports sizes", async () => {
    await write("template/package.json", '{"name":"t"}');
    await write("template/src/page.tsx", "export default 1;");
    const outFile = path.join(root, "out/nested/bundle.json");

    const result = await generateTemplateBundle({
      templateDir: path.join(root, "template"),
      contentDir: await content(),
      outFile,
    });

    const written = await fs.readFile(outFile, "utf-8");
    expect(JSON.parse(written)).toEqual([
      { path: "package.json", content: sitePackageJson('{"name":"t"}') },
      HOME,
      { path: "src/page.tsx", content: "export default 1;" },
    ]);
    expect(result).toEqual({
      fileCount: 3,
      bytes: Buffer.byteLength(written),
      gzipBytes: gzipSync(Buffer.from(written)).length,
    });
  });

  it("replaces an existing bundle by rename, leaving no temp file behind", async () => {
    await write("template/package.json", '{"name":"t"}');
    const outFile = path.join(root, "out/bundle.json");
    await write("out/bundle.json", "stale");
    const staleInode = (await fs.stat(outFile)).ino;

    await generateTemplateBundle({ templateDir: path.join(root, "template"), contentDir: await content(), outFile });

    expect((await fs.stat(outFile)).ino).not.toBe(staleInode);
    expect(JSON.parse(await fs.readFile(outFile, "utf-8"))).toEqual([
      { path: "package.json", content: sitePackageJson('{"name":"t"}') },
      HOME,
    ]);
    expect(await fs.readdir(path.dirname(outFile))).toEqual(["bundle.json"]);
  });

  it("throws rather than writing an empty bundle", async () => {
    await write("template/logo.png");
    const outFile = path.join(root, "bundle.json");

    await expect(
      generateTemplateBundle({ templateDir: path.join(root, "template"), contentDir: await content(), outFile }),
    ).rejects.toThrow(/No template files/);
    await expect(fs.access(outFile)).rejects.toThrow();
  });
});

const PACKAGE = "@jclaw-labs/musician-site";

const SHELL_PACKAGE = {
  name: "musician-site",
  version: "0.0.1",
  private: true,
  stagecraft: { shellVersion: 1 },
  dependencies: { [PACKAGE]: "file:../musician-site", next: "^15.5.27" },
  overrides: { "@jclaw-labs/content-upgraders": "file:../../packages/content-upgraders" },
};

describe("shellSitePackageJson", () => {
  it("pins the package to the exact version and drops the monorepo-only overrides", () => {
    const site = JSON.parse(shellSitePackageJson(JSON.stringify(SHELL_PACKAGE), PACKAGE, "1.2.3"));
    const { overrides: _overrides, ...rest } = SHELL_PACKAGE;
    expect(site).toEqual({ ...rest, dependencies: { [PACKAGE]: "1.2.3", next: "^15.5.27" } });
  });

  it("ends with a newline", () => {
    expect(shellSitePackageJson(JSON.stringify(SHELL_PACKAGE), PACKAGE, "1.2.3").endsWith("}\n")).toBe(true);
  });

  it("refuses a prerelease, a range or a tag", () => {
    for (const version of ["1.0.0-rc.0", "^1.2.3", "latest", "1.2", "1.2.3+build.1"]) {
      expect(() => shellSitePackageJson(JSON.stringify(SHELL_PACKAGE), PACKAGE, version)).toThrow(/only pins a release/);
    }
  });

  it("refuses a shell that doesn't depend on the package through file:", () => {
    const pinned = { ...SHELL_PACKAGE, dependencies: { [PACKAGE]: "1.0.0" } };
    expect(() => shellSitePackageJson(JSON.stringify(pinned), PACKAGE, "1.2.3")).toThrow(/through file:/);
    expect(() => shellSitePackageJson("{}", PACKAGE, "1.2.3")).toThrow(/through file:/);
  });
});

describe("collectShellFiles", () => {
  it("returns the shell's files with package.json pinned, without monorepo-only or test files", async () => {
    await write("shell/package.json", JSON.stringify(SHELL_PACKAGE));
    await write("shell/.npmrc", "install-links=true");
    await write("shell/CLAUDE.md", "notes");
    await write("shell/next.config.ts", "config");
    await write("shell/src/app/layout.tsx", "layout");
    await write("shell/src/app/layout.test.tsx", "test");
    await write("shell/src/content/collections/pages/items/home.json", "{}");
    await write("shell/node_modules/x/index.js", "dep");
    await write("shell/.next/cache.json", "{}");

    const files = await collectShellFiles(path.join(root, "shell"), PACKAGE, "2.0.0");
    expect(files.map((f) => f.path)).toEqual([
      "next.config.ts",
      "package.json",
      "src/app/layout.tsx",
      "src/content/collections/pages/items/home.json",
    ]);
    expect(JSON.parse(files[1].content).dependencies[PACKAGE]).toBe("2.0.0");
  });

  it("refuses a shell without package.json or starter content", async () => {
    await write("shell/next.config.ts", "config");
    await expect(collectShellFiles(path.join(root, "shell"), PACKAGE, "2.0.0")).rejects.toThrow(/No package\.json/);
    await write("shell/package.json", JSON.stringify(SHELL_PACKAGE));
    await expect(collectShellFiles(path.join(root, "shell"), PACKAGE, "2.0.0")).rejects.toThrow(/No starter content/);
  });

  it("reads the real shell as a site on the published package", async () => {
    const templatePackage = JSON.parse(await fs.readFile(path.join(REAL_TEMPLATE_DIR, "package.json"), "utf-8"));
    const files = await collectShellFiles(SHELL_DIR, templatePackage.name, "1.0.0");
    const paths = files.map((f) => f.path);
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content);

    expect(pkg.dependencies[templatePackage.name]).toBe("1.0.0");
    expect(pkg).not.toHaveProperty("overrides");
    expect(Object.values(pkg.dependencies).some((spec) => String(spec).startsWith("file:"))).toBe(false);
    expect(pkg.stagecraft.shellVersion).toEqual(expect.any(Number));
    for (const file of ["next.config.ts", "src/middleware.ts", "src/app/layout.tsx", "src/app/api/[...path]/route.ts"]) {
      expect(paths).toContain(file);
    }
    expect(paths).toContain("src/content/collections/pages/_collection.json");
    expect(paths).not.toContain(".npmrc");
    expect(paths).not.toContain("CLAUDE.md");
    // Nothing of the package's own source comes along: the site installs it.
    expect(paths.some((p) => /^(?:src\/(?:lib|components|puck)|vendor)\//.test(p))).toBe(false);
  });
});

describe("sitePackageVersion", () => {
  it("pins the release on latest", () => {
    expect(sitePackageVersion(PACKAGE, "1.4.0")).toEqual({ version: "1.4.0", reason: `${PACKAGE}@1.4.0 is on latest` });
  });

  it("refuses a prerelease, even on latest", () => {
    expect(sitePackageVersion(PACKAGE, "1.0.0-rc.0")).toEqual({
      version: null,
      reason: `refusing ${PACKAGE}@1.0.0-rc.0 on latest: it's a prerelease`,
    });
  });

  it("bundles the full template when nothing is on latest", () => {
    expect(sitePackageVersion(PACKAGE, null).version).toBeNull();
  });
});

describe("shellDigest", () => {
  it("is stable, and changes with any shipped shell file but not the monorepo-only ones", async () => {
    await write("shell/package.json", "{}");
    await write("shell/src/app/layout.tsx", "a");
    const shell = path.join(root, "shell");
    const first = await shellDigest(shell);
    expect(await shellDigest(shell)).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    await write("shell/.npmrc", "x");
    await write("shell/CLAUDE.md", "x");
    await write("shell/node_modules/x/index.js", "x");
    expect(await shellDigest(shell)).toBe(first);

    await write("shell/src/app/layout.tsx", "b");
    expect(await shellDigest(shell)).not.toBe(first);
  });
});

describe("fetchLatestVersion", () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  it("reads latest from the abbreviated packument", async () => {
    const { calls, impl } = fakeFetch(200, { name: PACKAGE, "dist-tags": { latest: "1.2.3", rc: "1.3.0-rc.0" } });
    expect(await fetchLatestVersion(PACKAGE, { fetchImpl: impl })).toBe("1.2.3");
    expect(calls[0].url).toBe(`${NPM_REGISTRY}/@jclaw-labs%2fmusician-site`);
    expect(new Headers(calls[0].init?.headers).get("accept")).toBe("application/vnd.npm.install-v1+json");
  });

  it("is null for a package the registry doesn't have, or one without latest", async () => {
    expect(await fetchLatestVersion(PACKAGE, { fetchImpl: fakeFetch(404, { error: "Not found" }).impl })).toBeNull();
    expect(await fetchLatestVersion(PACKAGE, { fetchImpl: fakeFetch(200, { "dist-tags": {} }).impl })).toBeNull();
    expect(await fetchLatestVersion(PACKAGE, { fetchImpl: fakeFetch(200, {}).impl })).toBeNull();
  });

  it("fails on any other registry error, naming the override", async () => {
    await expect(fetchLatestVersion(PACKAGE, { fetchImpl: fakeFetch(503, {}).impl })).rejects.toThrow(
      new RegExp(`HTTP 503.*${LATEST_OVERRIDE_ENV}`),
    );
  });

  it("fails when the registry can't be reached, naming the override", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchLatestVersion(PACKAGE, { fetchImpl: offline })).rejects.toThrow(
      new RegExp(`fetch failed.*${LATEST_OVERRIDE_ENV}`),
    );
  });
});

describe("fetchReleasedShellDigest", () => {
  it("reads stagecraft.shellDigest from the version's manifest", async () => {
    const urls: string[] = [];
    const impl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ version: "1.2.3", stagecraft: { schemaVersion: 1, shellDigest: "abc" } }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchReleasedShellDigest(PACKAGE, "1.2.3", { fetchImpl: impl })).toBe("abc");
    expect(urls).toEqual([`${NPM_REGISTRY}/@jclaw-labs%2fmusician-site/1.2.3`]);
  });

  it("is null for a version that isn't there or carries no digest", async () => {
    const respond = (status: number, body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await fetchReleasedShellDigest(PACKAGE, "1.2.3", { fetchImpl: respond(404, {}) })).toBeNull();
    expect(await fetchReleasedShellDigest(PACKAGE, "1.2.3", { fetchImpl: respond(200, { stagecraft: {} }) })).toBeNull();
  });

  it("fails on a registry error, naming the override", async () => {
    const impl = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchReleasedShellDigest(PACKAGE, "1.2.3", { fetchImpl: impl })).rejects.toThrow(
      new RegExp(`HTTP 500.*${LATEST_OVERRIDE_ENV}`),
    );
  });
});

describe("resolveSitePackageVersion", () => {
  const noFetch = (async () => {
    throw new Error("fetch called");
  }) as unknown as typeof fetch;

  /** A registry with `latest` on `version`, released with `digest` (or none). */
  function registry(version: string, digest: string | undefined) {
    const urls: string[] = [];
    const impl = (async (url: string) => {
      urls.push(url);
      const body = url.endsWith(`/${version}`)
        ? { version, stagecraft: digest === undefined ? {} : { shellDigest: digest } }
        : { "dist-tags": { latest: version } };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    return { urls, impl };
  }

  async function shell(layout = "a") {
    await write("shell/package.json", "{}");
    await write("shell/src/app/layout.tsx", layout);
    return path.join(root, "shell");
  }

  it("takes latest from the override without asking the registry, with this checkout's shell", async () => {
    expect(
      await resolveSitePackageVersion({ env: { [LATEST_OVERRIDE_ENV]: "2.0.0" }, fetchImpl: noFetch }),
    ).toEqual({ packageName: PACKAGE, version: "2.0.0", reason: `${PACKAGE}@2.0.0 is on latest` });
  });

  it("treats an empty override as nothing on latest", async () => {
    expect((await resolveSitePackageVersion({ env: { [LATEST_OVERRIDE_ENV]: " " }, fetchImpl: noFetch })).version).toBeNull();
  });

  it("refuses an override that isn't a version", async () => {
    await expect(resolveSitePackageVersion({ env: { [LATEST_OVERRIDE_ENV]: "v1.0.0" }, fetchImpl: noFetch })).rejects.toThrow(
      new RegExp(`${LATEST_OVERRIDE_ENV} must be a version`),
    );
  });

  it("pins the release on latest when it was released with this checkout's shell", async () => {
    const shellDir = await shell();
    const { urls, impl } = registry("1.4.0", await shellDigest(shellDir));
    expect(await resolveSitePackageVersion({ shellDir, env: {}, fetchImpl: impl })).toEqual({
      packageName: PACKAGE,
      version: "1.4.0",
      reason: `${PACKAGE}@1.4.0 is on latest`,
    });
    expect(urls).toEqual([`${NPM_REGISTRY}/@jclaw-labs%2fmusician-site`, `${NPM_REGISTRY}/@jclaw-labs%2fmusician-site/1.4.0`]);
  });

  it("bundles the full template when the shell changed since the release on latest", async () => {
    const released = await shellDigest(await shell("a"));
    const shellDir = await shell("b");
    const resolved = await resolveSitePackageVersion({ shellDir, env: {}, fetchImpl: registry("1.4.0", released).impl });
    expect(resolved).toEqual({
      packageName: PACKAGE,
      version: null,
      reason: `${PACKAGE}@1.4.0 is on latest, but it was released with a different shell from this checkout's`,
    });
  });

  it("bundles the full template when the release on latest carries no shell digest", async () => {
    const resolved = await resolveSitePackageVersion({ shellDir: await shell(), env: {}, fetchImpl: registry("1.4.0", undefined).impl });
    expect(resolved.version).toBeNull();
  });

  it("asks the registry for the template package's latest, and refuses a prerelease there", async () => {
    const { urls, impl } = registry("1.0.0-rc.0", "x");
    const resolved = await resolveSitePackageVersion({ env: {}, fetchImpl: impl });
    expect(resolved.packageName).toBe(PACKAGE);
    expect(resolved.version).toBeNull();
    expect(urls).toEqual([`${NPM_REGISTRY}/@jclaw-labs%2fmusician-site`]);
  });
});

describe("generateTemplateBundle with a release on latest", () => {
  it("bundles the shell pinned to that release instead of the template", async () => {
    await write("template/package.json", '{"name":"t"}');
    await write("template/src/page.tsx", "export default 1;");
    await write("content/collections/pages/items/home.json", "{}");
    await write("shell/package.json", JSON.stringify(SHELL_PACKAGE));
    await write("shell/src/app/layout.tsx", "layout");
    await write("shell/src/content/collections/pages/items/home.json", "{}");
    const outFile = path.join(root, "bundle.json");

    const result = await generateTemplateBundle({
      templateDir: path.join(root, "template"),
      contentDir: path.join(root, "content"),
      shellDir: path.join(root, "shell"),
      outFile,
      sitePackage: { packageName: PACKAGE, version: "3.1.0" },
    });

    const files = JSON.parse(await fs.readFile(outFile, "utf-8"));
    expect(files.map((f: { path: string }) => f.path)).toEqual([
      "package.json",
      "src/app/layout.tsx",
      "src/content/collections/pages/items/home.json",
    ]);
    expect(JSON.parse(files[0].content).dependencies[PACKAGE]).toBe("3.1.0");
    expect(result.fileCount).toBe(3);
  });
});
