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
 *
 * Custom-panel collections (Site Settings, Header & Navigation,
 * Appearance, Pages) bounce to their registered route — same
 * pattern as `/admin/pages` is canonical for the pages collection.
 * Registry in `@/components/admin/admin-surfaces`.
 */

import { notFound, redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { findCustomSurface } from "@/components/admin/admin-surfaces";
import { getSession } from "@/lib/auth";
import {
  itemSlugSchema,
  listItemsInOrder,
  readCollectionDef,
  readItem,
  SINGLETON_ITEM_SLUG,
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

  // Custom-panel collections bounce to their curated UX. Singletons
  // use the registered `route`; multi-item custom panels (Pages) use
  // `itemRoute(itemSlug)`. Either way the generic editor is hidden
  // behind the canonical surface, matching how /admin/pages is the
  // canonical UX for the pages collection.
  //
  // NOTE: schema / template editor routes
  // (/admin/collections/<slug>/{schema,template/*}) are NOT redirected
  // for custom-panel collections — until `systemLocked` enforcement
  // ships (follow-up PR) an artist can navigate there directly and
  // remove fields the custom panel reads by field-id. Tracked.
  const customSurface = findCustomSurface(parsedSlug.data);
  if (customSurface) {
    if (parsedItemSlug.data === SINGLETON_ITEM_SLUG) {
      redirect(customSurface.route);
    }
    if (customSurface.itemRoute) {
      redirect(customSurface.itemRoute(parsedItemSlug.data));
    }
  }

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
    <AdminShell activeSection={`collection:${parsedSlug.data}`} email={session?.email ?? ""}>
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
