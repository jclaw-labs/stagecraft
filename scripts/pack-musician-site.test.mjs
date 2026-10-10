import { describe, expect, it } from "vitest";
import {
  assertLockstep,
  packedTemplatePackageJson,
  UPGRADERS_NAME,
  upgradersSpec,
} from "./pack-musician-site.mjs";

const TEMPLATE = {
  name: "@jclaw-labs/musician-site",
  version: "1.2.3",
  imports: {
    "#lib/*": { source: "./src/lib/*", default: "./dist/lib/*" },
    "#plain": "./dist/plain.js",
  },
  dependencies: { [UPGRADERS_NAME]: "file:../../packages/content-upgraders", zod: "4.4.2" },
};

describe("packedTemplatePackageJson", () => {
  it("pins the upgraders dependency and keeps the others", () => {
    const packed = packedTemplatePackageJson(TEMPLATE, "1.2.3");
    expect(packed.dependencies).toEqual({ [UPGRADERS_NAME]: "1.2.3", zod: "4.4.2" });
  });

  it("drops the source condition from imports, leaving string targets alone", () => {
    expect(packedTemplatePackageJson(TEMPLATE, "1.2.3").imports).toEqual({
      "#lib/*": { default: "./dist/lib/*" },
      "#plain": "./dist/plain.js",
    });
  });

  it("does not change its input", () => {
    const before = JSON.stringify(TEMPLATE);
    packedTemplatePackageJson(TEMPLATE, "1.2.3");
    expect(JSON.stringify(TEMPLATE)).toBe(before);
  });

  it("adds no imports field when there was none", () => {
    const { imports: _imports, ...noImports } = TEMPLATE;
    expect(packedTemplatePackageJson(noImports, "1.2.3")).not.toHaveProperty("imports");
  });

  it("refuses a template without the upgraders dependency", () => {
    expect(() => packedTemplatePackageJson({ ...TEMPLATE, dependencies: { zod: "4.4.2" } }, "1.2.3")).toThrow(
      /no @jclaw-labs\/content-upgraders dependency/,
    );
  });
});

describe("upgradersSpec", () => {
  const input = { upgradersVersion: "1.2.3", upgradersTarball: "/tmp/out/u.tgz" };

  it("points at the tarball for local checks", () => {
    expect(upgradersSpec({ ...input, release: false })).toBe("file:/tmp/out/u.tgz");
  });

  it("pins the exact published version for a release", () => {
    expect(upgradersSpec({ ...input, release: true })).toBe("1.2.3");
  });
});

describe("assertLockstep", () => {
  it("accepts matching versions", () => {
    expect(() => assertLockstep(TEMPLATE, { name: UPGRADERS_NAME, version: "1.2.3" })).not.toThrow();
  });

  it("rejects a version mismatch, naming both", () => {
    expect(() => assertLockstep(TEMPLATE, { name: UPGRADERS_NAME, version: "1.2.4" })).toThrow(
      "@jclaw-labs/musician-site@1.2.3 and @jclaw-labs/content-upgraders@1.2.4 must share a version.",
    );
  });
});
