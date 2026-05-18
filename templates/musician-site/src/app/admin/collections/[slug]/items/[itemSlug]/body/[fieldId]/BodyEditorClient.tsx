/**
 * Client wrapper for the embedded puckContent editor (ADR-009 PR 6).
 *
 * Loads the item's current value for the chosen puckContent field,
 * mounts Puck against the public templatePuckConfig (no bindings — see
 * sibling `page.tsx`), saves via the standard item PUT endpoint
 * (`/api/collections/<slug>/items/<itemSlug>`).
 */

"use client";

import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { AdminAccountButton } from "@/components/admin/AdminAccountButton";
import { templatePuckConfig } from "@/lib/collections/template/puck-config";

import type { Item } from "@/lib/collections";

type Props = {
  collectionSlug: string;
  itemSlug: string;
  fieldId: string;
  pluralName: string;
  fieldKey: string;
  initialItem: Item;
  email: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function BodyEditorClient({
  collectionSlug,
  itemSlug,
  fieldId,
  pluralName,
  fieldKey,
  initialItem,
  email,
}: Props) {
  const initialData = useMemo<Data>(() => {
    const stored = initialItem.values[fieldId];
    if (stored && stored.type === "puckContent") {
      return stored.value as Data;
    }
    return { content: [], root: { props: {} } };
  }, [initialItem, fieldId]);

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onPublish = useCallback(
    async (data: Data) => {
      setStatus("saving");
      setErrorMessage(null);
      // Round-trip the item with this one field updated. The PUT
      // endpoint takes a `values` object; we send a merged copy so
      // sibling fields aren't dropped.
      const nextValues = {
        ...initialItem.values,
        [fieldId]: { type: "puckContent" as const, value: data as never },
      };
      try {
        const res = await fetch(
          `/api/collections/${collectionSlug}/items/${itemSlug}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ values: nextValues }),
          },
        );
        const body = (await res.json().catch(() => null)) as
          | { ok: true; publishWarning?: string }
          | { ok: false; error?: string }
          | null;
        if (!res.ok || !body || !body.ok) {
          const message =
            (body && "error" in body && body.error) || `Save failed (HTTP ${res.status})`;
          setStatus("error");
          setErrorMessage(message);
          return;
        }
        setStatus("saved");
        if ("publishWarning" in body && body.publishWarning) {
          setErrorMessage(`Saved locally, publish warning: ${body.publishWarning}`);
        }
      } catch (cause) {
        setStatus("error");
        setErrorMessage(cause instanceof Error ? cause.message : "Save failed");
      }
    },
    [collectionSlug, itemSlug, fieldId, initialItem.values],
  );

  return (
    <Puck
      config={templatePuckConfig}
      data={initialData}
      onPublish={onPublish}
      overrides={{
        headerActions: ({ children }) => (
          <>
            <Link
              href={`/admin/collections/${collectionSlug}/items/${itemSlug}`}
              style={backLinkStyle}
              title="Back to item editor"
            >
              ← {pluralName}
            </Link>
            <span style={pillStyle} title="Editing field">
              {fieldKey}
            </span>
            <SaveStatusPill status={status} errorMessage={errorMessage} />
            {children}
            <AdminAccountButton email={email} />
          </>
        ),
      }}
    />
  );
}

function SaveStatusPill({
  status,
  errorMessage,
}: {
  status: SaveStatus;
  errorMessage: string | null;
}) {
  switch (status) {
    case "idle":
      return null;
    case "saving":
      return <span style={statusPillStyle}>Saving…</span>;
    case "saved":
      return (
        <span style={statusPillStyle} title={errorMessage ?? undefined}>
          {errorMessage ? "Saved (warning)" : "Saved"}
        </span>
      );
    case "error":
      return (
        <span
          style={{ ...statusPillStyle, color: "var(--color-text-error)" }}
          role="alert"
          title={errorMessage ?? undefined}
        >
          Save failed
        </span>
      );
  }
}

const backLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  padding: "var(--space-1) var(--space-3)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  textDecoration: "none",
};

const pillStyle: React.CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  fontFamily: "var(--font-mono)",
};

const statusPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  background: "var(--color-surface-raised)",
  color: "var(--color-text-muted)",
  borderRadius: "var(--radius-sm)",
};
