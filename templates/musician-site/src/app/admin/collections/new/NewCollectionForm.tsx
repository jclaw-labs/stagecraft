"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminPanel } from "@/components/admin/AdminPanel";
import { CheckboxField, TextField } from "@/components/admin/form";
// Imported from the schema *core* (not the `@/lib/collections` barrel,
// which transitively reaches `node:crypto` / `node:fs` / `next/headers`).
// schema.ts is node-free, so a `"use client"` file can run the same Zod
// schemas + slug helper the server uses — client-side validation with no
// drift from the server contract.
import {
  collectionNameSchema,
  slugSchema,
  slugifyToCollectionSlug,
} from "@/lib/collections/schema";

/**
 * Create-a-collection form.
 *
 * Posts `{ pluralName, singularName, isSingleton }` to
 * `POST /api/collections`; on success it routes to the new collection's
 * schema editor so the artist defines its fields next (a multi-item
 * collection starts with a default Title field; a singleton starts
 * empty).
 *
 * Slug handling: the plural name is slugified with the shared
 * `slugifyToCollectionSlug` and validated client-side with `slugSchema`
 * — the very functions the server route runs — so the artist sees a
 * field-level error before submitting rather than a round-trip 400. The
 * server re-derives and re-validates regardless (and still owns
 * collision detection, surfaced via the error banner below).
 */

type CreateResponse =
  | { ok: true; slug: string }
  | { ok: false; error?: string }
  | null;

export function NewCollectionForm() {
  const router = useRouter();

  const [pluralName, setPluralName] = useState("");
  const [singularName, setSingularName] = useState("");
  const [isSingleton, setIsSingleton] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slugPreview = slugifyToCollectionSlug(pluralName);
  // Validate the derived slug with the same Zod schema the server uses.
  // An empty input (slug = "") or one that's all punctuation (also "")
  // fails `slugSchema`, so this single check covers both the blank and
  // the "no slug-able characters" cases.
  const slugCheck = slugSchema.safeParse(slugPreview);
  // Validate the names with the same shared schema the server enforces
  // (length bound + no line breaks) so the artist sees an inline error
  // instead of a round-trip 400.
  const pluralNameCheck = collectionNameSchema.safeParse(pluralName);
  const singularNameCheck = collectionNameSchema.safeParse(singularName);
  // Field-level messages. Only surfaced once the artist has typed
  // something — an untouched empty field shouldn't shout on first paint.
  // For the plural name a length/format problem (e.g. over 80 chars)
  // takes precedence over the slug message.
  const pluralNameError =
    pluralName.trim().length === 0
      ? null
      : !pluralNameCheck.success
        ? pluralNameCheck.error.issues[0]?.message ?? "Invalid name"
        : !slugCheck.success
          ? "Use letters or digits — we couldn't make a URL slug from that."
          : null;
  const singularNameError =
    singularName.trim().length > 0 && !singularNameCheck.success
      ? singularNameCheck.error.issues[0]?.message ?? "Invalid name"
      : null;
  const isValid =
    pluralNameCheck.success && singularNameCheck.success && slugCheck.success;
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
      // Land on the schema editor so the artist defines fields next —
      // what the panel copy promises ("you'll shape its fields next in
      // the schema editor"). This is also what lets a singleton start
      // with no fields without stranding the artist: the singleton's own
      // item editor has no link back to the schema editor, but this is
      // the schema editor.
      router.push(`/admin/collections/${body.slug}/schema`);
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
          description={
            <>
              Shown in the sidebar and the list view (e.g. “Press quotes”).
              {pluralNameError ? (
                <span
                  role="alert"
                  style={{
                    display: "block",
                    marginTop: "var(--space-1)",
                    color: "var(--color-text-error)",
                    fontWeight: "var(--font-weight-semibold)" as unknown as number,
                  }}
                >
                  {pluralNameError}
                </span>
              ) : null}
            </>
          }
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
              {singularNameError ? (
                <span
                  role="alert"
                  style={{
                    display: "block",
                    marginTop: "var(--space-1)",
                    color: "var(--color-text-error)",
                    fontWeight: "var(--font-weight-semibold)" as unknown as number,
                  }}
                >
                  {singularNameError}
                </span>
              ) : null}
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
