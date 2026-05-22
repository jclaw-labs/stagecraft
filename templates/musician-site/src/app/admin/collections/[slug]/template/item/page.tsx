/**
 * Item template editor route (ADR-009 PR 6).
 *   /admin/collections/<slug>/template/item
 */

import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import {
  getRequestReadStore,
  slugSchema,
} from "@/lib/collections";

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

  const storePromise = getRequestReadStore();
  const [session, def] = await Promise.all([
    getSession(),
    storePromise.then((s) => s.readCollectionDef(parsed.data)),
  ]);
  if (!def) notFound();

  // Singletons render through their single item's puckContent body —
  // there's no Collection block to iterate them, so an itemTemplate
  // is dead code. The route 404s to keep the editor surface honest.
  if (def.isSingleton) notFound();

  const store = await storePromise;
  // Pre-fetch this collection's items so the editor can offer a
  // "Preview item" dropdown and resolve the template against a real
  // item without a client-side round-trip. Empty collection → the
  // client surfaces an "add an item to enable preview" message.
  const previewItems = await store.listItemsInOrder(parsed.data, def);

  return (
    <TemplateEditorClient
      collectionSlug={parsed.data}
      def={def}
      kind="item"
      email={session?.email ?? ""}
      previewItems={previewItems}
    />
  );
}
