/**
 * Client wrapper for the generic ItemEditor.
 *
 * Owns form state, dirty tracking, and the save call to
 * `/api/collections/<slug>/items/<itemSlug>`. The parent server
 * component pre-fetches the CollectionDef + Item + reference options.
 */

"use client";

import { useCallback, useMemo, useState } from "react";

import { ItemEditor, type ReferenceOptions } from "@/components/admin/ItemEditor";
import { SaveBar, type SaveStatus } from "@/components/admin/SaveBar";
import { useBeforeUnloadIfDirty } from "@/components/admin/useBeforeUnloadIfDirty";

import type { CollectionDef, Item } from "@/lib/collections";

export function ItemEditorClient({
  def,
  item: initialItem,
  referenceOptions,
  collectionSlug,
  itemSlug,
}: {
  def: CollectionDef;
  item: Item;
  referenceOptions: ReferenceOptions;
  collectionSlug: string;
  itemSlug: string;
}) {
  const [item, setItem] = useState<Item>(initialItem);
  const [initialSnapshot, setInitialSnapshot] = useState(() => JSON.stringify(initialItem));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isDirty = useMemo(
    () => JSON.stringify(item) !== initialSnapshot,
    [item, initialSnapshot],
  );
  useBeforeUnloadIfDirty(isDirty);

  const save = useCallback(async () => {
    setStatus("saving");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/collections/${collectionSlug}/items/${itemSlug}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: item.values }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { ok: true; item: Item }
        | {
            ok: false;
            error?: string;
            issues?: Array<{ path: string; message: string }>;
          }
        | null;
      if (!res.ok || !body || !body.ok) {
        // The route returns structured `issues` on a 400 from
        // per-collection Zod validation — surface each field's path
        // and message instead of a single opaque error string.
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
      // Update with the server's canonical version (refreshed timestamps).
      setItem(body.item);
      setInitialSnapshot(JSON.stringify(body.item));
      setStatus("saved");
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Save failed");
      setStatus("error");
    }
  }, [collectionSlug, itemSlug, item]);

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
          marginBottom: "var(--space-1)",
        }}
      >
        Edit {def.singularName}
      </h1>
      <p style={{ color: "var(--color-text-muted)", marginBottom: "var(--space-6)" }}>
        {def.isSingleton ? def.pluralName : `${def.pluralName} / ${itemSlug}`}
      </p>
      <ItemEditor
        def={def}
        item={item}
        onChange={setItem}
        referenceOptions={referenceOptions}
      />
      <SaveBar
        isDirty={isDirty}
        status={status}
        errorMessage={errorMessage ?? ""}
        onSave={save}
      />
    </main>
  );
}
