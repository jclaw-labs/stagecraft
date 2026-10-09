/**
 * Read helpers for pages and singletons.
 *
 * Storage lives under `src/content/collections/{pages,site,header,appearance}/`
 * with each surface modelled as a `CollectionDef` (`./collections/seeds.ts`).
 * This module reads items from the store and converts them back to the
 * `PageData` / `SiteConfig` / `HeaderConfig` / `Appearance` shapes the
 * public renderer and admin pages consume, using the converters in
 * `./collections/migrate-from-legacy.ts`.
 *
 * Writes don't go through here: every admin save builds its item in
 * memory and commits it through `saveContent` (`./save-content.ts`),
 * and pages save through the generic `/api/collections/pages/...` routes.
 *
 * `pageOrder` and `hiddenFromNav` on `SiteConfig` are derived from the
 * pages collection (`items/_order.json` and each page's `showInNav`
 * field).
 */

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
  headerConfigFromItem,
  pageDataFromItem,
  siteConfigFromItem,
} from "./collections/migrate-from-legacy";
import {
  collectionDefRepoPath,
  itemRepoPath,
  orderRepoPath,
  readCollectionDef,
  SINGLETON_ITEM_SLUG,
  writeCollectionDef,
  type ReadStore,
} from "./collections";
import { imageMetadataSchema, type ImageMetadata } from "./image-types";
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
import { contentDir, purgeOrphanTmps } from "./fs-helpers";
import type { PageData } from "./page-data";

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
  // Once per process, sweep any orphan `<file>.tmp-...` artifacts a
  // previous hard-crash (OOM, SIGKILL, reboot) left behind. The
  // atomic-write helpers in `fs-helpers.ts` clean up after JS-level
  // throws but can't run during a crash. Threshold is the default
  // 15 minutes — anything older than that is almost certainly
  // orphaned. Fire-and-forget on failure: a janitor error
  // shouldn't block normal content reads.
  await purgeOrphanTmps(contentDir()).catch(() => {});
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

export async function readPage(slug: string, store: ReadStore): Promise<PageData> {
  pageSlugSchema.parse(slug);
  await ensurePrebakedCollections();
  const item = await store.readItem("pages", slug, pagesCollectionDef);
  if (!item) throw new PageNotFoundError(slug);
  return pageDataFromItem(item) as PageData;
}

export async function readPageOrNull(
  slug: string,
  store: ReadStore,
): Promise<PageData | null> {
  try {
    return await readPage(slug, store);
  } catch (cause) {
    if (cause instanceof PageNotFoundError) return null;
    throw cause;
  }
}

export async function listPageSlugs(store: ReadStore): Promise<string[]> {
  await ensurePrebakedCollections();
  return store.listItemSlugs("pages");
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
    // Validate against `imageMetadataSchema` here rather than relying
    // on `pageRootPropsSchema.parse(...)` — the outer parse throws on
    // an invalid shape, but a malformed `pageBackground` (hand-edited
    // JSON, schema drift) shouldn't take down the public page
    // renderer. Fall back to null on any validation failure.
    pageBackground: validatePageBackground(props.pageBackground),
    // Per-page overlay opacity: null inherits site default; a number
    // 0..1 overrides. Out-of-range / non-number values fall back to
    // null (inherit) rather than throwing.
    pageBackgroundOverlay: validateOverlayOpacity(props.pageBackgroundOverlay),
  });
}

function validatePageBackground(value: unknown): ImageMetadata | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const result = imageMetadataSchema.safeParse(value);
  return result.success ? result.data : null;
}

function validateOverlayOpacity(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

export async function listPageSummaries(store: ReadStore): Promise<PageSummary[]> {
  await ensurePrebakedCollections();
  // listItemsInOrder honours the pages collection's manual `_order.json`,
  // falling back to alphabetic for items not present in the file.
  const items = await store.listItemsInOrder("pages", pagesCollectionDef);
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
export async function resolveRootPageSlug(store: ReadStore): Promise<string | null> {
  const summaries = await listPageSummaries(store);
  const splash = summaries.find((p) => p.isSplashPage);
  if (splash) return splash.slug;
  if (summaries.some((p) => p.slug === "home")) return "home";
  return summaries[0]?.slug ?? null;
}

// ---------------------------------------------------------------------------
// Site singleton
// ---------------------------------------------------------------------------

export async function readSiteConfig(store: ReadStore): Promise<SiteConfig> {
  await ensurePrebakedCollections();
  const [siteItem, pageOrder, pages] = await Promise.all([
    store.readSingleton("site", siteCollectionDef),
    store.readOrder("pages"),
    listPageSummaries(store),
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

// ---------------------------------------------------------------------------
// Header singleton
// ---------------------------------------------------------------------------

export async function readHeaderConfig(store: ReadStore): Promise<HeaderConfig> {
  await ensurePrebakedCollections();
  const item = await store.readSingleton("header", headerCollectionDef);
  return headerConfigFromItem(item);
}

// ---------------------------------------------------------------------------
// Appearance singleton
// ---------------------------------------------------------------------------

export async function readAppearance(store: ReadStore): Promise<Appearance> {
  await ensurePrebakedCollections();
  const item = await store.readSingleton("appearance", appearanceCollectionDef);
  return appearanceFromItem(item);
}

// ---------------------------------------------------------------------------
// Re-export legacy defaults for callers that still consume them
// ---------------------------------------------------------------------------

export { DEFAULT_APPEARANCE, DEFAULT_HEADER_CONFIG, DEFAULT_SITE_CONFIG };
