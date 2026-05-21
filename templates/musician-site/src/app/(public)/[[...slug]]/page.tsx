import { Render } from "@measured/puck";
import "@measured/puck/puck.css";
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import {
  describeRoutingConflict,
  listCollectionSlugs,
  readCollectionDef,
  readItem,
  resolveCollectionItemUrl,
  slugSchema,
  validateCollectionRouting,
  type CollectionDef,
  type Item,
} from "@/lib/collections";
import {
  buildCollectionBlockRegistry,
  DefaultItemFieldsList,
} from "@/lib/collections/template/collection-block";
import { loadCollectionsForTemplate } from "@/lib/collections/template/load-collections";
import { PRIMITIVE_BLOCKS } from "@/lib/collections/template/primitives";
import { buildTemplatePuckConfig } from "@/lib/collections/template/puck-config";
import { resolveTemplate } from "@/lib/collections/template/renderer";
import type { Template } from "@/lib/collections/template/types";
import {
  extractPageRootProps,
  listPageSlugs,
  listPageSummaries,
  readHeaderConfig,
  readPageOrNull,
  readSiteConfig,
  resolveRootPageSlug,
} from "@/lib/content";
import { pageSlugSchema } from "@/lib/site-config-types";
import { puckConfig } from "@/puck/config";

// ---------------------------------------------------------------------------
// Per-request caches
//
// The catch-all + generateMetadata both walk the collection registry
// (slugs + defs) and read the site / header singletons. React.cache()
// dedupes those reads within a single request lifecycle — both
// `generateMetadata` (which runs first) and the page render share the
// same cached call results. Module-level memoisation would be wrong
// here because the on-disk state can change between requests (the
// admin writes definitions / items; tests reset state). React.cache()
// is request-scoped: stale data can't leak across requests.
// ---------------------------------------------------------------------------

const cachedListCollectionSlugs = cache(listCollectionSlugs);
const cachedReadCollectionDef = cache(readCollectionDef);
const cachedReadSiteConfig = cache(readSiteConfig);
const cachedReadHeaderConfig = cache(readHeaderConfig);
const cachedListPageSummaries = cache(listPageSummaries);
const cachedReadPageOrNull = cache(readPageOrNull);
// resolveRootPageSlug calls listPageSummaries internally; wrap it at
// this layer so root-URL requests don't trigger that read twice (once
// per generateMetadata + render path).
const cachedResolveRootPageSlug = cache(resolveRootPageSlug);

/**
 * Load every collection's def in parallel, filter out nulls, and
 * sort deterministically. Cached per-request so successive callers
 * see the same array without re-reading.
 */
const cachedAllDefs = cache(async (): Promise<CollectionDef[]> => {
  const slugs = await cachedListCollectionSlugs();
  const defs = await Promise.all(slugs.map((s) => cachedReadCollectionDef(s)));
  return defs.filter((d): d is CollectionDef => d !== null);
});

type Props = {
  params: Promise<{ slug?: string[] }>;
};

/**
 * Catch-all renderer for every public URL.
 *
 * Dispatch (ADR-009 §8):
 *
 *   1. `validateCollectionRouting` runs first — catches a Page slug
 *      shadowing a collection prefix or two collections claiming
 *      the same prefix. Both can corrupt the public site silently
 *      if allowed.
 *   2. `resolveCollectionItemUrl` matches the URL against every
 *      collection's `detailUrlPrefix` (longest-prefix-first). A
 *      non-Pages match renders the collection's `detailTemplate`.
 *   3. Pages fall through to the legacy `readPageOrNull` flow,
 *      which renders via the page-specific `puckConfig` (root
 *      props + `puckContent` body). Pages don't have a
 *      `detailTemplate` — the page body IS the page, with no
 *      surrounding template — so the legacy flow stays canonical
 *      for Pages until the legacy Pages editor migrates to the
 *      collections surface.
 */
