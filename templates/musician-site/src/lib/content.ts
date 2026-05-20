/**
 * Read/write helpers for pages and singletons.
 *
 * As of ADR-009 PR 3, storage lives under
 * `src/content/collections/{pages,site,header,appearance}/` with each
 * surface modelled as a `CollectionDef` (`./collections/seeds.ts`).
 * This module is the compatibility layer between the old
 * `PageData` / `SiteConfig` / `HeaderConfig` / `Appearance` API that
 * the admin UI + public renderer still call, and the new item store.
 *
 * The translation goes both ways:
 *
 *   - read paths fetch an `Item`, run it through the converters in
 *     `./collections/migrate-from-legacy.ts`, return the legacy shape.
 *   - write paths take the legacy shape, convert to an `Item`, write
 *     through the collection store.
 *
 * `pageOrder` and `hiddenFromNav` on `SiteConfig` are now derived from
 * the pages collection (`items/_order.json` and each page's
 * `showInNav` field). Writing them through `writeSiteConfig` routes
 * to those locations transparently.
 */

import type { Data } from "@measured/puck";

import type { BlockProps } from "@/puck/config";

import {
  pagesCollectionDef,
  siteCollectionDef,
  headerCollectionDef,
  appearanceCollectionDef,
  PREBAKED_COLLECTIONS,
  PAGES_FIELD_IDS,
} from "./collections/seeds";
import {
  appearanceFromItem,
  appearanceToItemValues,
  headerConfigFromItem,
  headerConfigToItemValues,
  pageDataFromItem,
  pageDataToItem,
  pageDataToItemValues,
  siteConfigFromItem,
  siteConfigToItemValues,
} from "./collections/migrate-from-legacy";
import {
  collectionDefRepoPath,
  deleteItem,
  generateItemId,
  itemRepoPath,
  listItemSlugs,
  listItemsInOrder,
  orderRepoPath,
  readCollectionDef,
  readItem,
  readOrder,
  readSingleton,
  SINGLETON_ITEM_SLUG,
  writeCollectionDef,
  writeItem,
  writeOrder,
  writeSingleton,
} from "./collections";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_SITE_CONFIG,
  pageRootPropsSchema,
  pageSlugSchema,
  type Appearance,
  type HeaderConfig,
  type PageRootProps,
  type PageSummary,
  type SiteConfig,
} from "./site-config-types";

export type PageData = Data<BlockProps>;

// ---------------------------------------------------------------------------
// Repo paths used by the publish layer (relative to repo root)
// ---------------------------------------------------------------------------

/** Where the on-disk site singleton ends up. Exported for publish targets. */
export const SITE_SINGLETON_REPO_PATH = itemRepoPath("site", SINGLETON_ITEM_SLUG);
export const HEADER_SINGLETON_REPO_PATH = itemRepoPath("header", SINGLETON_ITEM_SLUG);
export const APPEARANCE_SINGLETON_REPO_PATH = itemRepoPath("appearance", SINGLETON_ITEM_SLUG);

/** Path to the pages collection's order file (manual ordering). */
export const PAGES_ORDER_REPO_PATH = orderRepoPath("pages");

/** Path to a specific page item. */
export function pageRepoPath(slug: string): string {
  return itemRepoPath("pages", slug);
}

/**
 * Path to a collection's `_collection.json` — used by the publish
 * layer when the def needs to ship alongside its items (e.g. fresh
 * artist site, or after a schema edit).
 */
export function collectionDefRepoPathFor(slug: string): string {
  return collectionDefRepoPath(slug);
}

// ---------------------------------------------------------------------------
// Bootstrap: ensure the prebaked CollectionDefs exist on disk
// ---------------------------------------------------------------------------

/**
 * Write every prebaked `_collection.json` if it's not already on disk.
 * Called lazily before any read so a fresh artist site (or one that
 * pre-dates ADR-009) doesn't fail on "collection not found" for any of
 * the ten prebaked surfaces. After the migration ships, every artist
 * repo has these committed and this is a no-op.
 *
 * Iterates `PREBAKED_COLLECTIONS` directly so a new entry there
 * automatically gets bootstrapped — no second place to keep in sync.
 *
 * Memoised per content-dir (the value of `STAGECRAFT_CONTENT_DIR`).
 * Tests that run against multiple tmpdirs see independent caches;
 * production sees a single one. Tests that wipe their content dir
 * between cases should call `__resetBootstrapCacheForTests()` to
 * force a re-check on the next read.
 */
const bootstrapped = new Set<string>();
const bootstrapKey = () => process.env.STAGECRAFT_CONTENT_DIR ?? "<default>";

async function ensurePrebakedCollections(): Promise<void> {
  const key = bootstrapKey();
  if (bootstrapped.has(key)) return;
  await Promise.all(
    Object.values(PREBAKED_COLLECTIONS).map((def) =>
      ensureCollectionDef(def.slug, def),
    ),
  );
  bootstrapped.add(key);
}

