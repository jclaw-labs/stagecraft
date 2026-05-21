/**
 * Filesystem helpers for setting up known content-dir states between
 * e2e specs.
 *
 * The dev server runs against `E2E_CONTENT_DIR` (see
 * playwright.config.ts). Specs reset just the files they care about
 * in `test.beforeEach`, so a previous test's state can't leak in.
 *
 * Goes through raw fs writes rather than importing the runtime
 * `writeSingleton` helpers — Playwright runs in its own process tree
 * with no module resolver for `@/lib/...`, and the on-disk JSON shape
 * is the actual contract anyway. If `_collection.json` field ids
 * change, this file changes alongside.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { E2E_CONTENT_DIR } from "../../playwright.config";

const COLLECTIONS_DIR = path.join(E2E_CONTENT_DIR, "collections");
const SITE_ITEMS_DIR = path.join(COLLECTIONS_DIR, "site/items");
const APPEARANCE_ITEMS_DIR = path.join(COLLECTIONS_DIR, "appearance/items");
const HEADER_ITEMS_DIR = path.join(COLLECTIONS_DIR, "header/items");
const PAGES_ITEMS_DIR = path.join(COLLECTIONS_DIR, "pages/items");
const TOUR_DATES_ITEMS_DIR = path.join(COLLECTIONS_DIR, "tour-dates/items");

/**
 * Wipe every item-file out of every collection so the next admin
 * request sees a "fresh artist site": no completed flag, no pages,
 * no tour dates. The `_collection.json` def files stay in place
 * (re-created by `ensurePrebakedCollections` on first read if
 * absent, but keeping them avoids the redundant write).
 */
export async function wipeContentDir(): Promise<void> {
  await fs.mkdir(E2E_CONTENT_DIR, { recursive: true });
  // Remove every items/ directory under every collection.
  for (const dir of [
    SITE_ITEMS_DIR,
    APPEARANCE_ITEMS_DIR,
    HEADER_ITEMS_DIR,
    PAGES_ITEMS_DIR,
    TOUR_DATES_ITEMS_DIR,
  ]) {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Seed a "completed welcome wizard" state: the site singleton has
 * `hasCompletedFirstRun: true`, plus minimal artist-name / contact-
 * email values that the reset spec confirms against. Used by the
 * reset spec's beforeEach so the wizard is skipped and we land in
 * /admin/pages.
 *
 * Item ids are stable across runs so a flaky test debugging
 * iteration produces a deterministic git diff if you commit the
 * content dir.
 */
export async function seedCompletedSite(artistName: string): Promise<void> {
  await wipeContentDir();
  await fs.mkdir(SITE_ITEMS_DIR, { recursive: true });
  const siteItem = {
    id: "item_e2e_site_singleton",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    values: {
      fld_site_artistName: { type: "text", value: artistName },
      fld_site_siteTitle: {
        type: "text",
        value: `${artistName} — Official Website`,
      },
      fld_site_siteDescription: { type: "longText", value: "" },
      fld_site_contactEmail: { type: "email", value: "contact@example.com" },
      fld_site_copyrightName: { type: "text", value: artistName },
      fld_site_isFooterHidden: { type: "boolean", value: false },
      fld_site_hasCompletedFirstRun: { type: "boolean", value: true },
    },
  };
  await fs.writeFile(
    path.join(SITE_ITEMS_DIR, "_singleton.json"),
    JSON.stringify(siteItem, null, 2) + "\n",
    "utf-8",
  );

  // A throwaway page so the reset has something visible to delete.
  // The reset spec doesn't assert on its content — only that
  // /admin/pages shows at least one row before the reset and that
  // the post-reset state lands the artist back at /admin/welcome.
  await fs.mkdir(PAGES_ITEMS_DIR, { recursive: true });
  const homeItem = {
    id: "item_e2e_pages_home",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    values: {
      fld_pages_title: { type: "text", value: "Home" },
      fld_pages_isSplashPage: { type: "boolean", value: false },
      fld_pages_isFooterHidden: { type: "boolean", value: false },
      fld_pages_showInNav: { type: "boolean", value: true },
      fld_pages_body: {
        type: "puckContent",
        value: { content: [], root: { props: {} } },
      },
    },
  };
  await fs.writeFile(
    path.join(PAGES_ITEMS_DIR, "home.json"),
    JSON.stringify(homeItem, null, 2) + "\n",
    "utf-8",
  );
}
