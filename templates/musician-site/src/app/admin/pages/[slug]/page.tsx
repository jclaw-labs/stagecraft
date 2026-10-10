import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import { getRequestReadStore } from "@/lib/collections";
import { readAppearance, readPageOrNull } from "@/lib/content";
import { pageSlugSchema } from "@/lib/site-config-types";

import { Editor } from "./Editor";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function AdminEditPage({ params }: Props) {
  const { slug: raw } = await params;
  const parsed = pageSlugSchema.safeParse(raw);
  if (!parsed.success) notFound();
  const slug = parsed.data;

  const store = await getRequestReadStore();
  const [data, session, collectionSlugs, appearance] = await Promise.all([
    readPageOrNull(slug, store),
    getSession(),
    store.listCollectionSlugs(),
    readAppearance(store),
  ]);
  if (!data) notFound();

  // Collections embeddable as page blocks: every collection except the page
  // collection itself and the singletons (site / header / appearance). Each
  // becomes a generic Collection block in the editor's "Collections" drawer
  // group (ADR-015 step 5). Sorted by display name for a stable drawer order.
  const defs = await Promise.all(collectionSlugs.map((s) => store.readCollectionDef(s)));
  const embeddableCollections = defs
    .flatMap((d) =>
      d && !d.isSingleton && d.slug !== "pages" ? [{ slug: d.slug, label: d.pluralName }] : [],
    )
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Editor
      initialData={data}
      pageSlug={slug}
      email={session?.email ?? ""}
      embeddableCollections={embeddableCollections}
      appearance={appearance}
    />
  );
}
