import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LATEST_SCHEMA_VERSION,
  OLDEST_SCHEMA_VERSION,
  UPGRADERS,
  upgradeCollection,
} from "./index.js";

describe("upgrader chain", () => {
  it("starts empty at schemaVersion 1", () => {
    expect(OLDEST_SCHEMA_VERSION).toBe(1);
    expect(LATEST_SCHEMA_VERSION).toBe(1);
    expect(Object.keys(UPGRADERS)).toEqual([]);
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
