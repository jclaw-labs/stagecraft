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

import { notFound, redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { findCustomSurface } from "@/components/admin/admin-surfaces";
import { defaultItemValues } from "@/components/admin/ItemEditor";
import { getSession } from "@/lib/auth";
import {
  generateItemId,
  getRequestReadStore,
  slugSchema,
  type Item,
} from "@/lib/collections";

import { NewItemClient } from "./NewItemClient";

type Params = { slug: string };

export default async function NewItem({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();

  // Custom-panel collections (e.g. Pages) own their own create flow
  // on the custom list route — bounce there instead of rendering the
  // generic new-item form.
  const customSurface = findCustomSurface(parsed.data);
  if (customSurface) {
    redirect(customSurface.route);
  }

  const storePromise = getRequestReadStore();
  const [session, def] = await Promise.all([
    getSession(),
    storePromise.then((s) => s.readCollectionDef(parsed.data)),
  ]);
  if (!def) notFound();

  // Singletons don't have a "new" flow — their one item is the edit
  // surface itself. Redirect-by-not-found is a bit blunt but matches
  // how the per-collection view handles singletons.
  if (def.isSingleton) notFound();

  const store = await storePromise;

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
      const refDef = await store.readCollectionDef(refSlug);
      if (!refDef) return;
      const items = await store.listItemsInOrder(refSlug, refDef);
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
    <AdminShell activeSection={`collection:${parsed.data}`} email={session?.email ?? ""}>
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
