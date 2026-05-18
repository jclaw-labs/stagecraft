/**
 * Embedded puckContent editor (ADR-009 PR 6).
 *
 *   /admin/collections/<slug>/items/<itemSlug>/body/<fieldId>
 *
 * Edits one `puckContent` field on one item via Puck. The block
 * registry is the public-renderer one (no bindings — bindings only
 * exist in templates, this is the artist authoring one item's body
 * directly).
 */

import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import {
  findField,
  itemSlugSchema,
  readCollectionDef,
  readItem,
  slugSchema,
} from "@/lib/collections";

import { BodyEditorClient } from "./BodyEditorClient";

type Params = { slug: string; itemSlug: string; fieldId: string };

export default async function BodyEdit({ params }: { params: Promise<Params> }) {
  const { slug, itemSlug, fieldId } = await params;
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedItemSlug = itemSlugSchema.safeParse(itemSlug);
  if (!parsedSlug.success || !parsedItemSlug.success) notFound();

  const [session, def] = await Promise.all([getSession(), readCollectionDef(parsedSlug.data)]);
  if (!def) notFound();

  const field = findField(def, fieldId);
  if (!field || field.type !== "puckContent") notFound();

  const item = await readItem(parsedSlug.data, parsedItemSlug.data, def);
  if (!item) notFound();

  return (
    <BodyEditorClient
      collectionSlug={parsedSlug.data}
      itemSlug={parsedItemSlug.data}
      fieldId={fieldId}
      pluralName={def.pluralName}
      fieldKey={field.key}
      initialItem={item}
      email={session?.email ?? ""}
    />
  );
}