export default async function CatchAllPage({ params }: Props) {
  const { slug: segments } = await params;

  const allDefs = await cachedAllDefs();

  // Routing-conflict check. Only the page slug list is needed here
  // (the conflict check doesn't care about titles or body content),
  // so we read slugs only instead of the heavier `listPageSummaries`
  // which loads every page's `puckContent` body just to extract the
  // title.
  const pageSlugs = await listPageSlugs();
  const conflicts = validateCollectionRouting(allDefs, pageSlugs);
  if (conflicts.length > 0) {
    // A configuration error in the artist's repo. Fail loudly with a
    // structured message; falling through to 404 would hide the real
    // problem from whoever's debugging.
    throw new Error(
      `Collection-routing conflict:\n${conflicts.map(describeRoutingConflict).join("\n")}`,
    );
  }

  const segs = segments ?? [];
  const itemUrl = resolveCollectionItemUrl(segs, allDefs);
  if (itemUrl && itemUrl.collectionSlug !== "pages") {
    // Non-Pages detail page. Pages have their own canonical
    // rendering path below — the resolver returns a `pages`
    // collectionSlug for Page URLs too, but we skip it here so the
    // existing `puckConfig`-based render flow applies. The legacy/
    // collection-detail split for Pages lives until the legacy
    // Pages editor migrates to the collections surface.
    return await renderCollectionItemDetail({
      collectionSlug: itemUrl.collectionSlug,
      itemSlug: itemUrl.itemSlug,
      allDefs,
    });
  }

  return await renderPage({ segs });
}

// ---------------------------------------------------------------------------
// Pages rendering (legacy puckConfig flow — still canonical for Pages)
// ---------------------------------------------------------------------------

async function renderPage({ segs }: { segs: string[] }) {
  let requestedSlug: string;
  if (segs.length === 0) {
    const root = await cachedResolveRootPageSlug();
    if (!root) notFound();
    requestedSlug = root;
  } else if (segs.length === 1) {
    const parsed = pageSlugSchema.safeParse(segs[0]);
    if (!parsed.success) notFound();
    requestedSlug = parsed.data;
  } else {
    // Multi-segment URL didn't match any collection prefix.
    notFound();
  }

  const [pageData, site, header, summaries] = await Promise.all([
    cachedReadPageOrNull(requestedSlug),
    cachedReadSiteConfig(),
    cachedReadHeaderConfig(),
    cachedListPageSummaries(),
  ]);

  if (!pageData) notFound();

  const rootProps = extractPageRootProps(pageData);
  const pageTitleBySlug = new Map(summaries.map((s) => [s.slug, s.title]));
  const navItems = summaries
    .filter((s) => !s.isSplashPage && !s.isHiddenFromNav)
    .map((s) => s.slug);

  // Footer visibility: hidden if either the site-level toggle OR the
  // per-page toggle says hidden. Splash pages always hide both chrome
  // pieces because they're standalone full-bleed landings.
  const hideFooter = rootProps.isSplashPage || site.isFooterHidden || rootProps.isFooterHidden;
  const hideHeader = rootProps.isSplashPage;

  return (
    <PublicPageChrome
      site={site}
      header={header}
      navItems={navItems}
      pageTitleBySlug={pageTitleBySlug}
      hideHeader={hideHeader}
      hideFooter={hideFooter}
    >
      <Render config={puckConfig} data={pageData} />
    </PublicPageChrome>
  );
}

// ---------------------------------------------------------------------------
// Collection-item detail rendering
// ---------------------------------------------------------------------------

async function renderCollectionItemDetail({
  collectionSlug,
  itemSlug,
  allDefs,
}: {
  collectionSlug: string;
  itemSlug: string;
  allDefs: CollectionDef[];
}) {
  const def = allDefs.find((d) => d.slug === collectionSlug);
  if (!def) notFound();
  // Validate the slug shape before the store does — store.ts's
  // `itemSlugSchema.parse` throws on invalid slugs, which would bubble
  // as a 500. A malformed URL is a 404, not an internal error.
  if (!slugSchema.safeParse(itemSlug).success) notFound();
  const item = await readItem(collectionSlug, itemSlug, def);
  if (!item) notFound();

  const [site, header, summaries] = await Promise.all([
    cachedReadSiteConfig(),
    cachedReadHeaderConfig(),
    cachedListPageSummaries(),
  ]);
  const pageTitleBySlug = new Map(summaries.map((s) => [s.slug, s.title]));
  const navItems = summaries
    .filter((s) => !s.isSplashPage && !s.isHiddenFromNav)
    .map((s) => s.slug);

  return (
    <PublicPageChrome
      site={site}
      header={header}
      navItems={navItems}
      pageTitleBySlug={pageTitleBySlug}
      hideHeader={false}
      hideFooter={site.isFooterHidden}
    >
      <CollectionItemBody def={def} item={item} allDefs={allDefs} />
    </PublicPageChrome>
  );
}

