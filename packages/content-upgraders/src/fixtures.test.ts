import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  LATEST_SCHEMA_VERSION,
  OLDEST_SCHEMA_VERSION,
  UPGRADERS,
  upgradeCollection,
  type CollectionJson,
} from "./index.js";

const FIXTURES = path.join(__dirname, "..", "fixtures");

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as CollectionJson;
const jsonFiles = (dir: string) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort() : [];

/** Golden fixtures by version: `fixtures/v<N>/*.json`. */
const versions = fs
  .readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
  .map((entry) => Number(entry.name.slice(1)))
  .sort((a, b) => a - b);

/**
 * Where step `UPGRADERS[n]`'s expected outputs live:
 * `fixtures/v<n>-to-v<n+1>/<name>.json` is what the step must turn
 * `fixtures/v<n>/<name>.json` into.
 */
const stepDir = (from: number) => path.join(FIXTURES, `v${from}-to-v${from + 1}`);

/** The `from` version of each step, from `UPGRADERS`' keys. */
function stepVersions(chain: Readonly<Record<number, unknown>> = UPGRADERS): number[] {
  return Object.keys(chain)
    .map(Number)
    .sort((a, b) => a - b);
}

/** The `v<n>` fixtures a step has no expected output for, as `v<n>-to-v<n+1>/<name>.json`. */
function missingStepOutputs(chain: Readonly<Record<number, unknown>> = UPGRADERS): string[] {
  return stepVersions(chain).flatMap((from) => {
    const expected = new Set(jsonFiles(stepDir(from)));
    return jsonFiles(path.join(FIXTURES, `v${from}`))
      .filter((name) => !expected.has(name))
      .map((name) => `v${from}-to-v${from + 1}/${name}`);
  });
}

describe("golden fixtures", () => {
  it("cover every supported version", () => {
    expect(versions).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION - OLDEST_SCHEMA_VERSION + 1 }, (_, i) => OLDEST_SCHEMA_VERSION + i),
    );
  });

  for (const version of versions) {
    const dir = path.join(FIXTURES, `v${version}`);
    for (const file of jsonFiles(dir)) {
      it(`v${version}/${file} upgrades to the latest version`, () => {
        const fixture = readJson(path.join(dir, file));
        expect(fixture.schemaVersion).toBe(version);
        expect(upgradeCollection(structuredClone(fixture)).schemaVersion).toBe(LATEST_SCHEMA_VERSION);
      });
    }
  }
});

describe("each upgrader step", () => {
  it("has an expected output for every fixture of the version it upgrades from", () => {
    expect(missingStepOutputs()).toEqual([]);
  });

  it("has no expected outputs for a step that doesn't exist", () => {
    const steps = new Set(stepVersions().map((from) => `v${from}-to-v${from + 1}`));
    const stepDirs = fs
      .readdirSync(FIXTURES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v\d+-to-v\d+$/.test(entry.name))
      .map((entry) => entry.name);
    expect(stepDirs.filter((name) => !steps.has(name))).toEqual([]);
  });

  for (const from of stepVersions()) {
    for (const file of jsonFiles(stepDir(from))) {
      it(`turns v${from}/${file} into v${from}-to-v${from + 1}/${file}`, () => {
        const fixture = readJson(path.join(FIXTURES, `v${from}`, file));
        const upgraded = upgradeCollection(structuredClone(fixture), from + 1);
        const expected = readJson(path.join(stepDir(from), file));
        expect(upgraded).toEqual(expected);
        // Same keys in the same order, so a hand migration writes what the CMS would.
        expect(JSON.stringify(upgraded)).toBe(JSON.stringify(expected));
      });
    }
  }
});
