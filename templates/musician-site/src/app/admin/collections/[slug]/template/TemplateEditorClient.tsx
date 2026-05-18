/**
 * Template editor (ADR-009 PR 6).
 *
 *   /admin/collections/<slug>/template/item    → itemTemplate
 *   /admin/collections/<slug>/template/detail  → detailTemplate
 *
 * Mounts Puck with the binding-aware editor config and persists the
 * resulting `Data` to the corresponding template slot on the
 * `CollectionDef` via `PUT /api/collections/<slug>/schema`. The schema
 * route accepts the full def; we round-trip the def with one template
 * field updated.
 */

"use client";

import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { AdminAccountButton } from "@/components/admin/AdminAccountButton";
import { buildEditorPuckConfig } from "@/components/admin/buildEditorPuckConfig";

import type { CollectionDef } from "@/lib/collections";

export type TemplateKind = "item" | "detail";

type Props = {
  collectionSlug: string;
  def: CollectionDef;
  kind: TemplateKind;
  email: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function TemplateEditorClient({ collectionSlug, def, kind, email }: Props) {
  const initialData = useMemo<Data>(() => {
    const stored = kind === "item" ? def.itemTemplate : def.detailTemplate;
    if (stored && typeof stored === "object" && "content" in stored) {
      return stored as Data;
    }
    return { content: [], root: { props: {} } };
  }, [def, kind]);

  const config = useMemo(() => buildEditorPuckConfig(def), [def]);

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onPublish = useCallback(
    async (data: Data) => {
      setStatus("saving");
      setErrorMessage(null);
      const nextDef: CollectionDef = {
        ...def,
        ...(kind === "item"
          ? { itemTemplate: data as CollectionDef["itemTemplate"] }
          : { detailTemplate: data as CollectionDef["detailTemplate"] }),
      };
      try {
        const res = await fetch(`/api/collections/${collectionSlug}/schema`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(nextDef),
        });
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
    [collectionSlug, def, kind],
  );

  return (
    <Puck
      config={config}
      data={initialData}
      onPublish={onPublish}
      overrides={{
        headerActions: ({ children }) => (
          <>
            <Link
              href={`/admin/collections/${collectionSlug}`}
              style={backLinkStyle}
              title="Back to collection"
            >
              ← {def.pluralName}
            </Link>
            <span style={pillStyle} title="Template kind">
              {kind === "item" ? "Item template" : "Detail template"}
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
