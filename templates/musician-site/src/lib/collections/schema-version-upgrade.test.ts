/**
 * Upgrade-on-read for `_collection.json` (ADR-016 §3). The real chain is
 * empty while every collection is on version 1, so this suite swaps in a
 * fake one where version 0 stores the plural name as `plural` and the
 * step to 1 renames it. That exercises the reader, the store and saves
 * the way a real `upgrade_0_to_1` would.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@jclaw-labs/content-upgraders", async () => {
  type Json = { schemaVersion?: unknown; [key: string]: unknown };
  const steps: Record<number, (c: Json) => Json> = {
    0: ({ plural, ...rest }) => ({ ...rest, pluralName: plural, schemaVersion: 1 }),
  };
  return {
    OLDEST_SCHEMA_VERSION: 0,
    LATEST_SCHEMA_VERSION: 1,
    UPGRADERS: steps,
    upgradeCollection: vi.fn((collection: Json, target: number) => {
      let upgraded = collection;
      for (let v = collection.schemaVersion as number; v < target; v++) upgraded = steps[v](upgraded);
      return upgraded;
    }),
  };
});

import { upgradeCollection } from "@jclaw-labs/content-upgraders";

import {
  collectionDefSchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  newerSchemaVersionMessage,
  OLDEST_COLLECTION_SCHEMA_VERSION,
} from "./schema.js";
import { readCollectionDef, writeCollectionDef } from "./store.js";
import { tourDatesDef } from "./test-fixtures.js";

/** `tourDatesDef()` as a version 0 file would hold it. */
function versionZero(): Record<string, unknown> {
  const { pluralName, ...rest } = tourDatesDef();
  return { ...rest, schemaVersion: 0, plural: pluralName };
}

let contentDir: string;

beforeAll(async () => {
  contentDir = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-upgrade-"));
});

afterAll(async () => {
  await fs.rm(contentDir, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.STAGECRAFT_CONTENT_DIR = contentDir;
  await fs.rm(path.join(contentDir, "collections"), { recursive: true, force: true });
  vi.mocked(upgradeCollection).mockClear();
});

const defPath = () => path.join(contentDir, "collections", "tour-dates", "_collection.json");

async function writeRaw(json: unknown): Promise<void> {
  await fs.mkdir(path.dirname(defPath()), { recursive: true });
  await fs.writeFile(defPath(), JSON.stringify(json));
}

describe("collectionDefSchema upgrade-on-read", () => {
  it("accepts the supported range", () => {
    expect(OLDEST_COLLECTION_SCHEMA_VERSION).toBe(0);
    expect(CURRENT_COLLECTION_SCHEMA_VERSION).toBe(1);
  });

  it("parses a current file without running the chain", () => {
    expect(collectionDefSchema.parse(tourDatesDef())).toEqual(tourDatesDef());
    expect(upgradeCollection).not.toHaveBeenCalled();
  });

  it("upgrades an older file to the current version, then validates it", () => {
    expect(collectionDefSchema.parse(versionZero())).toEqual(tourDatesDef());
    expect(upgradeCollection).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 0 }), 1);
  });

  it("fails closed on a newer version, naming what to update", () => {
    const result = collectionDefSchema.safeParse({ ...tourDatesDef(), schemaVersion: 2 });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["schemaVersion"], message: newerSchemaVersionMessage(2) }),
    ]);
    expect(newerSchemaVersionMessage(2)).toMatch(/schemaVersion 2.*reads up to 1.*Update @jclaw-labs\/musician-site/);
    expect(upgradeCollection).not.toHaveBeenCalled();
  });

  it("rejects a version older than the chain, or none, without running it", () => {
    for (const schemaVersion of [-1, undefined, "1", 0.5]) {
      expect(collectionDefSchema.safeParse({ ...tourDatesDef(), schemaVersion }).success).toBe(false);
    }
    expect(collectionDefSchema.safeParse(null).success).toBe(false);
    expect(upgradeCollection).not.toHaveBeenCalled();
  });

  it("still rejects an upgraded file that fails the current schema", () => {
    expect(collectionDefSchema.safeParse({ ...versionZero(), plural: "" }).success).toBe(false);
  });
});

describe("store", () => {
  it("reads an older file at the current version, leaving the file alone", async () => {
    await writeRaw(versionZero());
    expect(await readCollectionDef("tour-dates")).toEqual(tourDatesDef());
    expect(JSON.parse(await fs.readFile(defPath(), "utf8")).schemaVersion).toBe(0);
  });

  it("writes it back at the current version on the next save", async () => {
    await writeRaw(versionZero());
    const def = await readCollectionDef("tour-dates");
    await writeCollectionDef("tour-dates", def!);
    const saved = JSON.parse(await fs.readFile(defPath(), "utf8"));
    expect(saved.schemaVersion).toBe(CURRENT_COLLECTION_SCHEMA_VERSION);
    expect(saved).not.toHaveProperty("plural");
  });

  it("refuses to read a newer file", async () => {
    await writeRaw({ ...tourDatesDef(), schemaVersion: 2 });
    await expect(readCollectionDef("tour-dates")).rejects.toThrow(newerSchemaVersionMessage(2));
  });
});
