import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectTemplateFiles, generateTemplateBundle } from "./generate-template-bundle.mjs";

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
      { path: "package.json", content: "{}" },
      { path: "src/app/a.tsx", content: "a" },
      { path: "src/b.ts", content: "b" },
    ]);
  });

  it("skips excluded directories at any depth", async () => {
    await write("keep.ts");
    for (const dir of ["node_modules", "dist", ".next", ".turbo", ".git", "tests", "scripts"]) {
      await write(`${dir}/x.ts`);
      await write(`src/${dir}/y.ts`);
    }

    expect((await collectTemplateFiles(root)).map((f) => f.path)).toEqual(["keep.ts"]);
  });

  it("skips excluded files by name, including in subdirectories", async () => {
    await write("keep.ts");
    for (const file of ["package-lock.json", "playwright.config.ts", "CLAUDE.md", "EDITING.md"]) {
      await write(file);
      await write(`docs/${file}`);
    }

    expect((await collectTemplateFiles(root)).map((f) => f.path)).toEqual(["keep.ts"]);
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

describe("generateTemplateBundle", () => {
  it("writes the collected files as JSON and reports sizes", async () => {
    await write("template/package.json", '{"name":"t"}');
    await write("template/src/page.tsx", "export default 1;");
    const outFile = path.join(root, "out/nested/bundle.json");

    const result = await generateTemplateBundle({ templateDir: path.join(root, "template"), outFile });

    const written = await fs.readFile(outFile, "utf-8");
    expect(JSON.parse(written)).toEqual([
      { path: "package.json", content: '{"name":"t"}' },
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
      { path: "package.json", content: '{"name":"t"}' },
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