/** Test-only: clear the bootstrap cache so the next call re-checks disk. */
export function __resetBootstrapCacheForTests(): void {
  bootstrapped.clear();
}

async function ensureCollectionDef(
  slug: string,
  def: import("./collections/schema").CollectionDef,
): Promise<void> {
  const existing = await readCollectionDef(slug);
  if (existing) return;
  await writeCollectionDef(slug, def);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export class PageNotFoundError extends Error {
  constructor(public slug: string) {
    super(`No page with slug "${slug}"`);
    this.name = "PageNotFoundError";
  }
}

export class PageExistsError extends Error {
  constructor(public slug: string) {
    super(`A page with slug "${slug}" already exists`);
    this.name = "PageExistsError";
  }
}

export async function readPage(slug: string): Promise<PageData> {
  pageSlugSchema.parse(slug);
  await ensurePrebakedCollections();
  const item = await readItem("pages", slug, pagesCollectionDef);
  if (!item) throw new PageNotFoundError(slug);
  return pageDataFromItem(item) as PageData;
}

export async function readPageOrNull(slug: string): Promise<PageData | null> {
  try {
    return await readPage(slug);
  } catch (cause) {
    if (cause instanceof PageNotFoundError) return null;
    throw cause;
  }
}

export async function writePage(slug: string, data: PageData): Promise<void> {
  pageSlugSchema.parse(slug);
  await ensurePrebakedCollections();
  // Preserve the existing id + createdAt + showInNav across updates
  // so the collection model's stable-identity contract holds and the
  // page's nav-visibility isn't reset on every save.
  const existing = await readItem("pages", slug, pagesCollectionDef);
  const showInNav = readShowInNav(existing) ?? true;
  const item = pageDataToItem(slug, data, {
    id: existing?.id ?? generateItemId(),
    createdAt: existing?.createdAt,
    showInNav,
  });
  await writeItem("pages", slug, item, pagesCollectionDef);
}

function readShowInNav(item: import("./collections/schema").Item | null): boolean | null {
  if (!item) return null;
  const v = item.values[PAGES_FIELD_IDS.showInNav];
  return v && v.type === "boolean" ? v.value : null;
}

export async function deletePage(slug: string): Promise<void> {
  pageSlugSchema.parse(slug);
  await deleteItem("pages", slug);
}

export async function listPageSlugs(): Promise<string[]> {
  await ensurePrebakedCollections();
  return listItemSlugs("pages");
}

/**
 * Read the root props for a single page. Kept as an export because the
 * editor's pre-mount hydration calls it. Reaches into the on-disk shape
 * that the public renderer also consumes.
 */
export function extractPageRootProps(data: PageData): PageRootProps {
  const props = (data?.root?.props ?? {}) as Record<string, unknown>;
  return pageRootPropsSchema.parse({
    title: typeof props.title === "string" ? props.title : "Untitled",
    isSplashPage: props.isSplashPage === true,
    isFooterHidden: props.isFooterHidden === true,
  });
}

export async function listPageSummaries(): Promise<PageSummary[]> {
  await ensurePrebakedCollections();
  // listItemsInOrder honours the pages collection's manual `_order.json`,
  // falling back to alphabetic for items not present in the file.
  const items = await listItemsInOrder("pages", pagesCollectionDef);
  const summaries: PageSummary[] = items.map((item) => {
    const titleValue = item.values[PAGES_FIELD_IDS.title];
    const splashValue = item.values[PAGES_FIELD_IDS.isSplashPage];
    const showInNavValue = item.values[PAGES_FIELD_IDS.showInNav];
    return {
      slug: item.slug,
      title: titleValue?.type === "text" ? titleValue.value : "Untitled",
      isSplashPage: splashValue?.type === "boolean" ? splashValue.value : false,
      // `showInNav` defaults to true if the field is absent (new pages
      // appear in the nav unless explicitly hidden).
      isHiddenFromNav:
        showInNavValue?.type === "boolean" ? !showInNavValue.value : false,
    };
  });
  // Splash pages always float to the top — same affordance as the
  // legacy admin: the splash override is visible at a glance.
  return summaries.sort((a, b) => (a.isSplashPage === b.isSplashPage ? 0 : a.isSplashPage ? -1 : 1));
}

/**
 * Find the page that owns "/" — either the splash override, or the page
 * with slug "home", or the first available page.
 */
export async function resolveRootPageSlug(): Promise<string | null> {
  const summaries = await listPageSummaries();
  const splash = summaries.find((p) => p.isSplashPage);
  if (splash) return splash.slug;
  if (summaries.some((p) => p.slug === "home")) return "home";
  return summaries[0]?.slug ?? null;
}

/**
 * Build the starter content for a new page. The shape stays
 * Puck-flavoured for the editor's onPublish handler.
 */
export function emptyPageData(title: string): PageData {
  return {
    content: [
      {
        type: "Heading",
        props: {
          id: `heading-${Date.now()}`,
          text: title,
          level: "h1",
          textAlign: "start",
        },
      },
    ],
    root: { props: { title, isSplashPage: false, isFooterHidden: false } },
  } as PageData;
}

// ---------------------------------------------------------------------------
// Site singleton
// ---------------------------------------------------------------------------

export async function readSiteConfig(): Promise<SiteConfig> {
  await ensurePrebakedCollections();
  const [siteItem, pageOrder, pages] = await Promise.all([
    readSingleton("site", siteCollectionDef),
    readOrder("pages"),
    listPageSummaries(),
  ]);
  const base = siteConfigFromItem(siteItem);
  return {
    ...base,
    // pageOrder is the manual order file when present, otherwise the
    // existing sort order from listPageSummaries (alphabetic).
    pageOrder: pageOrder ?? pages.map((p) => p.slug),
    hiddenFromNav: pages.filter((p) => p.isHiddenFromNav).map((p) => p.slug),
  };
}

/**
 * Write the site config. Page-nav fields route to the pages collection:
 * `pageOrder` updates `items/_order.json`; `hiddenFromNav` flips
 * `showInNav` on each affected page item. Both happen in addition to
 * the singleton write; callers that batch through `publish.ts` should
 * pass the corresponding targets in one call.
 */
export async function writeSiteConfig(config: SiteConfig): Promise<void> {
  await ensurePrebakedCollections();
  const existing = await readSingleton("site", siteCollectionDef);
  const item = {
    id: existing?.id ?? generateItemId(),
    slug: SINGLETON_ITEM_SLUG,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    values: siteConfigToItemValues(config),
  };
  await writeSingleton("site", item, siteCollectionDef);
  await writeOrder("pages", config.pageOrder);
  await applyHiddenFromNav(config.hiddenFromNav);
}

/**
 * Flip every page's `showInNav` to match `hiddenFromNav`. Pages absent
 * from the list become visible; pages present become hidden. Used by
 * `writeSiteConfig` to translate the legacy `hiddenFromNav` field into
 * per-page state.
 */
async function applyHiddenFromNav(hiddenSlugs: readonly string[]): Promise<void> {
  const hidden = new Set(hiddenSlugs);
  const slugs = await listItemSlugs("pages");
  await Promise.all(
    slugs.map(async (slug) => {
      const item = await readItem("pages", slug, pagesCollectionDef);
      if (!item) return;
      const currentValue = item.values[PAGES_FIELD_IDS.showInNav];
      const currentlyShown =
        currentValue?.type === "boolean" ? currentValue.value : true;
      const shouldShow = !hidden.has(slug);
      if (currentlyShown === shouldShow) return;
      const updated = {
        ...item,
        values: {
          ...item.values,
          [PAGES_FIELD_IDS.showInNav]: { type: "boolean" as const, value: shouldShow },
        },
      };
      await writeItem("pages", slug, updated, pagesCollectionDef);
    }),
  );
}

// ---------------------------------------------------------------------------
// Header singleton
// ---------------------------------------------------------------------------

export async function readHeaderConfig(): Promise<HeaderConfig> {
  await ensurePrebakedCollections();
  const item = await readSingleton("header", headerCollectionDef);
  return headerConfigFromItem(item);
}

export async function writeHeaderConfig(config: HeaderConfig): Promise<void> {
  await ensurePrebakedCollections();
  const existing = await readSingleton("header", headerCollectionDef);
  await writeSingleton(
    "header",
    {
      id: existing?.id ?? generateItemId(),
      slug: SINGLETON_ITEM_SLUG,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      values: headerConfigToItemValues(config),
    },
    headerCollectionDef,
  );
}

// ---------------------------------------------------------------------------
// Appearance singleton
// ---------------------------------------------------------------------------

export async function readAppearance(): Promise<Appearance> {
  await ensurePrebakedCollections();
  const item = await readSingleton("appearance", appearanceCollectionDef);
  return appearanceFromItem(item);
}

export async function writeAppearance(config: Appearance): Promise<void> {
  await ensurePrebakedCollections();
  const existing = await readSingleton("appearance", appearanceCollectionDef);
  await writeSingleton(
    "appearance",
    {
      id: existing?.id ?? generateItemId(),
      slug: SINGLETON_ITEM_SLUG,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      values: appearanceToItemValues(config),
    },
    appearanceCollectionDef,
  );
}

// ---------------------------------------------------------------------------
// Re-export legacy defaults for callers that still consume them
// ---------------------------------------------------------------------------

export { DEFAULT_APPEARANCE, DEFAULT_HEADER_CONFIG, DEFAULT_SITE_CONFIG };

// ---------------------------------------------------------------------------
// Defensive: surface the helpers used by per-build conversion paths
// (pageDataToItem etc.) so callers don't have to know about the
// migrate-from-legacy module.
// ---------------------------------------------------------------------------

export {
  pageDataToItem,
  pageDataToItemValues,
  siteConfigToItemValues,
  headerConfigToItemValues,
  appearanceToItemValues,
};
