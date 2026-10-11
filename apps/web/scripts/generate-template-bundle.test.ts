import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectTemplateFiles,
  generateTemplateBundle,
  sitePackageJson,
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
      "tsconfig.build.json",
    ]) {
      await write(file);
      await write(`docs/${file}`);
    }

    expect((await collectTemplateFiles(root)).map((f) => f.path)).toEqual(["keep.ts"]);
  });

  it("skips test files wherever they sit", async () => {
    await write("keep.ts");
    await write("src/testing.ts");
    for (const file of ["a.test.ts", "src/b.test.tsx", "src/lib/c.test.mjs", "next.config.test.ts"]) await write(file);

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

  it("moves peers into dependencies, preferring the dev range, and drops file: deps", () => {
    expect(site.dependencies).toEqual({ next: "^15.5.27", react: "^19.0.0", zod: "^4.4.2" });
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
    expect(Object.values(pkg.dependencies).some((spec) => String(spec).startsWith("file:"))).toBe(false);
    for (const spec of Object.values(pkg.dependencies)) expect(spec).toMatch(/^\^/);
    for (const target of Object.values(pkg.imports) as { default: string }[]) expect(target.default).toMatch(/^\.\/src\//);
  });

  it("copies no file that imports a dropped test-only dev dependency", async () => {
    const files = await collectTemplateFiles(REAL_TEMPLATE_DIR);
    const importsDropped = new RegExp(
      `from\\s+["'](?:${TEST_ONLY_DEV_DEPENDENCIES.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})(?:/[^"']*)?["']`,
    );
    expect(files.filter((f) => importsDropped.test(f.content)).map((f) => f.path)).toEqual([]);
    expect(files.some((f) => /(?:^|\/)(?:e2e|capture)\//.test(f.path))).toBe(false);
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

describe("generateTemplateBundle", () => {
  it("writes the collected files as JSON and reports sizes", async () => {
    await write("template/package.json", '{"name":"t"}');
    await write("template/src/page.tsx", "export default 1;");
    const outFile = path.join(root, "out/nested/bundle.json");

    const result = await generateTemplateBundle({ templateDir: path.join(root, "template"), outFile });

    const written = await fs.readFile(outFile, "utf-8");
    expect(JSON.parse(written)).toEqual([
      { path: "package.json", content: sitePackageJson('{"name":"t"}') },
      { path: "src/page.tsx", content: "export default 1;" },
    ]);
    expect(result).toEqual({
      fileCount: 2,
      bytes: Buffer.byteLength(written),
      gzipBytes: gzipSync(Buffer.from(written)).length,
    });
  });

  it("replaces an existing bundle by rename, leaving no temp file behind", async () => {
    await write("template/package.json", '{"name":"t"}');
    const outFile = path.join(root, "out/bundle.json");
    await write("out/bundle.json", "stale");
    const staleInode = (await fs.stat(outFile)).ino;

    await generateTemplateBundle({ templateDir: path.join(root, "template"), outFile });

    expect((await fs.stat(outFile)).ino).not.toBe(staleInode);
    expect(JSON.parse(await fs.readFile(outFile, "utf-8"))).toEqual([
      { path: "package.json", content: sitePackageJson('{"name":"t"}') },
    ]);
    expect(await fs.readdir(path.dirname(outFile))).toEqual(["bundle.json"]);
  });

  it("throws rather than writing an empty bundle", async () => {
    await write("template/logo.png");
    const outFile = path.join(root, "bundle.json");

    await expect(
      generateTemplateBundle({ templateDir: path.join(root, "template"), outFile }),
    ).rejects.toThrow(/No template files/);
    await expect(fs.access(outFile)).rejects.toThrow();
  });
});
