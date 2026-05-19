/**
 * Detail template editor route (ADR-009 §9).
 *   /admin/collections/<slug>/template/detail
 *
 * The detail-template editor includes Collection blocks — one per
 * existing collection — so an artist authoring a tour-dates detail
 * template can embed `PagesView`, `TourDatesView`, etc. blocks. This
 * route pre-builds the per-collection block configs server-side and
 * hands them to `TemplateEditorClient` as `extraBlocks`.
 *
 * Cycle safety (ADR §4.3): item templates don't get this surface —
 * the item-template editor's config omits Collection blocks
 * entirely.
 */

import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import {
  listCollectionSlugs,
  readCollectionDef,
  slugSchema,
} from "@/lib/collections";
import { blockNameForCollection } from "@/lib/collections/template/collection-block";
import { buildCollectionBlockComponentConfig } from "@/components/admin/buildCollectionBlockComponentConfig";
import type { ExtraBlocks } from "@/components/admin/buildEditorPuckConfig";

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

  // Build one Collection-block component config per known collection
  // (skipping singletons — they have no items to iterate). The
  // dispatcher name (`TourDatesView`, `PagesView`, …) is the key the
  // editor and renderer route to. Self-embedding is allowed by the
  // ADR: a tour-dates detail page can embed `TourDatesView` to show
  // related shows; the rendering layer's recursion is bounded by
  // itemTemplates (which can't contain Collection blocks).
  const allSlugs = await listCollectionSlugs();
  const allDefs = await Promise.all(allSlugs.map((s) => readCollectionDef(s)));
  const extraBlocks: ExtraBlocks = Object.fromEntries(
    allDefs
      .filter((d): d is NonNullable<typeof d> => d !== null && !d.isSingleton)
      .map((d) => [blockNameForCollection(d.slug), buildCollectionBlockComponentConfig(d)]),
  );

  return (
    <TemplateEditorClient
      collectionSlug={parsed.data}
      def={def}
      kind="detail"
      email={session?.email ?? ""}
      extraBlocks={extraBlocks}
    />
  );
}
