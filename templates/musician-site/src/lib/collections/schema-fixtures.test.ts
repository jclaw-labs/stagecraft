/**
 * The upgraders' golden fixtures (`packages/content-upgraders/fixtures/`,
 * one directory per past `schemaVersion`) must still read: upgraded by
 * the real chain and validated by the current schema (ADR-016 §3).
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { collectionDefSchema, CURRENT_COLLECTION_SCHEMA_VERSION } from "./schema.js";

const FIXTURES = path.resolve(__dirname, "../../../../../packages/content-upgraders/fixtures");

const fixtures = fs
  .readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
  .flatMap((entry) =>
    fs
      .readdirSync(path.join(FIXTURES, entry.name))
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(entry.name, name)),
  );

describe("golden collection fixtures", () => {
  it("exist", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)("%s reads at the current schemaVersion", (fixture) => {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, fixture), "utf8"));
    const parsed = collectionDefSchema.parse(raw);
    expect(parsed.schemaVersion).toBe(CURRENT_COLLECTION_SCHEMA_VERSION);
  });
});
