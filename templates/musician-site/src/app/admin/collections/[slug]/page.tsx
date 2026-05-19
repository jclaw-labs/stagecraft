/**
 * Admin per-collection view (ADR-009 PR 4).
 *
 *   /admin/collections/<slug>
 *
 * For non-singletons: lists every item with edit links.
 * For singletons: redirects straight to the single item's edit form.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

const chromeButtonStyle: React.CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  background: "var(--color-surface-raised)",
  color: "var(--color-text)",
  borderRadius: "var(--radius-sm)",
  textDecoration: "none",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  fontSize: "var(--font-size-sm)",
  border: "1px solid var(--color-border)",
};

import { AdminShell } from "@/components/admin/AdminShell";
import { getSession } from "@/lib/auth";
import {
  listItemsInOrder,
  readCollectionDef,
  SINGLETON_ITEM_SLUG,
  slugSchema,
} from "@/lib/collections";

type Params = { slug: string };

export default async function CollectionView({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) notFound();

  const [session, def] = await Promise.all([getSession(), readCollectionDef(parsed.data)]);
  if (!def) notFound();

  if (def.isSingleton) {
    redirect(`/admin/collections/${parsed.data}/items/${SINGLETON_ITEM_SLUG}`);
  }

  const items = await listItemsInOrder(parsed.data, def);

  return (
    <AdminShell activeSection="collections" email={session?.email ?? ""}>
      <main
        style={{
          maxWidth: "var(--max-width-content)",
          margin: "var(--space-8) auto",
          padding: "0 var(--space-4)",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "var(--space-6)",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "var(--font-size-2xl)",
                fontWeight: "var(--font-weight-bold)" as unknown as number,
                margin: 0,
                marginBottom: "var(--space-1)",
              }}
            >
              {def.pluralName}
            </h1>
            <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
              {def.fields.length} field{def.fields.length === 1 ? "" : "s"} ·{" "}
              {items.length} item{items.length === 1 ? "" : "s"}
            </p>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <Link href={`/admin/collections/${parsed.data}/schema`} style={chromeButtonStyle}>
              Edit schema
            </Link>
            <Link
              href={`/admin/collections/${parsed.data}/template/item`}
              style={chromeButtonStyle}
            >
              Item template
            </Link>
            <Link
              href={`/admin/collections/${parsed.data}/template/detail`}
              style={chromeButtonStyle}
            >
              Detail template
            </Link>
            <Link
              href={`/admin/collections/${parsed.data}/items/new`}
              style={{
                padding: "var(--space-2) var(--space-4)",
                background: "var(--color-action)",
                color: "var(--color-action-fg)",
                borderRadius: "var(--radius-sm)",
                textDecoration: "none",
                fontWeight: "var(--font-weight-semibold)" as unknown as number,
                fontSize: "var(--font-size-sm)",
              }}
            >
              + New {def.singularName}
            </Link>
          </div>
        </header>

        {items.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>
            No items yet. Click &ldquo;New {def.singularName}&rdquo; to add one.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((item) => {
              const labelValue = def.slugSourceFieldId && item.values[def.slugSourceFieldId];
              const label =
                labelValue && "value" in labelValue && typeof labelValue.value === "string"
                  ? labelValue.value
                  : item.slug;
              return (
                <li
                  key={item.slug}
                  style={{
                    padding: "var(--space-3) var(--space-4)",
                    marginBottom: "var(--space-1)",
                    background: "var(--color-surface-raised)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <Link
                    href={`/admin/collections/${parsed.data}/items/${item.slug}`}
                    style={{
                      textDecoration: "none",
                      color: "var(--color-text)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: "var(--font-weight-semibold)" as unknown as number }}>
                      {label}
                    </span>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
                      /{item.slug}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </AdminShell>
  );
}
