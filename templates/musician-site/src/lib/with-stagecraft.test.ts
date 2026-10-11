import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectMonorepoRoot, STAGECRAFT_HEADERS, withStagecraft } from "./with-stagecraft.js";

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