/**
 * Shared public-page chrome: Header (unless hidden), `<main>`, the
 * supplied body, Footer (unless hidden). Both the Pages flow and the
 * collection-item-detail flow render through this so the
 * `site.isFooterHidden` toggle stays consistent across detail page
 * types.
 */
function PublicPageChrome({
  site,
  header,
  navItems,
  pageTitleBySlug,
  hideHeader,
  hideFooter,
  children,
}: {
  site: Awaited<ReturnType<typeof readSiteConfig>>;
  header: Awaited<ReturnType<typeof readHeaderConfig>>;
  navItems: string[];
  pageTitleBySlug: Map<string, string>;
  hideHeader: boolean;
  hideFooter: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {hideHeader ? null : (
        <Header
          artistName={site.artistName}
          header={header}
          navItems={navItems}
          pageTitleBySlug={pageTitleBySlug}
        />
      )}
      <main>{children}</main>
      {hideFooter ? null : <Footer site={site} />}
    </>
  );
}

/**
 * Inner render component for a collection item's detail body.
 * Async because it pre-loads the template's Collection-block
 * sources before walking.
 *
 * Takes `allDefs` from the catch-all rather than re-reading every
 * definition. When `detailTemplate` is null, falls back to a
 * minimal "every scalar field as plain text" rendering wrapped in
 * an `<article>` with token-driven inline styles.
 */
async function CollectionItemBody({
  def,
  item,
  allDefs,
}: {
  def: CollectionDef;
  item: Item;
  allDefs: CollectionDef[];
}) {
  const template = def.detailTemplate as Template | null;
  if (!template) {
    return (
      <article
        style={{
          maxWidth: "var(--max-width-content)",
          margin: "var(--space-8) auto",
          padding: "0 var(--space-4)",
        }}
      >
        <h1>{item.slug}</h1>
        <DefaultItemFieldsList item={item} def={def} />
      </article>
    );
  }

  // Build the extended registry: primitives + one Collection block
  // entry per known collection. The dispatcher's render is the same
  // `CollectionBlockRender` component regardless of slug; the slug
  // shows up as the block's `type`.
  const collectionRegistry = buildCollectionBlockRegistry(allDefs.map((d) => d.slug));
  const registry = { ...PRIMITIVE_BLOCKS, ...collectionRegistry };

  const loaded = await loadCollectionsForTemplate(template);
  const resolved = resolveTemplate(template, item, {
    registry,
    currentItem: item,
    loadedCollections: loaded,
  });

  return <Render config={buildTemplatePuckConfig(registry)} data={resolved} />;
}

// ---------------------------------------------------------------------------
// Per-page metadata
// ---------------------------------------------------------------------------

/**
 * Per-page metadata (document title + meta description). Reads from site
 * config + the page's own root.title so each route surfaces a meaningful
 * tab name. Cached reads via the module-level cache wrappers above
 * share results with the page render in the same request.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: segments } = await params;
  const rawSlug = !segments || segments.length === 0
    ? await cachedResolveRootPageSlug()
    : segments[0];

  // Probes for routes that aren't valid page slugs (e.g. `/index.html`,
  // `/favicon.ico` if no app/favicon, `/sitemap.xml`) reach this
  // handler too. Skip the page lookup for anything that won't pass
  // `pageSlugSchema` instead of letting `cachedReadPageOrNull` throw —
  // the unhandled ZodError turns the 404 into a 500 and trips up
  // probes (incl. Playwright's webServer readiness check).
  const slug = rawSlug && pageSlugSchema.safeParse(rawSlug).success
    ? rawSlug
    : null;
  if (!slug) return { title: "Site" };

  const [site, pageData] = await Promise.all([
    cachedReadSiteConfig(),
    cachedReadPageOrNull(slug),
  ]);

  const pageTitle = pageData ? extractPageRootProps(pageData).title : null;
  return {
    title: pageTitle ? `${pageTitle} — ${site.artistName}` : site.siteTitle,
    description: site.siteDescription,
  };
}
