/**
 * Admin schema editor route (ADR-009 PR 5).
 *
 *   /admin/collections/<slug>/schema
 *
 * Server component fetches the current `CollectionDef`; the client
 * component owns the form state and the save call.
 */

import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { getSession } from "@/lib/auth";
import { readCollectionDef, slugSchema } from "@/lib/collections";

import { SchemaEditorClient } from "./SchemaEditorClient";

type Params = { slug: string };

export default async function SchemaEditorPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();

  const [session, def] = await Promise.all([getSession(), readCollectionDef(parsed.data)]);
  if (!def) notFound();

  return (
    <AdminShell activeSection="collections" email={session?.email ?? ""}>
      <main
        style={{
          maxWidth: "var(--max-width-content)",
          margin: "var(--space-8) auto",
          padding: "0 var(--space-4)",
        }}
      >
        <header style={{ marginBottom: "var(--space-6)" }}>
          <h1
            style={{
              fontSize: "var(--font-size-2xl)",
              fontWeight: "var(--font-weight-bold)" as unknown as number,
              margin: 0,
              marginBottom: "var(--space-1)",
            }}
          >
            {def.pluralName} schema
          </h1>
          <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
            Add, rename, and reshape fields. Destructive changes are guarded — system-locked fields, lossy type changes, and turning optional fields required when items don&apos;t have a value are all blocked at save.
          </p>
        </header>
        <SchemaEditorClient collectionSlug={parsed.data} initialDef={def} />
      </main>
    </AdminShell>
  );
}
