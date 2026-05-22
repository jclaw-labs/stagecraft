import { notFound } from "next/navigation";

import { getSession } from "@/lib/auth";
import { getRequestReadStore } from "@/lib/collections";
import { readPageOrNull } from "@/lib/content";
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

  const [data, session] = await Promise.all([
    getRequestReadStore().then((s) => readPageOrNull(slug, s)),
    getSession(),
  ]);
  if (!data) notFound();

  return <Editor initialData={data} pageSlug={slug} email={session?.email ?? ""} />;
}
