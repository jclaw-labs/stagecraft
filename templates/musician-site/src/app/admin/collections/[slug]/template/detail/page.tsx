/**
 * Detail template editor route (ADR-009 §9).
 *   /admin/collections/<slug>/template/detail
 *
 * The detail-template editor includes Collection blocks — one per
 * existing collection — so an artist authoring a tour-dates detail
 * template can embed `PagesView`, `TourDatesView`, etc. blocks. This
 * route fetches every non-singleton collection's def + items and
 * hands them to `TemplateEditorClient`. The Puck `ComponentConfig`s
 * are built client-side from the defs because their render closures
 * aren't serialisable across the RSC boundary (passing them through
 * server-side props was a long-standing bug that broke the route
 * outright — see the matching change in `TemplateEditorClient.tsx`).
 *
 * Pre-loading every non-singleton collection's items lets the
 * preview pane render Collection-block iteration without a
 * round-trip, even for blocks the artist drops onto the canvas
 * mid-edit. The public renderer at `(public)/[[...slug]]/page.tsx`
 * uses `loadCollectionsForTemplate(template)` to walk only the
 * blocks the template actually references — but that template is
 * static at request time. The editor is interactive: the artist
 * adds blocks while the page is mounted, and we want their preview
 * populated the moment a `TourDatesView` lands on the canvas.
 * Bounded by total items across the site, small for an artist
 * site — revisit when sites grow past a few hundred items per
 * non-singleton collection.
 *
 * Cycle safety (ADR §4.3): item templates don't get this surface —
 * the item-template editor's config omits Collection blocks
 * entirely.
 */

import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import {
  listCollectionSlugs,
  listItemsInOrder,
  readCollectionDef,
  slugSchema,
  type CollectionDef,
} from "@/lib/collections";
import type { LoadedCollections } from "@/lib/collections/template/renderer";

import { TemplateEditorClient } from "../TemplateEditorClient";

type Params = { slug: string };

export default async function DetailTemplateEditorPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();

  const [session, def] = await Promise.all([getSession(), readCollectionDef(parsed.data)]);
  if (!def) notFound();

  // Singletons don't have detail pages — there's only one item, no
  // `<detailUrlPrefix>/<slug>` URL to render. Route 404s.
  if (def.isSingleton) notFound();

  const allSlugs = await listCollectionSlugs();
  const allDefs = await Promise.all(allSlugs.map((s) => readCollectionDef(s)));
  const iterableDefs = allDefs.filter(
    (d): d is NonNullable<CollectionDef> => d !== null && !d.isSingleton,
  );

  // Detail collections are non-singleton, so the current `def` already
  // sits in `iterableDefs`. Load every iterable in one batch and reuse
  // the current-collection slot as `previewItems` instead of issuing a
  // duplicate `listItemsInOrder` for the same slug.
  const iterableItemLists = await Promise.all(
    iterableDefs.map((d) => listItemsInOrder(d.slug, d)),
  );

  const loadedCollections: LoadedCollections = Object.fromEntries(
    iterableDefs.map((d, i) => [d.slug, { def: d, items: iterableItemLists[i] ?? [] }]),
  );

  const currentIndex = iterableDefs.findIndex((d) => d.slug === parsed.data);
  const previewItems = currentIndex >= 0 ? iterableItemLists[currentIndex] ?? [] : [];

  return (
    <TemplateEditorClient
      collectionSlug={parsed.data}
      def={def}
      kind="detail"
      email={session?.email ?? ""}
      iterableCollectionDefs={iterableDefs}
      previewItems={previewItems}
      loadedCollections={loadedCollections}
    />
  );
}
