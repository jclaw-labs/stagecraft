/**
 * Admin "new item" form (ADR-009 PR 4).
 *
 *   /admin/collections/<slug>/items/new
 *
 * Renders the ItemEditor against a default-values draft of the
 * collection's schema. On save the client posts to
 * `/api/collections/<slug>/items` (POST), then navigates to the new
 * item's edit page.
 */

import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { defaultItemValues } from "@/components/admin/ItemEditor";
import { getSession } from "@/lib/auth";
import {
  generateItemId,
  listItemsInOrder,
  readCollectionDef,
  slugSchema,
  type Item,
} from "@/lib/collections";

import { NewItemClient } from "./NewItemClient";

type Params = { slug: string };

export default async function NewItem({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();

  const [session, def] = await Promise.all([getSession(), readCollectionDef(parsed.data)]);
  if (!def) notFound();

  // Singletons don't have a "new" flow — their one item is the edit
  // surface itself. Redirect-by-not-found is a bit blunt but matches
  // how the per-collection view handles singletons.
  if (def.isSingleton) notFound();

  // Pre-fetch reference options for the draft form too.
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

  const now = new Date().toISOString();
  const draft: Item = {
    id: generateItemId(),
    slug: "",
    createdAt: now,
    updatedAt: now,
    values: defaultItemValues(def),
  };

  return (
    <AdminShell activeSection="collections" email={session?.email ?? ""}>
      <NewItemClient
        def={def}
        draft={draft}
        referenceOptions={referenceOptions}
        collectionSlug={parsed.data}
      />
    </AdminShell>
  );
}

function labelFor(item: Item, slugSourceFieldId: string | null): string {
  if (!slugSourceFieldId) return item.slug;
  const v = item.values[slugSourceFieldId];
  return v && "value" in v && typeof v.value === "string" ? v.value : item.slug;
}
