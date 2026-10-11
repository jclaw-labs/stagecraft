import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectShellFiles } from "../apps/web/scripts/generate-template-bundle.mjs";
import { cleanShellPackageJson, copiesIntoCleanShell, copyCleanShell } from "./check-musician-site-shell.mjs";
import { SHELL_DIR } from "./install-musician-site-shell.mjs";

const PACKAGE = "@jclaw-labs/musician-site";
const SHELL_PACKAGE = {
  name: "musician-site",
  dependencies: { [PACKAGE]: "file:../musician-site", next: "^15.5.27" },
  overrides: { "@jclaw-labs/content-upgraders": "file:../../packages/content-upgraders" },
};

describe("cleanShellPackageJson", () => {
  it("installs the package from the tarball and drops the overrides", () => {
    expect(cleanShellPackageJson(SHELL_PACKAGE, { packageName: PACKAGE, templateTarball: "/p/t.tgz" })).toEqual({
      name: "musician-site",
      dependencies: { [PACKAGE]: "file:/p/t.tgz", next: "^15.5.27" },
    });
  });

  it("refuses a shell that doesn't link the package through file:", () => {
    expect(() =>
      cleanShellPackageJson({ dependencies: { [PACKAGE]: "1.0.0" } }, { packageName: PACKAGE, templateTarball: "/t" }),
    ).toThrow(/through file:/);
  });
});

describe("copiesIntoCleanShell", () => {
  it("leaves out installs, build output, lockfiles and monorepo-only files", () => {
    for (const p of ["node_modules", "node_modules/x/index.js", ".next/cache", ".npmrc", "package-lock.json", "CLAUDE.md", "tsconfig.tsbuildinfo"]) {
      expect(copiesIntoCleanShell(p), p).toBe(false);
    }
  });

  it("keeps the shell's own files", () => {
    for (const p of ["", "package.json", "next.config.ts", ".gitignore", "src/app/layout.tsx", "src/content/site.json"]) {
      expect(copiesIntoCleanShell(p), p).toBe(true);
    }
  });
});

describe("copyCleanShell", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "clean-shell-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("copies the real shell without its monorepo-only files", () => {
    const dest = path.join(root, "site");
    copyCleanShell({ dest, packageName: PACKAGE, templateTarball: "/p/t.tgz" });
    expect(fs.existsSync(path.join(dest, "next.config.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "src/content"))).toBe(true);
    expect(fs.existsSync(path.join(dest, ".npmrc"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "node_modules"))).toBe(false);
    const pkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(pkg.dependencies[PACKAGE]).toBe("file:/p/t.tgz");
    expect(pkg).not.toHaveProperty("overrides");
  });
});

describe("the clean shell copy and the shell new sites get", () => {
  it("hold the same files, so the check builds what the bundle generator ships", async () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: SHELL_DIR, encoding: "utf8" }).split("\0").filter(Boolean);
    const shipped = (await collectShellFiles(SHELL_DIR, PACKAGE, "1.0.0")).map((f) => f.path);
    expect(tracked.filter(copiesIntoCleanShell).sort()).toEqual([...shipped].sort());
  });
});
