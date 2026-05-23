/**
 * Client wrapper for the "new item" flow.
 *
 * Adds a slug input above the field editor — the slug becomes the
 * item's filename. Slug suggestions come from
 * `@/lib/collections/suggest-slug`, which handles both the common
 * text-source case and the photo-specific image-derived case.
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ItemEditor, type ReferenceOptions } from "@/components/admin/ItemEditor";
import { SaveBar, type SaveStatus } from "@/components/admin/SaveBar";
import { TextField } from "@/components/admin/form";

import { suggestSlug } from "@/lib/collections/suggest-slug";
import type { CollectionDef, Item } from "@/lib/collections";

export function NewItemClient({
  def,
  draft: initialDraft,
  referenceOptions,
  collectionSlug,
}: {
  def: CollectionDef;
  draft: Item;
  referenceOptions: ReferenceOptions;
  collectionSlug: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Item>(initialDraft);
  const [slugInput, setSlugInput] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const suggestedSlug = suggestSlug(draft, def);
  const slug = slugInput || suggestedSlug;

  const save = async () => {
    if (!slug) {
      setErrorMessage("Slug is required");
      setStatus("error");
      return;
    }
    setStatus("saving");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/collections/${collectionSlug}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, values: draft.values }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; item: Item; publishWarning?: string }
        | {
            ok: false;
            error?: string;
            issues?: Array<{ path: string; message: string }>;
          }
        | null;
      if (!res.ok || !body || !body.ok) {
        // The route returns structured `issues` on a 400 from
        // per-collection Zod validation. Surface each path/message
        // pair so the artist can see which field failed and why,
        // instead of a single opaque "Validation failed" string.
        const issueMessages =
          body && "issues" in body && Array.isArray(body.issues) && body.issues.length > 0
            ? body.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")
            : "";
        const message =
          issueMessages ||
          (body && "error" in body && body.error) ||
          `Save failed (HTTP ${res.status})`;
        setErrorMessage(message);
        setStatus("error");
        return;
      }
      setStatus("saved");
      router.push(`/admin/collections/${collectionSlug}/items/${body.item.slug}`);
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Save failed");
      setStatus("error");
    }
  };

  return (
    <main
      style={{
        maxWidth: "var(--max-width-content)",
        margin: "var(--space-8) auto",
        padding: "0 var(--space-4)",
      }}
    >
      <h1
        style={{
          fontSize: "var(--font-size-2xl)",
          fontWeight: "var(--font-weight-bold)" as unknown as number,
          margin: 0,
          marginBottom: "var(--space-6)",
        }}
      >
        New {def.singularName}
      </h1>
      <TextField
        label="Slug"
        description="URL-safe id. Auto-suggested from the title field when blank."
        isRequired
        value={slugInput}
        placeholder={suggestedSlug || `new-${def.singularName.replace(/\s+/g, "-")}`}
        onChange={setSlugInput}
      />
      <ItemEditor
        def={def}
        item={draft}
        onChange={setDraft}
        referenceOptions={referenceOptions}
      />
      <SaveBar
        isDirty={Boolean(slug || JSON.stringify(draft.values) !== "{}")}
        status={status}
        errorMessage={errorMessage ?? ""}
        onSave={save}
      />
    </main>
  );
}

