import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  __resetBootstrapCacheForTests,
  deletePage,
  emptyPageData,
  extractPageRootProps,
  listPageSummaries,
  PageNotFoundError,
  readAppearance,
  readHeaderConfig,
  readPage,
  readPageOrNull,
  readSiteConfig,
  resolveRootPageSlug,
  writePage,
  type PageData,
} from "./content";
import {
  PAGES_FIELD_IDS,
  appearanceCollectionDef,
  headerCollectionDef,
  siteCollectionDef,
} from "./collections/seeds";
import {
  generateItemId,
  SINGLETON_ITEM_SLUG,
  writeItem,
  writeOrder,
  writeSingleton,
} from "./collections";
import {
  appearanceToItemValues,
  headerConfigToItemValues,
  siteConfigToItemValues,
} from "./collections/migrate-from-legacy-values";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_SITE_CONFIG,
} from "./site-config-types";

/**
 * Helpers for tests that previously used the now-removed
 * `writeSiteConfig` / `writeHeaderConfig` / `writeAppearance`
 * wrappers. Inline the equivalent collection-store calls — `id` is
 * stable across writes (generateItemId once) so multiple sequential
 * writes don't re-mint identity.
 */
async function writeSiteSingleton(cfg: Parameters<typeof siteConfigToItemValues>[0]) {
  const now = new Date().toISOString();
  await writeSingleton(
    "site",
    {
      id: generateItemId(),
      slug: SINGLETON_ITEM_SLUG,
      createdAt: now,
      updatedAt: now,
      values: siteConfigToItemValues(cfg),
    },
    siteCollectionDef,
  );
}
async function writeHeaderSingleton(cfg: Parameters<typeof headerConfigToItemValues>[0]) {
  const now = new Date().toISOString();
  await writeSingleton(
    "header",
    {
      id: generateItemId(),
      slug: SINGLETON_ITEM_SLUG,
      createdAt: now,
      updatedAt: now,
      values: headerConfigToItemValues(cfg),
    },
    headerCollectionDef,
  );
}
async function writeAppearanceSingleton(cfg: Parameters<typeof appearanceToItemValues>[0]) {
  const now = new Date().toISOString();
  await writeSingleton(
    "appearance",
    {
      id: generateItemId(),
      slug: SINGLETON_ITEM_SLUG,
      createdAt: now,
      updatedAt: now,
      values: appearanceToItemValues(cfg),
    },
    appearanceCollectionDef,
  );
}
async function setHiddenFromNavLegacy(hiddenSlugs: readonly string[]) {
  // Replaces the removed `applyHiddenFromNav` — read each page item,
  // flip its showInNav field. Used by tests that previously set the
  // legacy `siteConfig.hiddenFromNav` and now need to reach the same
  // on-disk state.
  const { listItemSlugs, readItem } = await import("./collections");
  const { pagesCollectionDef } = await import("./collections/seeds");
  const hidden = new Set(hiddenSlugs);
  const slugs = await listItemSlugs("pages");
  for (const slug of slugs) {
    const item = await readItem("pages", slug, pagesCollectionDef);
    if (!item) continue;
    const shouldShow = !hidden.has(slug);
    const next = {
      ...item,
      values: {
        ...item.values,
        [PAGES_FIELD_IDS.showInNav]: { type: "boolean" as const, value: shouldShow },
      },
    };
    await writeItem("pages", slug, next, pagesCollectionDef);
  }
}

/**
 * Tests run against an isolated tmpdir (pointed at via STAGECRAFT_CONTENT_DIR)
 * so parallel test files (e.g. publish.test.ts) can't race on the same
 * `src/content/...` files. The seed mirrors the checked-in shape — a single
 * `home` item at the post-PR-3 location — so tests that assume "home
 * exists" keep working.
 */
