"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminPanel } from "@/components/admin/AdminPanel";
import { CheckboxField, TextField } from "@/components/admin/form";

/**
 * Create-a-collection form.
 *
 * Posts `{ pluralName, singularName, isSingleton }` to
 * `POST /api/collections`; on success it routes to the new collection's
 * admin surface — the generic list view for a multi-item collection, or
 * straight to the single item for a singleton.
 *
 * Slug discipline (CLAUDE.md client-bundle rule): we must NOT value-
 * import `@/lib/collections` here, because the barrel transitively
 * reaches `node:crypto` / `node:fs` / `next/headers`. The slug preview
 * is computed by a tiny inline slugify that mirrors the server's
 * `slugifyPluralName` exactly (lowercase, collapse non-alphanumeric
 * runs to `-`, trim leading/trailing `-`). The server re-derives and
 * validates the slug, so this is preview-only.
 */

function slugifyPluralName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type CreateResponse =
  | { ok: true; slug: string; publishWarning?: string }
  | { ok: false; error?: string }
  | null;

export function NewCollectionForm() {
  const router = useRouter();

  const [pluralName, setPluralName] = useState("");
  const [singularName, setSingularName] = useState("");
  const [isSingleton, setIsSingleton] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugPreview = slugifyPluralName(pluralName);
  const isValid =
    pluralName.trim().length > 0 &&
    singularName.trim().length > 0 &&
    slugPreview.length > 0;
  const canCreate = isValid && !isCreating;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canCreate) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pluralName: pluralName.trim(),
          singularName: singularName.trim(),
          isSingleton,
        }),
      });
      const body = (await res.json().catch(() => null)) as CreateResponse;
      if (!res.ok || !body || !body.ok) {
        setError(
          (body && "error" in body && body.error) ||
            `Create failed (HTTP ${res.status})`,
        );
        return;
      }
      // Singletons go straight to their single item; multi-item
      // collections land on the generic list view. Mirrors the
      // AdminShell sidebar's own singleton-vs-list routing.
      const destination = isSingleton
        ? `/admin/collections/${body.slug}/items/_singleton`
        : `/admin/collections/${body.slug}`;
      router.push(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Create failed");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <AdminPanel
      title="New collection"
      description="A collection is any repeatable content type — releases, tour dates, FAQ entries, press quotes. Name it here; you'll shape its fields next in the schema editor."
    >
      <form onSubmit={handleSubmit}>
        <TextField
          id="new-collection-plural"
          label="Plural name"
          description="Shown in the sidebar and the list view (e.g. “Press quotes”)."
          value={pluralName}
          onChange={setPluralName}
          placeholder="e.g. Press quotes"
          isRequired
        />
        <TextField
          id="new-collection-singular"
          label="Singular name"
          description={
            <>
              Used for buttons and labels for a single entry (e.g. “New{" "}
              {singularName.trim() || "press quote"}”).
            </>
          }
          value={singularName}
          onChange={setSingularName}
          placeholder="e.g. Press quote"
          isRequired
        />
        <CheckboxField
          id="new-collection-singleton"
          label="Single entry (one record, like Site Settings)"
          description="Turn on if this collection holds exactly one record — a settings-style page rather than a list of items. You can't change this later."
          value={isSingleton}
          onChange={setIsSingleton}
        />

        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-muted)",
            marginBottom: "var(--space-4)",
          }}
        >
          URL slug:{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>
            /admin/collections/{slugPreview || "your-slug"}
          </code>
        </p>

        {error ? (
          <div
            role="alert"
            style={{
              color: "var(--color-text-error)",
              fontSize: "var(--font-size-sm)",
              marginBottom: "var(--space-4)",
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!canCreate}
          style={{
            padding: "var(--space-2) var(--space-4)",
            fontSize: "var(--font-size-sm)",
            fontWeight: "var(--font-weight-semibold)" as unknown as number,
            border: "1px solid transparent",
            background: canCreate
              ? "var(--color-action)"
              : "var(--color-action-disabled)",
            color: "var(--color-action-fg)",
            cursor: canCreate ? "pointer" : "not-allowed",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {isCreating ? "Creating…" : "Create collection"}
        </button>
      </form>
    </AdminPanel>
  );
}
