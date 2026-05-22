import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  __resetBootstrapCacheForTests,
  readSiteConfig,
} from "./content";
import {
  SITE_FIELD_IDS,
  siteCollectionDef,
} from "./collections/seeds";
import {
  generateItemId,
  getFsReadStore,
  SINGLETON_ITEM_SLUG,
  writeSingleton,
} from "./collections";

const store = getFsReadStore();

/**
 * Tests for first-run detection.
 *
 * `checkIsFirstRun` is wrapped in `React.cache` so the result is
 * memoised PER REQUEST in actual usage. Vitest doesn't run inside a
 * React render, so the wrapper resolves to its identity (an
 * effective passthrough) — meaning each call here re-reads disk,
 * which is what we want for testing the underlying semantics.
 *
 * Tests run against an isolated tmpdir via STAGECRAFT_CONTENT_DIR
 * (same pattern as content.test.ts) so they can't race with other
 * test files.
 */

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(
    path.join(os.tmpdir(), "stagecraft-first-run-"),
  );
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  __resetBootstrapCacheForTests();
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), {
    recursive: true,
    force: true,
  });
});

function writeSiteSingletonWithFlag(hasCompletedFirstRun: boolean) {
  return writeSingleton(
    "site",
    {
      id: generateItemId(),
      slug: SINGLETON_ITEM_SLUG,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      values: {
        [SITE_FIELD_IDS.artistName]: { type: "text", value: "Test Artist" },
        [SITE_FIELD_IDS.siteTitle]: { type: "text", value: "Test Site" },
        [SITE_FIELD_IDS.siteDescription]: { type: "longText", value: "" },
        [SITE_FIELD_IDS.contactEmail]: {
          type: "email",
          value: "test@example.com",
        },
        [SITE_FIELD_IDS.copyrightName]: { type: "text", value: "" },
        [SITE_FIELD_IDS.isFooterHidden]: { type: "boolean", value: false },
        [SITE_FIELD_IDS.hasCompletedFirstRun]: {
          type: "boolean",
          value: hasCompletedFirstRun,
        },
      },
    },
    siteCollectionDef,
  );
}

describe("checkIsFirstRun (via readSiteConfig.hasCompletedFirstRun)", () => {
  it("returns first-run=true when no site singleton exists on disk", async () => {
    const config = await readSiteConfig(store);
    expect(config.hasCompletedFirstRun).toBe(false);
  });

  it("returns first-run=true when site singleton exists but flag is false", async () => {
    await writeSiteSingletonWithFlag(false);
    const config = await readSiteConfig(store);
    expect(config.hasCompletedFirstRun).toBe(false);
  });

  it("returns first-run=false (i.e. completed) when flag is true", async () => {
    await writeSiteSingletonWithFlag(true);
    const config = await readSiteConfig(store);
    expect(config.hasCompletedFirstRun).toBe(true);
  });

  it("treats an absent hasCompletedFirstRun field as not-yet-completed (legacy site)", async () => {
    // Write the site singleton WITHOUT the new field — simulates a
    // pre-PR-7 artist site that hasn't been re-saved through the
    // updated UI yet.
    await writeSingleton(
      "site",
      {
        id: generateItemId(),
        slug: SINGLETON_ITEM_SLUG,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        values: {
          [SITE_FIELD_IDS.artistName]: { type: "text", value: "Legacy Artist" },
          [SITE_FIELD_IDS.siteTitle]: { type: "text", value: "Legacy Site" },
          [SITE_FIELD_IDS.siteDescription]: { type: "longText", value: "" },
          [SITE_FIELD_IDS.contactEmail]: {
            type: "email",
            value: "legacy@example.com",
          },
          [SITE_FIELD_IDS.copyrightName]: { type: "text", value: "" },
          [SITE_FIELD_IDS.isFooterHidden]: { type: "boolean", value: false },
          // hasCompletedFirstRun deliberately absent.
        },
      },
      siteCollectionDef,
    );
    const config = await readSiteConfig(store);
    expect(config.hasCompletedFirstRun).toBe(false);
  });

  it("survives a round-trip through siteConfigToItemValues / siteConfigFromItem", async () => {
    // Independent of disk: ensures the migration helpers preserve
    // the flag both directions.
    const { siteConfigFromItem, siteConfigToItemValues } = await import(
      "./collections/migrate-from-legacy-values"
    );
    const item = {
      id: "item_test",
      slug: SINGLETON_ITEM_SLUG,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      values: siteConfigToItemValues({
        artistName: "Round Trip",
        siteTitle: "Round Trip — Official Website",
        siteDescription: "",
        socialLinks: {
          instagram: "",
          twitter: "",
          facebook: "",
          youtube: "",
          spotify: "",
          appleMusic: "",
          bandcamp: "",
          soundcloud: "",
          tiktok: "",
        },
        contactEmail: "rt@example.com",
        copyrightName: "",
        isFooterHidden: false,
        favicon: null,
        pageBackground: null,
        pageOrder: [],
        hiddenFromNav: [],
        hasCompletedFirstRun: true,
      }),
    };
    const roundTripped = siteConfigFromItem(item);
    expect(roundTripped.hasCompletedFirstRun).toBe(true);
  });
});
