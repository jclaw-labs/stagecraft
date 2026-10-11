/**
 * `stagecraft.schemaVersion` in package.json is how the platform learns a
 * release's content format from npm metadata alone (ADR-016 §4), so it
 * has to match the version this release reads and writes.
 * `packages/content-upgraders` checks that its chain ends there too.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CURRENT_COLLECTION_SCHEMA_VERSION } from "./schema.js";

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf8")) as {
  stagecraft?: { schemaVersion?: unknown };
};

describe("package schemaVersion", () => {
  it("matches CURRENT_COLLECTION_SCHEMA_VERSION", () => {
    expect(pkg.stagecraft?.schemaVersion).toBe(CURRENT_COLLECTION_SCHEMA_VERSION);
  });
});
