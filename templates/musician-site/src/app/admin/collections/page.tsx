/**
 * Admin index of every collection on disk (ADR-009 PR 4).
 *
 * Lists the prebaked four plus any custom collections an artist's
 * schema editor (PR 5) has added. Each row links to the per-collection
 * list view.
 */

import Link from "next/link";

import { AdminShell } from "@/components/admin/AdminShell";
import { getSession } from "@/lib/auth";
import { listCollectionSlugs, readCollectionDef } from "@/lib/collections";

export default async function CollectionsIndex() {
  const [session, slugs] = await Promise.all([getSession(), listCollectionSlugs()]);
  const defs = await Promise.all(
    slugs.map(async (slug) => ({ slug, def: await readCollectionDef(slug) })),
  );

  return (
    <AdminShell activeSection="collections" email={session?.email ?? ""}>
      <main style={{ maxWidth: "var(--max-width-content)", margin: "var(--space-8) auto", padding: "0 var(--space-4)" }}>
        <h1
          style={{
            fontSize: "var(--font-size-2xl)",
            fontWeight: "var(--font-weight-bold)" as unknown as number,
            margin: 0,
            marginBottom: "var(--space-4)",
          }}
        >
          Collections
        </h1>
        <p style={{ color: "var(--color-text-muted)", marginBottom: "var(--space-6)" }}>
          Every editable surface on this site, including the four prebaked
          collections (Pages, Site, Header, Appearance) and any custom
          collections you add via the schema editor.
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {defs.map(({ slug, def }) => (
            <li
              key={slug}
              style={{
                padding: "var(--space-4)",
                marginBottom: "var(--space-2)",
                background: "var(--color-surface-raised)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
              }}
            >
              <Link
                href={`/admin/collections/${slug}`}
                style={{
                  textDecoration: "none",
                  color: "var(--color-text)",
                  display: "block",
                }}
              >
                <div
                  style={{
                    fontWeight: "var(--font-weight-semibold)" as unknown as number,
                    marginBottom: "var(--space-1)",
                  }}
                >
                  {def?.pluralName ?? slug}
                </div>
                <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
                  {def?.isSingleton ? "Singleton" : "Collection"} · {def?.fields.length ?? 0} fields
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </AdminShell>
  );
}
