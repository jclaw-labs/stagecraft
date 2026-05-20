/**
 * Drift guard: every `_collection.json` committed under
 * `src/content/collections/` must deep-equal its counterpart in
 * `PREBAKED_COLLECTIONS`.
 *
 * The committed seed files exist so new artist sites start with the
 * prebaked defs in their repo from day one (no bootstrap latency, no
 * "first request after deploy populates content/" surprise). The TS
 * registry stays canonical so consumers can import field-id constants
 * etc. without disk I/O. Two sources of truth need a fence: this
 * test fails loudly when one is edited without the other.
 *
 * If this test fails: regenerate the committed JSON by deleting the
 * affected file and triggering the bootstrap (`npm run dev` will do
 * it), OR copy the new shape from `PREBAKED_COLLECTIONS[slug]` into
 * the JSON file directly. Either path is fine — the test asserts
 * structural parity, not provenance.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PREBAKED_COLLECTIONS } from "./seeds";

const SEED_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "content",
  "collections",
);

describe("committed seed _collection.json files", () => {
  it.each(Object.entries(PREBAKED_COLLECTIONS))(
    "%s — on-disk matches PREBAKED_COLLECTIONS",
    async (slug, registryDef) => {
      const filePath = path.join(SEED_ROOT, slug, "_collection.json");
      const raw = await fs.readFile(filePath, "utf-8");
      const onDisk = JSON.parse(raw);
      // JSON-round-trip the registry def so the comparison ignores
      // `undefined` properties (the registry uses optional fields;
      // JSON drops them).
      const registryJson = JSON.parse(JSON.stringify(registryDef));
      expect(onDisk, `${slug}: drift between registry and committed seed`).toEqual(
        registryJson,
      );
    },
  );
});
