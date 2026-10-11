import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as entry from "./index.js";
import {
  LATEST_SCHEMA_VERSION,
  OLDEST_SCHEMA_VERSION,
  UPGRADERS,
  upgradeCollection,
  type CollectionJson,
  type Upgrader,
} from "./index.js";
import { runChain } from "./run-chain.js";

describe("upgrader chain", () => {
  it("starts empty at schemaVersion 1", () => {
    expect(OLDEST_SCHEMA_VERSION).toBe(1);
    expect(LATEST_SCHEMA_VERSION).toBe(1);
    expect(Object.keys(UPGRADERS)).toEqual([]);
  });

  it("has a step for every version from OLDEST_SCHEMA_VERSION up to LATEST_SCHEMA_VERSION", () => {
    const keys = Object.keys(UPGRADERS).map(Number);
    const expected = Array.from(
      { length: LATEST_SCHEMA_VERSION - OLDEST_SCHEMA_VERSION },
      (_, i) => OLDEST_SCHEMA_VERSION + i,
    );
    expect(keys).toEqual(expected);
  });

  it("ends at the schemaVersion the musician-site package declares", () => {
    const templatePkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../../templates/musician-site/package.json"), "utf8"),
    ) as { stagecraft: { schemaVersion: number } };
    expect(LATEST_SCHEMA_VERSION).toBe(templatePkg.stagecraft.schemaVersion);
  });

  it("is versioned in lockstep with the musician-site package", () => {
    const read = (dir: string) =>
      (JSON.parse(fs.readFileSync(path.join(__dirname, dir, "package.json"), "utf8")) as { version: string }).version;
    expect(read("..")).toBe(read("../../../templates/musician-site"));
  });
});

describe("upgradeCollection", () => {
  const v1 = { schemaVersion: 1, slug: "news", fields: [] };

  it("returns a definition already at the target unchanged", () => {
    expect(upgradeCollection(v1)).toBe(v1);
    expect(upgradeCollection(v1, 1)).toBe(v1);
  });

  it("rejects a definition without an integer schemaVersion", () => {
    expect(() => upgradeCollection({ slug: "news" })).toThrow(TypeError);
    expect(() => upgradeCollection({ schemaVersion: "1" })).toThrow(TypeError);
    expect(() => upgradeCollection({ schemaVersion: 1.5 })).toThrow(TypeError);
  });

  it("rejects a version older than the chain starts", () => {
    expect(() => upgradeCollection({ schemaVersion: 0 })).toThrow(/older than 1/);
  });

  it("rejects a version newer than the target", () => {
    expect(() => upgradeCollection({ schemaVersion: 2 })).toThrow(/newer than the target 1/);
  });

  it("rejects a target outside the chain", () => {
    expect(() => upgradeCollection(v1, 0)).toThrow(/outside 1–1/);
    expect(() => upgradeCollection(v1, LATEST_SCHEMA_VERSION + 1)).toThrow(RangeError);
    expect(() => upgradeCollection(v1, 1.5)).toThrow(RangeError);
  });
});

describe("runChain", () => {
  // A fake three-step chain: each step bumps schemaVersion and records itself.
  const step =
    (n: number): Upgrader =>
    (c: CollectionJson) => ({ ...c, schemaVersion: n + 1, steps: [...((c.steps as number[]) ?? []), n] });
  const chain = { 1: step(1), 2: step(2), 3: step(3) };

  it("runs every step from the definition's version to the target, in order", () => {
    expect(runChain(chain, { schemaVersion: 1, slug: "news" }, 4)).toEqual({
      schemaVersion: 4,
      slug: "news",
      steps: [1, 2, 3],
    });
  });

  it("stops at a partial target", () => {
    expect(runChain(chain, { schemaVersion: 1 }, 3)).toEqual({ schemaVersion: 3, steps: [1, 2] });
  });

  it("starts from the definition's own version", () => {
    expect(runChain(chain, { schemaVersion: 2 }, 4)).toEqual({ schemaVersion: 4, steps: [2, 3] });
  });

  it("returns the input unchanged when it is already at the target", () => {
    const v3 = { schemaVersion: 3 };
    expect(runChain(chain, v3, 3)).toBe(v3);
  });

  it("throws on a gap in the chain rather than calling a missing step", () => {
    expect(() => runChain({ 2: step(2) }, { schemaVersion: 1 }, 3)).toThrow(/No upgrader from schemaVersion 1/);
  });
});

describe("package surface", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8")) as {
    exports: Record<string, Record<string, string> | string>;
  };

  it("lists the source condition before types, so in-monorepo tsc resolves src/ rather than a stale dist/", () => {
    expect(Object.keys(pkg.exports["."] as Record<string, string>)[0]).toBe("source");
  });

  it("keeps runChain out of the entry point", () => {
    expect(Object.keys(entry)).not.toContain("runChain");
  });
});
