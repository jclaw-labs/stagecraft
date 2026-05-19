import { Render } from "@measured/puck";
import "@measured/puck/puck.css";
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
} from "@/lib/collections";
import {
  buildCollectionBlockRegistry,
  DefaultItemFieldsList,
} from "@/lib/collections/template/collection-block";
import { loadCollectionsForTemplate } from "@/lib/collections/template/load-collections";
import { PRIMITIVE_BLOCKS } from "@/lib/collections/template/primitives";
import { buildTemplatePuckConfig } from "@/lib/collections/template/puck-config";
import { resolveTemplate } from "@/lib/collections/template/renderer";
import {
  extractPageRootProps,
  listPageSummaries,
  readHeaderConfig,
  readPageOrNull,
  readSiteConfig,
  resolveRootPageSlug,
} from "@/lib/content";
import { pageSlugSchema } from "@/lib/site-config-types";
import { puckConfig } from "@/puck/config";

type Props = {
  params: Promise<{ slug?: string[] }>;
};

/**
 * Catch-all renderer for every public URL.
 *
 *   /             → splash page (if marked) → /home → first page
 *   /<slug>       → src/content/pages/<slug>.json
 *
 * Unknown slugs render the framework 404 page. Splash pages take over `/`
 * and skip the Header + Footer (the splash is supposed to fill the viewport).
 *
 * Site-wide config (artist name + nav) feeds the Header; per-page root
 * props (isFooterHidden, isSplashPage) control the chrome around the body.
 */
export default async function CatchAllPage({ params }: Props) {
  const { slug: segments } = await params;

  // Step 1: try to dispatch to a non-Pages collection's detail page.
  // Multi-segment URLs like `/shows/paris-2026` go to tour-dates; the
  // existing Pages flow handles the rest. `validateCollectionRouting`
  // runs first to catch a Page slug shadowing a collection prefix or
  // two collections claiming the same prefix — both can corrupt the
  // public site silently if allowed.
  const allSlugs = await listCollectionSlugs();
  const allDefs = (
    await Promise.all(allSlugs.map((s) => readCollectionDef(s)))
  ).filter((d): d is CollectionDef => d !== null);

  // TRANSITIONAL: page slugs come from the legacy store
  // (`src/content/pages/`), not the collection store. When Pages
  // migrate to `src/content/collections/pages/items/` (per ADR-009
  // §13 / shipping-plan PR 3), this should pull slugs from the
  // pages collection instead — and the `itemUrl.collectionSlug !==
  // "pages"` gate below needs to invert in the same commit.
  const summaries = await listPageSummaries();
  const conflicts = validateCollectionRouting(
    allDefs,
    summaries.map((s) => s.slug),
  );
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
    // Detail page for a non-Pages collection.
    return await renderCollectionItemDetail({
      collectionSlug: itemUrl.collectionSlug,
      itemSlug: itemUrl.itemSlug,
      allDefs,
    });
  }

  // Step 2: Pages flow. Either the root URL, or a 1-segment URL that
  // resolves to a Page slug.
  let requestedSlug: string;
  if (segs.length === 0) {
    const root = await resolveRootPageSlug();
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

  const [pageData, site, header] = await Promise.all([
    readPageOrNull(requestedSlug),
    readSiteConfig(),
    readHeaderConfig(),
  ]);

  if (!pageData) notFound();

  const rootProps = extractPageRootProps(pageData);
  const pageTitleBySlug = new Map(summaries.map((s) => [s.slug, s.title]));

  // Visible nav = pages list filtered down by visibility + splash. The
  // Pages list order (canonical `site.pageOrder` first, then alphabetical
  // for new pages) IS the nav order; the eye-icon toggle on each row
  // drives `isHiddenFromNav`.
  const navItems = summaries
    .filter((s) => !s.isSplashPage && !s.isHiddenFromNav)
    .map((s) => s.slug);

  // Footer visibility: hidden if either the site-level toggle OR the
  // per-page toggle says hidden. Splash pages always hide both chrome
  // pieces because they're standalone full-bleed landings.
  const hideFooter = rootProps.isSplashPage || site.isFooterHidden || rootProps.isFooterHidden;
  const hideHeader = rootProps.isSplashPage;

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
      <main>
        <Render config={puckConfig} data={pageData} />
      </main>
      {hideFooter ? null : <Footer site={site} />}
    </>
  );
}

/**
 * Render one item's detail page. Resolves the item, walks the
 * collection's detailTemplate against it (pre-loading any
 * Collection blocks the template references), and emits the
 * resolved Puck tree wrapped in the standard site chrome.
 *
 * If the collection's `detailTemplate` is null, falls back to a
 * minimal "every scalar field as plain text" rendering — keeps
 * the URL usable before the artist authors a template.
 */
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
    readSiteConfig(),
    readHeaderConfig(),
    listPageSummaries(),
  ]);
  const pageTitleBySlug = new Map(summaries.map((s) => [s.slug, s.title]));
  const navItems = summaries
    .filter((s) => !s.isSplashPage && !s.isHiddenFromNav)
    .map((s) => s.slug);

  return (
    <>
      <Header
        artistName={site.artistName}
        header={header}
        navItems={navItems}
        pageTitleBySlug={pageTitleBySlug}
      />
      <main>
        <CollectionItemBody def={def} item={item} allDefs={allDefs} />
      </main>
      {site.isFooterHidden ? null : <Footer site={site} />}
    </>
  );
}

/**
 * Inner render component for a collection item's detail body.
 * Async because it pre-loads the template's Collection-block
 * sources before walking.
 *
 * Takes `allDefs` from the catch-all rather than re-reading every
 * `_collection.json` here — the catch-all already loaded them for
 * routing-conflict detection. Passing them through saves one round
 * of disk reads per detail request.
 */
async function CollectionItemBody({
  def,
  item,
  allDefs,
}: {
  def: CollectionDef;
  item: import("@/lib/collections").Item;
  allDefs: CollectionDef[];
}) {
  const template = def.detailTemplate as import(
    "@/lib/collections/template/types"
  ).Template | null;
  if (!template) {
    // No detail template configured — fall back to a minimal
    // "every scalar field as plain text" rendering. Lets the URL
    // be useful before the artist authors a real template.
    return (
      <article style={{ maxWidth: "var(--max-width-content)", margin: "var(--space-8) auto", padding: "0 var(--space-4)" }}>
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

  // Build the Puck config from the extended registry so <Render>
  // can dispatch Collection blocks alongside primitives.
  return <Render config={buildTemplatePuckConfig(registry)} data={resolved} />;
}

/**
 * Per-page metadata (document title + meta description). Reads from site
 * config + the page's own root.title so each route surfaces a meaningful
 * tab name.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: segments } = await params;
  const slug = !segments || segments.length === 0
    ? await resolveRootPageSlug()
    : segments[0];

  if (!slug) return { title: "Site" };

  const [site, pageData] = await Promise.all([
    readSiteConfig(),
    readPageOrNull(slug),
  ]);

  const pageTitle = pageData ? extractPageRootProps(pageData).title : null;
  return {
    title: pageTitle ? `${pageTitle} — ${site.artistName}` : site.siteTitle,
    description: site.siteDescription,
  };
}
