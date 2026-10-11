import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { installMusicianSiteShell, SHELL_DIR } from "./install-musician-site-shell.mjs";
import { TEMPLATE_DIR, UPGRADERS_DIR } from "./pack-musician-site.mjs";

const shellPackage = () => JSON.parse(fs.readFileSync(path.join(SHELL_DIR, "package.json"), "utf8"));

describe("the shell the script installs into", () => {
  it("depends on the template through a file: link", () => {
    const spec = shellPackage().dependencies["@jclaw-labs/musician-site"];
    expect(spec).toMatch(/^file:/);
    expect(path.resolve(SHELL_DIR, spec.slice("file:".length))).toBe(TEMPLATE_DIR);
  });

  it("installs packed copies, without a lockfile", () => {
    const npmrc = fs.readFileSync(path.join(SHELL_DIR, ".npmrc"), "utf8").split("\n");
    expect(npmrc).toContain("install-links=true");
    expect(npmrc).toContain("package-lock=false");
  });

  it("points the template's own file: upgraders dependency at the monorepo copy", () => {
    const upgraders = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, "package.json"), "utf8")).dependencies[
      "@jclaw-labs/content-upgraders"
    ];
    const override = shellPackage().overrides["@jclaw-labs/content-upgraders"];
    expect(path.resolve(SHELL_DIR, override.slice("file:".length))).toBe(
      path.resolve(TEMPLATE_DIR, upgraders.slice("file:".length)),
    );
  });
});

describe("installMusicianSiteShell", () => {
  it("builds both packages, drops the installed copies, then installs the shell", () => {
    /** @type {string[]} */
    const calls = [];
    installMusicianSiteShell({
      run: (args, cwd) => calls.push(`npm ${args.join(" ")} in ${cwd}`),
      remove: (dir) => calls.push(`remove ${dir}`),
    });
    expect(calls).toEqual([
      `npm run build in ${UPGRADERS_DIR}`,
      `npm run build:package in ${TEMPLATE_DIR}`,
      `remove ${path.join(SHELL_DIR, "node_modules/@jclaw-labs")}`,
      `npm install --no-audit --no-fund in ${SHELL_DIR}`,
    ]);
  });
});
