/**
 * The published `dist/` build keeps what Next.js and plain Node need
 * from each module: the `"use client"` directive on every client module
 * (a dropped directive turns a client component into a server one), the
 * global stylesheet, and an executable CLI.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPackage, PACKAGE_ROOT } from "./build-package.mjs";

const SRC = path.join(PACKAGE_ROOT, "src");
const USE_CLIENT = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*["']use client["']/;

/** Every compiled source file under `src/`, relative to it. */
function sourceModules(dir = SRC, prefix = ""): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "content" && prefix === "" ? [] : sourceModules(path.join(dir, entry.name), rel);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [rel]
      : [];
  });
}

describe("package build", () => {
  let outDir: string;

  beforeAll(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "musician-site-dist-"));
    buildPackage(outDir);
  }, 180_000);

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  const modules = sourceModules();
  const clientModules = modules.filter((file) => USE_CLIENT.test(fs.readFileSync(path.join(SRC, file), "utf8")));
  const compiled = (file: string) => path.join(outDir, file.replace(/\.tsx?$/, ".js"));

  it("finds client modules to check", () => {
    expect(clientModules.length).toBeGreaterThan(0);
    expect(clientModules).toContain("components/ContactForm.tsx");
  });

  it('keeps "use client" on every client module, and adds it nowhere else', () => {
    const missing = clientModules.filter((file) => !USE_CLIENT.test(fs.readFileSync(compiled(file), "utf8")));
    expect(missing).toEqual([]);
    const added = modules
      .filter((file) => !clientModules.includes(file))
      .filter((file) => USE_CLIENT.test(fs.readFileSync(compiled(file), "utf8")));
    expect(added).toEqual([]);
  });

  it("emits a module and type declarations per source file", () => {
    for (const file of modules) {
      expect(fs.existsSync(compiled(file)), file).toBe(true);
      expect(fs.existsSync(compiled(file).replace(/\.js$/, ".d.ts")), file).toBe(true);
    }
  });

  it("leaves tests and content out", () => {
    expect(fs.existsSync(path.join(outDir, "content"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "cli/run.test.js"))).toBe(false);
  });

  it("copies the global stylesheet", () => {
    expect(fs.readFileSync(path.join(outDir, "app/globals.css"), "utf8")).toBe(
      fs.readFileSync(path.join(SRC, "app/globals.css"), "utf8"),
    );
  });

  it("ships an executable CLI with a node shebang", () => {
    const cli = path.join(outDir, "cli/stagecraft-site.js");
    expect(fs.readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(fs.statSync(cli).mode & 0o111).not.toBe(0);
  });
});
