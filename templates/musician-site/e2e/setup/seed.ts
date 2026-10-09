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
  PHOTOS_FIELD_IDS,
  SITE_FIELD_IDS,
  STORE_ITEMS_FIELD_IDS,
  TOUR_DATES_FIELD_IDS,
  VIDEOS_FIELD_IDS,
} from "../../src/lib/collections/field-ids";
import type { FieldValue } from "../../src/lib/collections/schema";
import { asImageId, type ImageMetadata } from "../../src/lib/image-types";
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

/**
 * Replace the content dir with the template's checked-in demo site
 * (`src/content/`), so public-page specs render the same pages a fresh
 * artist site ships with.
 */
export async function seedDemoContent(
  contentDir: string = E2E_CONTENT_DIR,
): Promise<void> {
  const source = path.join(process.cwd(), "src", "content");
  await fs.rm(contentDir, { recursive: true, force: true });
  await fs.cp(source, contentDir, { recursive: true });
}

/**
 * Collections whose detail pages the overflow spec must reach. Posts
 * and releases are linked from the demo pages, so the crawl finds them
 * on its own; these aren't linked from anywhere (photos, videos and
 * store items ship with no detail URL at all), so a regression in
 * their detail layout would otherwise go unnoticed (#392).
 */
export type DetailFixtureCollection = "tour-dates" | "photos" | "videos" | "store-items";

/**
 * Detail URL prefixes switched on for collections that ship with
 * `detailUrlPrefix: null`. An artist can set these from the schema
 * editor, so the pages are real even though the demo doesn't use them.
 */
const ENABLED_DETAIL_PREFIXES: Record<Exclude<DetailFixtureCollection, "tour-dates">, string> = {
  photos: "/photos",
  videos: "/videos",
  "store-items": "/store",
};

const FIXTURE_TIMESTAMP = "2026-05-20T00:00:00.000Z";

/**
 * A wide landscape image, so a detail layout that doesn't constrain
 * its cover would push the page sideways. The file itself doesn't
 * exist; the `<img>` width/height attributes still drive layout.
 */
const WIDE_IMAGE: ImageMetadata = {
  id: asImageId("e2e-wide-image"),
  alt: "",
  width: 2400,
  height: 1200,
  placeholderDataUri: "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=",
  contentSlug: "e2e",
  originalExt: "jpg",
};

type DetailFixture = {
  collection: DetailFixtureCollection;
  itemSlug: string;
  values: Record<string, FieldValue>;
};

const DETAIL_FIXTURES: readonly DetailFixture[] = [
  {
    collection: "tour-dates",
    itemSlug: "e2e-overflow-show",
    values: {
      [TOUR_DATES_FIELD_IDS.date]: { type: "date", value: "2026-09-12T20:00" },
      [TOUR_DATES_FIELD_IDS.venue]: { type: "text", value: "The Overflow Room" },
      [TOUR_DATES_FIELD_IDS.city]: { type: "text", value: "Llanfairpwllgwyngyll" },
      [TOUR_DATES_FIELD_IDS.country]: { type: "text", value: "United Kingdom" },
      [TOUR_DATES_FIELD_IDS.status]: { type: "select", value: "on_sale" },
      [TOUR_DATES_FIELD_IDS.ticketUrl]: {
        type: "url",
        value: "https://tickets.example.com/events/the-overflow-room-2026-09-12",
      },
      [TOUR_DATES_FIELD_IDS.notes]: {
        type: "longText",
        value: "Doors at 7pm. All ages with a guardian until 9pm.",
      },
    },
  },
  {
    collection: "photos",
    itemSlug: "e2e-overflow-photo",
    values: {
      [PHOTOS_FIELD_IDS.image]: { type: "image", value: WIDE_IMAGE },
      [PHOTOS_FIELD_IDS.caption]: { type: "longText", value: "Soundcheck, late afternoon." },
      [PHOTOS_FIELD_IDS.takenAt]: { type: "date", value: "2026-04-02" },
      [PHOTOS_FIELD_IDS.credit]: { type: "text", value: "E2E Photographer" },
    },
  },
  {
    collection: "videos",
    itemSlug: "e2e-overflow-video",
    values: {
      [VIDEOS_FIELD_IDS.title]: { type: "text", value: "Live at the Overflow Room" },
      [VIDEOS_FIELD_IDS.source]: { type: "select", value: "youtube" },
      [VIDEOS_FIELD_IDS.embedUrl]: {
        type: "text",
        value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      [VIDEOS_FIELD_IDS.thumbnail]: { type: "image", value: WIDE_IMAGE },
      [VIDEOS_FIELD_IDS.description]: { type: "longText", value: "Full set, one take." },
      [VIDEOS_FIELD_IDS.publishedAt]: { type: "date", value: "2026-05-01" },
    },
  },
  {
    collection: "store-items",
    itemSlug: "e2e-overflow-store-item",
    values: {
      [STORE_ITEMS_FIELD_IDS.title]: { type: "text", value: "Tour Poster" },
      [STORE_ITEMS_FIELD_IDS.image]: { type: "image", value: WIDE_IMAGE },
      [STORE_ITEMS_FIELD_IDS.kind]: { type: "select", value: "physical" },
      [STORE_ITEMS_FIELD_IDS.price]: { type: "number", value: 25 },
      [STORE_ITEMS_FIELD_IDS.currency]: { type: "select", value: "USD" },
      [STORE_ITEMS_FIELD_IDS.description]: { type: "longText", value: "Screen-printed, A2." },
      [STORE_ITEMS_FIELD_IDS.externalUrl]: {
        type: "url",
        value: "https://store.example.com/products/tour-poster-2026",
      },
    },
  },
];

/**
 * Seed one item per detail-page collection into an already-seeded
 * content dir, switching on a detail URL for the collections that
 * ship without one. Returns the detail URL of each seeded item so the
 * spec can visit them and assert it did.
 */
export async function seedDetailPageFixtures(
  contentDir: string = E2E_CONTENT_DIR,
): Promise<Record<DetailFixtureCollection, string>> {
  const { collections } = dirs(contentDir);
  const urls: Partial<Record<DetailFixtureCollection, string>> = {};
  for (const fixture of DETAIL_FIXTURES) {
    const collectionDir = path.join(collections, fixture.collection);
    const defPath = path.join(collectionDir, "_collection.json");
    const def = JSON.parse(await fs.readFile(defPath, "utf-8")) as {
      detailUrlPrefix: string | null;
    };
    if (fixture.collection !== "tour-dates") {
      def.detailUrlPrefix = ENABLED_DETAIL_PREFIXES[fixture.collection];
      await fs.writeFile(defPath, JSON.stringify(def, null, 2) + "\n", "utf-8");
    }
    if (def.detailUrlPrefix === null) {
      throw new Error(`seedDetailPageFixtures: ${fixture.collection} has no detail URL`);
    }

    const itemsDir = path.join(collectionDir, "items");
    await fs.mkdir(itemsDir, { recursive: true });
    const item = {
      id: `item_${fixture.itemSlug.replaceAll("-", "_")}`,
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: fixture.values,
    };
    await fs.writeFile(
      path.join(itemsDir, `${fixture.itemSlug}.json`),
      JSON.stringify(item, null, 2) + "\n",
      "utf-8",
    );
    urls[fixture.collection] = `${def.detailUrlPrefix.replace(/\/$/, "")}/${fixture.itemSlug}`;
  }
  return urls as Record<DetailFixtureCollection, string>;
}
