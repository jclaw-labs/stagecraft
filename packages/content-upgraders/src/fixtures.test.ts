import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LATEST_SCHEMA_VERSION, OLDEST_SCHEMA_VERSION, upgradeCollection, type CollectionJson } from "./index.js";

const FIXTURES = path.join(__dirname, "..", "fixtures");

/** Golden fixtures by version: `fixtures/v<N>/*.json`. */
const versions = fs
  .readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
  .map((entry) => Number(entry.name.slice(1)))
  .sort((a, b) => a - b);

describe("golden fixtures", () => {
  it("cover every supported version", () => {
    expect(versions).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION - OLDEST_SCHEMA_VERSION + 1 }, (_, i) => OLDEST_SCHEMA_VERSION + i),
    );
  });

  for (const version of versions) {
    const dir = path.join(FIXTURES, `v${version}`);
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      it(`v${version}/${file} upgrades to the latest version, idempotently`, () => {
        const fixture = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as CollectionJson;
        expect(fixture.schemaVersion).toBe(version);
        const upgraded = upgradeCollection(structuredClone(fixture));
        expect(upgraded.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
        expect(upgradeCollection(structuredClone(upgraded))).toEqual(upgraded);
      });
    }
  }
});