const HOME_ITEM_FIXTURE = {
  id: "item_home_fixture",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  values: {
    [PAGES_FIELD_IDS.title]: { type: "text", value: "Home" },
    [PAGES_FIELD_IDS.isSplashPage]: { type: "boolean", value: false },
    [PAGES_FIELD_IDS.isFooterHidden]: { type: "boolean", value: false },
    [PAGES_FIELD_IDS.showInNav]: { type: "boolean", value: true },
    [PAGES_FIELD_IDS.body]: {
      type: "puckContent",
      value: {
        content: [
          {
            type: "Heading",
            props: { id: "heading-1", text: "Welcome", level: "h1", textAlign: "center" },
          },
        ],
        root: { props: {} },
      },
    },
  },
};

let TMP_CONTENT_DIR: string;
let PAGES_ITEMS_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-content-"));
  PAGES_ITEMS_DIR = path.join(TMP_CONTENT_DIR, "collections/pages/items");
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  // Reset the per-content-dir bootstrap cache so each test re-runs
  // the def-seeding step against the (re-cleared) tmpdir.
  __resetBootstrapCacheForTests();
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
  await fs.mkdir(PAGES_ITEMS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(PAGES_ITEMS_DIR, "home.json"),
    JSON.stringify(HOME_ITEM_FIXTURE, null, 2) + "\n",
    "utf-8",
  );
});

