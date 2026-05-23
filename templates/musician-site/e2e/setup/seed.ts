/**
 * Filesystem helpers for setting up known content-dir states between
 * e2e specs.
 *
 * The dev server runs against `E2E_CONTENT_DIR` (see
 * playwright.config.ts). Specs reset just the files they care about
 * in `test.beforeEach`, so a previous test's state can't leak in.
 *
 * Goes through raw fs writes rather than importing the runtime
 * `writeSingleton` helpers — the on-disk JSON shape is the actual
 * contract, and field-ids.ts (the SSOT for IDs) is client-bundle-safe
 * so importing it here doesn't drag node-only modules into the
 * Playwright test process tree any more than they already are.
 */

import fs from "node:fs/promises";
import path from "node:path";

import {
  PAGES_FIELD_IDS,
  SITE_FIELD_IDS,
} from "../../src/lib/collections/field-ids";
import { E2E_CONTENT_DIR } from "../../playwright.config";

/**
 * The e2e suite seeds the shared `E2E_CONTENT_DIR`; the screenshot-
 * capture config (`playwright.capture.config.ts`) reuses these
 * helpers against its own content dir. Both default to
 * `E2E_CONTENT_DIR` so existing callers are unchanged.
 */
function dirs(contentDir: string) {
  const collections = path.join(contentDir, "collections");
  return {
    collections,
    siteItems: path.join(collections, "site/items"),
    pagesItems: path.join(collections, "pages/items"),
  };
}

/**
 * Wipe every item-file out of every collection so the next admin
 * request sees a "fresh artist site": no completed flag, no pages,
 * no tour dates. The `_collection.json` def files stay in place
 * (re-created by `ensurePrebakedCollections` on first read if
 * absent, but keeping them avoids the redundant write).
 *
 * Discovers collections by reading the collections dir at runtime
 * rather than hard-coding a list, so a new prebaked collection added
 * to `PREBAKED_COLLECTIONS` is wiped automatically.
 */
export async function wipeContentDir(
  contentDir: string = E2E_CONTENT_DIR,
): Promise<void> {
  const { collections: COLLECTIONS_DIR } = dirs(contentDir);
  await fs.mkdir(contentDir, { recursive: true });
  let entries: string[];
  try {
    entries = await fs.readdir(COLLECTIONS_DIR);
  } catch (cause) {
    if (
      cause instanceof Error &&
      (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return;
    }
    throw cause;
  }
  await Promise.all(
    entries.map((slug) =>
      fs.rm(path.join(COLLECTIONS_DIR, slug, "items"), {
        recursive: true,
        force: true,
      }),
    ),
  );
}

/**
 * Seed a "completed welcome wizard" state: the site singleton has
 * `hasCompletedFirstRun: true`, plus minimal artist-name / contact-
 * email values that the reset spec confirms against. Used by the
 * reset spec's beforeEach so the wizard is skipped and we land in
 * /admin/pages.
 */
export async function seedCompletedSite(
  artistName: string,
  contentDir: string = E2E_CONTENT_DIR,
): Promise<void> {
  const { siteItems: SITE_ITEMS_DIR, pagesItems: PAGES_ITEMS_DIR } = dirs(contentDir);
  await wipeContentDir(contentDir);
  await fs.mkdir(SITE_ITEMS_DIR, { recursive: true });
  const siteItem = {
    id: "item_e2e_site_singleton",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    values: {
      [SITE_FIELD_IDS.artistName]: { type: "text", value: artistName },
      [SITE_FIELD_IDS.siteTitle]: {
        type: "text",
        value: `${artistName} — Official Website`,
      },
      [SITE_FIELD_IDS.siteDescription]: { type: "longText", value: "" },
      [SITE_FIELD_IDS.contactEmail]: {
        type: "email",
        value: "contact@example.com",
      },
      [SITE_FIELD_IDS.copyrightName]: { type: "text", value: artistName },
      [SITE_FIELD_IDS.isFooterHidden]: { type: "boolean", value: false },
      [SITE_FIELD_IDS.hasCompletedFirstRun]: { type: "boolean", value: true },
    },
  };
  await fs.writeFile(
    path.join(SITE_ITEMS_DIR, "_singleton.json"),
    JSON.stringify(siteItem, null, 2) + "\n",
    "utf-8",
  );

  // A throwaway page so /admin/pages has at least one row to render
  // after the wizard is skipped. The reset spec navigates through
  // /admin/settings, not through the pages list, so this is purely
  // there to keep the steady-state admin shell happy.
  await fs.mkdir(PAGES_ITEMS_DIR, { recursive: true });
  const homeItem = {
    id: "item_e2e_pages_home",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    values: {
      [PAGES_FIELD_IDS.title]: { type: "text", value: "Home" },
      [PAGES_FIELD_IDS.isSplashPage]: { type: "boolean", value: false },
      [PAGES_FIELD_IDS.isFooterHidden]: { type: "boolean", value: false },
      [PAGES_FIELD_IDS.showInNav]: { type: "boolean", value: true },
      [PAGES_FIELD_IDS.body]: {
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
