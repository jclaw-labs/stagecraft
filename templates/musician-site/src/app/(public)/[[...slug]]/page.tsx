import { Render } from "@measured/puck";
// Never import Puck's editor stylesheet here (issue #348; see src/app/editor-css-boundary.test.ts).
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { PageBackgroundUnderlay } from "@/components/PageBackgroundUnderlay";
import {
  assertCollectionRouting,
  getFsReadStore,
  listCollectionSlugs,
  listPublicRouteSegments,
  readCollectionDef,
  readItem,
  resolveCollectionItemUrl,
  slugSchema,
  type CollectionDef,
  type Item,
} from "@/lib/collections";
import { buildCollectionBlockRegistry } from "@/lib/collections/template/collection-block";
import { DefaultItemDetail } from "@/lib/collections/template/item-detail";
import { pageDataToItem } from "@/lib/collections/migrate-from-legacy";
import { pagesCollectionDef } from "@/lib/collections/seeds";
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
import { buildUnifiedPublicConfig } from "@/puck/unified-config";

// ---------------------------------------------------------------------------
// Per-request caches
//
// The catch-all + generateMetadata both walk the collection registry
// (slugs + defs) and read the site / header singletons. React.cache()
// dedupes those reads within a single request lifecycle — both
// `generateMetadata` (which runs first) and the page render share the
// same cached call results. The route is prerendered, so in production
// these reads run at build time. Module-level memoisation would still be
// wrong: `next dev` re-reads content per request and tests reset it
// between cases. React.cache() is scoped to one render.
// ---------------------------------------------------------------------------

// Public-renderer reads always hit the FS snapshot of `main` — visitors
// see the deployed state, not the artist's draft. The shims below
// resolve a per-request FS store internally so call sites stay clean.
const cachedListCollectionSlugs = cache(listCollectionSlugs);
const cachedReadCollectionDef = cache(readCollectionDef);
const cachedReadSiteConfig = cache(() => readSiteConfig(getFsReadStore()));
const cachedReadHeaderConfig = cache(() => readHeaderConfig(getFsReadStore()));
const cachedListPageSummaries = cache(() => listPageSummaries(getFsReadStore()));
const cachedReadPageOrNull = cache((slug: string) => readPageOrNull(slug, getFsReadStore()));
// resolveRootPageSlug calls listPageSummaries internally; wrap it at
// this layer so root-URL requests don't trigger that read twice (once
// per generateMetadata + render path).
const cachedResolveRootPageSlug = cache(() => resolveRootPageSlug(getFsReadStore()));

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

// ---------------------------------------------------------------------------
// Static generation
//
// Content only changes through a commit + redeploy (ADR-007), so every
// public URL is prerendered at build time. Anything not listed by
// `generateStaticParams` 404s rather than rendering on demand, through
// the themed `app/global-not-found.tsx`.
// `/admin` and `/api` live outside this route and build as before.
// ---------------------------------------------------------------------------

export const dynamicParams = false;

/**
 * Every page plus every collection item with a detail URL (ADR-009 §8).
 * Runs the routing-conflict check first, so a conflict fails
 * `next build` with the structured message instead of reaching the
 * live site.
 */
export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  const store = getFsReadStore();
  // `listPageSlugs` writes any missing prebaked collection defs, so it
  // has to finish before the defs are read; otherwise a repo without a
  // committed `pages/_collection.json` drops every page from the set.
  const pageSlugs = await listPageSlugs(store);
  const [allDefs, rootPageSlug] = await Promise.all([
    cachedAllDefs(),
    cachedResolveRootPageSlug(),
  ]);
  assertCollectionRouting(allDefs, pageSlugs);

  const routable = allDefs.filter((d) => !d.isSingleton && d.detailUrlPrefix !== null);
  const itemSlugs = await Promise.all(routable.map((d) => store.listItemSlugs(d.slug)));
  const itemSlugsByCollection = new Map(routable.map((d, i) => [d.slug, itemSlugs[i]]));

  return listPublicRouteSegments(allDefs, itemSlugsByCollection, rootPageSlug !== null).map(
    (slug) => ({ slug }),
  );
}

/**
 * Catch-all renderer for every public URL.
 *
 * Dispatch (ADR-009 §8). Routing conflicts are already ruled out by
 * `generateStaticParams`, which fails the build on one.
 *
 *   1. `resolveCollectionItemUrl` matches the URL against every
 *      collection's `detailUrlPrefix` (longest-prefix-first). A
 *      non-Pages match renders the collection's `detailTemplate`.
 *   2. Pages fall through to the legacy `readPageOrNull` flow,
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

  // Render the page body through the template walker (ADR-015 convergence):
  // chrome blocks (Section, Columns, …) pass through with their literal props,
  // and Collection blocks (TourDatesView / ReleasesView / PostsView, now the
  // generic block) resolve their items from the live collections via the same
  // machinery the collection detail pages use. The page is its own
  // `currentItem` (ADR-009 §2); root props / metadata / chrome stay outside
  // the walker (handled below). `loadCollectionsForTemplate` short-circuits
  // when the page embeds no Collection block, so the common case is cheap.
  const allDefs = await cachedAllDefs();
  const slugs = allDefs.map((d) => d.slug);
  // Walker registry is Collection blocks ONLY — no primitives. The page body's
  // chrome blocks (Section, Button, Image, …) are unknown to this registry, so
  // the walker passes them through (recursing their slots, renderer.tsx) and
  // they render via their chrome fns in the unified config. Including
  // primitives would mis-dispatch same-named chrome blocks to Bindable
  // resolvers. (A collection's own itemTemplate still uses PRIMITIVE_BLOCKS
  // internally, inside CollectionBlockItem.)
  const registry = buildCollectionBlockRegistry(slugs);
  const pageItem = pageDataToItem(requestedSlug, pageData as Template, {
    id: `page_${requestedSlug}`,
  });
  const loaded = await loadCollectionsForTemplate(pageData as Template);
  const resolvedPageData = resolveTemplate(pageData as Template, pageItem, {
    registry,
    currentItem: pageItem,
    itemDef: pagesCollectionDef,
    loadedCollections: loaded,
  });

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
      {/* Per-page pageBackground override — paints on top of the
          layout's site-wide underlay so this page sees its chosen
          image instead. Site-wide still loads (the layout is
          independent of the page); the per-page layer simply wins
          visually. Both are fixed-positioned at zIndex: -1, and the
          per-page renders later in the DOM so it composites on top.
          Overlay opacity: null on the page inherits the site-wide
          value; an explicit number 0..1 overrides. */}
      {rootProps.pageBackground ? (
        <PageBackgroundUnderlay
          image={rootProps.pageBackground}
          overlayOpacity={
            rootProps.pageBackgroundOverlay ?? site.pageBackgroundOverlay
          }
        />
      ) : null}
      <Render config={buildUnifiedPublicConfig(slugs)} data={resolvedPageData} />
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
 * definition. When `detailTemplate` is null, falls back to the
 * default detail layout (`DefaultItemDetail`): cover, formatted meta,
 * title, text fields and the rendered body.
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
  if (!template) return <DefaultItemDetail def={def} item={item} />;

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
    itemDef: def,
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
