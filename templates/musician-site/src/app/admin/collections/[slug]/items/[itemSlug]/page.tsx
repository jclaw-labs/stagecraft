/**
 * Admin item-edit form (ADR-009 PR 4). Server-renders the wrapper
 * shell + initial data; the client `<ItemEditorClient>` owns the
 * form state and save call.
 *
 *   /admin/collections/<slug>/items/<itemSlug>
 *
 * For singletons this is the canonical surface (the per-collection
 * list view redirects here). For multi-item collections the route
 * shows one item; the list view at /admin/collections/<slug> is the
 * jumping-off point.
 */

import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { getSession } from "@/lib/auth";
import {
  itemSlugSchema,
  listItemsInOrder,
  readCollectionDef,
  readItem,
  slugSchema,
  type Item,
} from "@/lib/collections";

import { ItemEditorClient } from "./ItemEditorClient";

type Params = { slug: string; itemSlug: string };

export default async function ItemEdit({ params }: { params: Promise<Params> }) {
  const { slug, itemSlug } = await params;
  const parsedSlug = slugSchema.safeParse(slug);
  const parsedItemSlug = itemSlugSchema.safeParse(itemSlug);
  if (!parsedSlug.success || !parsedItemSlug.success) notFound();

  const [session, def] = await Promise.all([getSession(), readCollectionDef(parsedSlug.data)]);
  if (!def) notFound();

  const item = await readItem(parsedSlug.data, parsedItemSlug.data, def);
  if (!item) notFound();

  // Pre-fetch every collection referenced by any collectionRef /
  // multiCollectionRef field on this def. The editor uses these to
  // populate its reference pickers without async lookups mid-edit.
  const referencedSlugs = new Set<string>();
  for (const field of def.fields) {
    if (field.type === "collectionRef" || field.type === "multiCollectionRef") {
      referencedSlugs.add(field.targetCollection);
    }
  }
  const referenceOptions: Record<string, Array<{ id: string; label: string }>> = {};
  await Promise.all(
    Array.from(referencedSlugs).map(async (refSlug) => {
      const refDef = await readCollectionDef(refSlug);
      if (!refDef) return;
      const items = await listItemsInOrder(refSlug, refDef);
      referenceOptions[refSlug] = items.map((i) => ({
        id: i.id,
        label: labelFor(i, refDef.slugSourceFieldId),
      }));
    }),
  );

  return (
    <AdminShell activeSection="collections" email={session?.email ?? ""}>
      <ItemEditorClient
        def={def}
        item={item}
        referenceOptions={referenceOptions}
        collectionSlug={parsedSlug.data}
        itemSlug={parsedItemSlug.data}
      />
    </AdminShell>
  );
}

function labelFor(item: Item, slugSourceFieldId: string | null): string {
  if (!slugSourceFieldId) return item.slug;
  const v = item.values[slugSourceFieldId];
  return v && "value" in v && typeof v.value === "string" ? v.value : item.slug;
}