function testSlug(name: string): string {
  return `${name}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

const createdSlugs = new Set<string>();

afterEach(async () => {
  // The full-content-dir wipe in beforeEach handles cleanup, but
  // empty the bookkeeping set so test names don't leak.
  createdSlugs.clear();
});

async function createPage(slug: string, data: PageData) {
  createdSlugs.add(slug);
  await writePage(slug, data);
}

describe("emptyPageData", () => {
  it("includes a heading and root props with the title", () => {
    const data = emptyPageData("Hello");
    expect(data.content).toHaveLength(1);
    expect(data.content[0].type).toBe("Heading");
    expect((data.content[0].props as { text: string }).text).toBe("Hello");
    expect((data.root as { props: { title: string } }).props.title).toBe("Hello");
  });

  it("defaults root flags to false", () => {
    const data = emptyPageData("Hello");
    const props = (data.root as {
      props: { isSplashPage: boolean; isFooterHidden: boolean };
    }).props;
    expect(props.isSplashPage).toBe(false);
    expect(props.isFooterHidden).toBe(false);
  });
});

describe("readPage / writePage", () => {
  it("round-trips a page through disk", async () => {
    const slug = testSlug("round-trip");
    const data = emptyPageData("My Page");
    await createPage(slug, data);

    const read = await readPage(slug);
    expect(read).toEqual(data);
  });

  it("readPage throws PageNotFoundError when the file is missing", async () => {
    await expect(readPage(testSlug("missing"))).rejects.toBeInstanceOf(PageNotFoundError);
  });

  it("readPageOrNull returns null for missing files", async () => {
    const out = await readPageOrNull(testSlug("missing"));
    expect(out).toBeNull();
  });

  it("rejects an invalid slug", async () => {
    await expect(readPage("UPPER")).rejects.toThrow();
    await expect(writePage("UPPER", emptyPageData("x"))).rejects.toThrow();
  });
});

describe("deletePage", () => {
  it("removes the file when it exists", async () => {
    const slug = testSlug("delete-me");
    await createPage(slug, emptyPageData("Delete Me"));
    expect(await readPageOrNull(slug)).not.toBeNull();

    await deletePage(slug);
    expect(await readPageOrNull(slug)).toBeNull();
    createdSlugs.delete(slug);
  });

  it("is a no-op when the file is already missing", async () => {
    await expect(deletePage(testSlug("never-existed"))).resolves.toBeUndefined();
  });
});

describe("listPageSummaries", () => {
  it("includes every test-created page with its title and splash flag", async () => {
    const slugA = testSlug("zzz-alpha");
    const slugB = testSlug("aaa-bravo");
    await createPage(slugA, emptyPageData("Alpha"));
    const splashData = emptyPageData("Bravo");
    (splashData.root as { props: { isSplashPage: boolean } }).props.isSplashPage = true;
    await createPage(slugB, splashData);

    const summaries = await listPageSummaries();
    const ours = summaries.filter((s) => s.slug === slugA || s.slug === slugB);

    // Splash page (slugB) sorts before non-splash (slugA) regardless of
    // alphabetical order.
    expect(ours.map((s) => s.slug)).toEqual([slugB, slugA]);
    expect(ours.find((s) => s.slug === slugB)?.isSplashPage).toBe(true);
    expect(ours.find((s) => s.slug === slugA)?.isSplashPage).toBe(false);
    expect(ours.find((s) => s.slug === slugA)?.title).toBe("Alpha");
  });

  it("orders by siteConfig.pageOrder when present", async () => {
    // Create three pages in alphabetical order, then set pageOrder
    // explicitly to a non-alphabetical sequence. The listing should
    // follow pageOrder, not the alphabetical fallback.
    const slugs = [
      testSlug("zzz-third"),
      testSlug("aaa-first"),
      testSlug("mmm-second"),
    ];
    for (const slug of slugs) await createPage(slug, emptyPageData(slug));

    await writeOrder("pages", [slugs[1], slugs[2], slugs[0]]);

    const summaries = await listPageSummaries();
    const ours = summaries.filter((s) => slugs.includes(s.slug));
    expect(ours.map((s) => s.slug)).toEqual([slugs[1], slugs[2], slugs[0]]);
  });

  it("appends unordered pages (not in pageOrder) alphabetically", async () => {
    const ordered = testSlug("aaa-pinned");
    const unorderedZ = testSlug("zzz-unpinned");
    const unorderedM = testSlug("mmm-unpinned");
    await createPage(ordered, emptyPageData("Pinned"));
    await createPage(unorderedZ, emptyPageData("ZUnpinned"));
    await createPage(unorderedM, emptyPageData("MUnpinned"));

    await writeOrder("pages", [ordered]);

    const summaries = await listPageSummaries();
    const ours = summaries
      .filter((s) => [ordered, unorderedZ, unorderedM].includes(s.slug))
      .map((s) => s.slug);
    // Pinned comes first, then unordered pages in alpha order.
    expect(ours).toEqual([ordered, unorderedM, unorderedZ]);
  });

  it("populates isHiddenFromNav from siteConfig.hiddenFromNav", async () => {
    const hidden = testSlug("hidden-page");
    const visible = testSlug("visible-page");
    await createPage(hidden, emptyPageData("Hidden"));
    await createPage(visible, emptyPageData("Visible"));

    await setHiddenFromNavLegacy([hidden]);

    const summaries = await listPageSummaries();
    expect(summaries.find((s) => s.slug === hidden)?.isHiddenFromNav).toBe(true);
    expect(summaries.find((s) => s.slug === visible)?.isHiddenFromNav).toBe(false);
  });
});

describe("resolveRootPageSlug", () => {
  it("returns the splash page when one exists", async () => {
    const slug = testSlug("splash-page");
    const data = emptyPageData("Splash");
    (data.root as { props: { isSplashPage: boolean } }).props.isSplashPage = true;
    await createPage(slug, data);

    expect(await resolveRootPageSlug()).toBe(slug);
  });

  it("returns 'home' when no splash but home.json exists", async () => {
    // home.json is checked into the repo, so this should hold by default.
    expect(await resolveRootPageSlug()).toBe("home");
  });
});

describe("extractPageRootProps", () => {
  it("normalizes missing fields to defaults", () => {
    const props = extractPageRootProps({
      content: [],
      root: { props: { title: "x" } },
    } as PageData);
    expect(props).toEqual({ title: "x", isSplashPage: false, isFooterHidden: false });
  });

  it("preserves explicit values", () => {
    const props = extractPageRootProps({
      content: [],
      root: {
        props: { title: "y", isSplashPage: true, isFooterHidden: true },
      },
    } as PageData);
    expect(props).toEqual({ title: "y", isSplashPage: true, isFooterHidden: true });
  });

  it("falls back to 'Untitled' when title is missing", () => {
    const props = extractPageRootProps({
      content: [],
      root: { props: {} },
    } as PageData);
    expect(props.title).toBe("Untitled");
  });
});

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

describe("singleton reads return defaults when no file exists", () => {
  it("readSiteConfig returns DEFAULT_SITE_CONFIG in a clean dir", async () => {
    const cfg = await readSiteConfig();
    expect(cfg.artistName).toBe(DEFAULT_SITE_CONFIG.artistName);
    expect(cfg.contactEmail).toMatch(/@/);
  });

  it("readHeaderConfig returns DEFAULT_HEADER_CONFIG", async () => {
    const cfg = await readHeaderConfig();
    expect(cfg.headerMode).toBe(DEFAULT_HEADER_CONFIG.headerMode);
    expect(cfg.headerLayout).toBe(DEFAULT_HEADER_CONFIG.headerLayout);
  });

  it("readAppearance returns DEFAULT_APPEARANCE", async () => {
    const cfg = await readAppearance();
    expect(cfg.colors.primary).toBe(DEFAULT_APPEARANCE.colors.primary);
  });
});

describe("write* + read* round-trip through disk", () => {
  // afterEach (above) clears the tmpdir's config/ between tests so each
  // round-trip starts from a clean slate.

  it("siteConfigToItemValues + readSiteConfig round-trip", async () => {
    const cfg = { ...DEFAULT_SITE_CONFIG, artistName: "Test Artist" };
    await writeSiteSingleton(cfg);
    const out = await readSiteConfig();
    expect(out.artistName).toBe("Test Artist");
  });

  it("headerConfigToItemValues + readHeaderConfig round-trip", async () => {
    const cfg = {
      ...DEFAULT_HEADER_CONFIG,
      headerMode: "transparent-static" as const,
      headerSubtitle: "Bandleader / Pianist",
    };
    await writeHeaderSingleton(cfg);
    const out = await readHeaderConfig();
    expect(out.headerMode).toBe("transparent-static");
    expect(out.headerSubtitle).toBe("Bandleader / Pianist");
  });

  it("appearanceToItemValues + readAppearance round-trip", async () => {
    const cfg = {
      ...DEFAULT_APPEARANCE,
      colors: { ...DEFAULT_APPEARANCE.colors, primary: "#abcdef" },
    };
    await writeAppearanceSingleton(cfg);
    const out = await readAppearance();
    expect(out.colors.primary).toBe("#abcdef");
  });
});

describe("ensurePrebakedCollections", () => {
  it("writes every PREBAKED_COLLECTIONS entry to disk on first access", async () => {
    // Triggering any page read fires the bootstrap.
    await readPageOrNull("home");

    // Every key in `PREBAKED_COLLECTIONS` should now have a
    // `_collection.json` on disk. Before this fix, only pages / site /
    // header / appearance got bootstrapped — tour-dates, releases,
    // posts, store-items, photos, and videos were unreachable on a
    // fresh artist site because `listCollectionSlugs()` reads from
    // disk and ignored the registry.
    const { PREBAKED_COLLECTIONS } = await import("./collections/seeds");
    for (const slug of Object.keys(PREBAKED_COLLECTIONS)) {
      const defPath = path.join(
        TMP_CONTENT_DIR,
        "collections",
        slug,
        "_collection.json",
      );
      const exists = await fs
        .access(defPath)
        .then(() => true)
        .catch(() => false);
      expect(exists, `${slug}: _collection.json not bootstrapped`).toBe(true);
    }
  });
});
