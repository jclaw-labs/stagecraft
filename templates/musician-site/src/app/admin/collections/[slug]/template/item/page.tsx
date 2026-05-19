/**
 * Item template editor route (ADR-009 PR 6).
 *   /admin/collections/<slug>/template/item
 */

import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import { readCollectionDef, slugSchema } from "@/lib/collections";

import { TemplateEditorClient } from "../TemplateEditorClient";

type Params = { slug: string };

export default async function ItemTemplateEditorPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();

  const [session, def] = await Promise.all([getSession(), readCollectionDef(parsed.data)]);
  if (!def) notFound();

  // Singletons render through their single item's puckContent body —
  // there's no Collection block to iterate them, so an itemTemplate
  // is dead code. The route 404s to keep the editor surface honest.
  if (def.isSingleton) notFound();

  return (
    <TemplateEditorClient
      collectionSlug={parsed.data}
      def={def}
      kind="item"
      email={session?.email ?? ""}
    />
  );
}
