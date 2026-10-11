import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SHELL_DIR } from "./collections/test-fixtures.js";
import {
  detectMonorepoRoot,
  PACKAGE_NAME,
  REQUIRED_SHELL_VERSION,
  shellVersionError,
  STAGECRAFT_HEADERS,
  withStagecraft,
} from "./with-stagecraft.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "with-stagecraft-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** `<tmp>/templates/site`, under a root package.json with `rootPkg`. */
function appUnder(rootPkg?: string): string {
  const app = path.join(tmp, "templates", "site");
  fs.mkdirSync(app, { recursive: true });
  if (rootPkg !== undefined) fs.writeFileSync(path.join(tmp, "package.json"), rootPkg);
  return app;
}

describe("detectMonorepoRoot", () => {
  it("finds a workspaces root two levels up", () => {
    expect(detectMonorepoRoot(appUnder('{"workspaces":["apps/*"]}'))).toBe(tmp);
  });

  it("is undefined without a root package.json, without workspaces, or with bad JSON", () => {
    expect(detectMonorepoRoot(appUnder())).toBeUndefined();
    expect(detectMonorepoRoot(appUnder('{"name":"x"}'))).toBeUndefined();
    expect(detectMonorepoRoot(appUnder("{not json"))).toBeUndefined();
  });

  it("defaults to the working directory, not this module's location", () => {
    expect(detectMonorepoRoot()).toBe(detectMonorepoRoot(process.cwd()));
  });
});

describe("withStagecraft", () => {
  it("applies the Stagecraft settings to an empty config", async () => {
    const config = withStagecraft({}, appUnder());
    expect(config.reactStrictMode).toBe(true);
    expect(config.experimental).toEqual({ globalNotFound: true });
    expect(config).not.toHaveProperty("outputFileTracingRoot");
    expect(await config.headers!()).toEqual(STAGECRAFT_HEADERS);
  });

  it("sets outputFileTracingRoot inside the monorepo", () => {
    expect(withStagecraft({}, appUnder('{"workspaces":["apps/*"]}')).outputFileTracingRoot).toBe(tmp);
  });

  it("keeps the site's own settings, headers and experimental flags", async () => {
    const siteRule = { source: "/x", headers: [{ key: "X-Site", value: "1" }] };
    const config = withStagecraft(
      {
        reactStrictMode: false,
        poweredByHeader: false,
        experimental: { optimizePackageImports: ["a"] },
        headers: async () => [siteRule],
      },
      appUnder(),
    );
    expect(config.reactStrictMode).toBe(false);
    expect(config.poweredByHeader).toBe(false);
    expect(config.experimental).toEqual({ optimizePackageImports: ["a"], globalNotFound: true });
    expect(await config.headers!()).toEqual([...STAGECRAFT_HEADERS, siteRule]);
  });

  it("keeps globalNotFound on even when the site turns it off", () => {
    expect(withStagecraft({ experimental: { globalNotFound: false } }, appUnder()).experimental?.globalNotFound).toBe(
      true,
    );
  });
});

/** An app at `<tmp>/app` with `pkg` as its package.json. */
function appWith(pkg: unknown): string {
  const app = path.join(tmp, "app");
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, "package.json"), typeof pkg === "string" ? pkg : JSON.stringify(pkg));
  return app;
}

const shell = (shellVersion?: unknown) => ({
  dependencies: { [PACKAGE_NAME]: "1.0.0", next: "^15.5.27" },
  ...(shellVersion === undefined ? {} : { stagecraft: { shellVersion } }),
});

describe("shellVersionError", () => {
  it("passes a shell at or above the required version", () => {
    expect(shellVersionError(appWith(shell(REQUIRED_SHELL_VERSION)))).toBeNull();
    expect(shellVersionError(appWith(shell(REQUIRED_SHELL_VERSION + 1)))).toBeNull();
  });

  it("fails a shell older than the required version, naming both versions", () => {
    const error = shellVersionError(appWith(shell(REQUIRED_SHELL_VERSION - 1)));
    expect(error).toContain(`This site's shell is version ${REQUIRED_SHELL_VERSION - 1}`);
    expect(error).toContain(`needs shell version ${REQUIRED_SHELL_VERSION} or later`);
    expect(error).toContain("upgrade pull request");
  });

  it.each([undefined, "1", 1.5, null])("fails a shell whose shellVersion is %s", (version) => {
    expect(shellVersionError(appWith(shell(version)))).toContain("has no stagecraft.shellVersion");
  });

  it("checks a shell that lists the package as a dev dependency", () => {
    expect(shellVersionError(appWith({ devDependencies: { [PACKAGE_NAME]: "1.0.0" } }))).toContain(
      "has no stagecraft.shellVersion",
    );
  });

  it("skips an app that doesn't depend on the package, such as a full template copy", () => {
    expect(shellVersionError(appWith({ dependencies: { next: "^15.5.27" } }))).toBeNull();
  });

  it("skips an app without a readable package.json", () => {
    expect(shellVersionError(path.join(tmp, "missing"))).toBeNull();
    expect(shellVersionError(appWith("{not json"))).toBeNull();
  });

  it("passes the monorepo's shell, which is at the required version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SHELL_DIR, "package.json"), "utf8"));
    expect(pkg.stagecraft.shellVersion).toBe(REQUIRED_SHELL_VERSION);
    expect(shellVersionError(SHELL_DIR)).toBeNull();
  });
});

describe("withStagecraft and the shell version", () => {
  it("throws for a shell that is too old", () => {
    expect(() => withStagecraft({}, appWith(shell(REQUIRED_SHELL_VERSION - 1)))).toThrow(
      /needs shell version/,
    );
  });

  it("builds a config for a current shell", () => {
    expect(withStagecraft({}, appWith(shell(REQUIRED_SHELL_VERSION))).reactStrictMode).toBe(true);
  });
});
