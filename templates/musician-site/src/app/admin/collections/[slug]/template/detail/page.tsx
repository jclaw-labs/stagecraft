/**
 * Detail template editor route (ADR-009 PR 6).
 *   /admin/collections/<slug>/template/detail
 *
 * Today this is the same editor surface as the item template — same
 * block set (Primitives), same binding-aware inspector. PR 7 adds
 * Collection blocks (`PagesView`, `TourDatesView`, …) to the
 * detail-template config so the detail page can embed other
 * collections.
 */

import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import { readCollectionDef, slugSchema } from "@/lib/collections";

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

  return (
    <TemplateEditorClient
      collectionSlug={parsed.data}
      def={def}
      kind="detail"
      email={session?.email ?? ""}
    />
  );
}
