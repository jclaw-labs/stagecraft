import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { packageVersion, run, USAGE } from "./run.js";

function capture(argv: string[]) {
  let out = "";
  let err = "";
  const code = run(argv, { out: (t) => (out += t), err: (t) => (err += t) });
  return { code, out, err };
}

describe("stagecraft-site CLI", () => {
  it("prints usage with no command", () => {
    expect(capture([])).toEqual({ code: 0, out: USAGE, err: "" });
  });

  it.each(["--help", "-h", "help"])("prints usage for %s", (flag) => {
    expect(capture([flag])).toEqual({ code: 0, out: USAGE, err: "" });
  });

  it.each(["--version", "-v"])("prints the package version for %s", (flag) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
    expect(packageVersion()).toBe(pkg.version);
    expect(capture([flag])).toEqual({ code: 0, out: `${pkg.version}\n`, err: "" });
  });

  it("fails on an unknown command", () => {
    const result = capture(["frobnicate"]);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain('unknown command "frobnicate"');
    expect(result.err).toContain(USAGE);
  });
});

describe("stagecraft-site migrate-content on the template's own content", () => {
  it("finds every collection already at the package's schemaVersion", () => {
    let out = "";
    let err = "";
    const code = run(["migrate-content", "--check"], { out: (t) => (out += t), err: (t) => (err += t) });
    expect({ code, err }).toEqual({ code: 0, err: "" });
    expect(out).toMatch(/^All \d+ collections are at schemaVersion \d+\.\n$/);
  });
});
