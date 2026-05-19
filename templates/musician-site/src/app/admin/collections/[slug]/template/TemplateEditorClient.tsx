/**
 * Template editor (ADR-009 PR 6).
 *
 *   /admin/collections/<slug>/template/item    → itemTemplate
 *   /admin/collections/<slug>/template/detail  → detailTemplate
 *
 * Mounts Puck with the binding-aware editor config and persists the
 * resulting `Data` via `PUT /api/collections/<slug>/template/<kind>`.
 * The per-template route reads the rest of the def from disk and
 * applies only the chosen template slot — that keeps a concurrent
 * schema change in another tab from being silently rolled back.
 */

"use client";

import { Puck, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import { useCallback, useMemo, useState } from "react";

import { AdminAccountButton } from "@/components/admin/AdminAccountButton";
import { buildEditorPuckConfig } from "@/components/admin/buildEditorPuckConfig";
import {
  PuckBackLink,
  PuckLabelPill,
  PuckSaveStatusPill,
  type PuckEditorSaveStatus,
} from "@/components/admin/PuckEditorChrome";

import type { CollectionDef } from "@/lib/collections";

export type TemplateKind = "item" | "detail";

type Props = {
  collectionSlug: string;
  def: CollectionDef;
  kind: TemplateKind;
  email: string;
};

export function TemplateEditorClient({ collectionSlug, def, kind, email }: Props) {
  const initialData = useMemo<Data>(() => {
    const stored = kind === "item" ? def.itemTemplate : def.detailTemplate;
    if (stored && typeof stored === "object" && "content" in stored) {
      return stored as Data;
    }
    return { content: [], root: { props: {} } };
  }, [def, kind]);

  const config = useMemo(() => buildEditorPuckConfig(def), [def]);

  const [status, setStatus] = useState<PuckEditorSaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onPublish = useCallback(
    async (data: Data) => {
      setStatus("saving");
      setErrorMessage(null);
      // The dedicated per-template route writes ONLY the chosen slot,
      // reading the rest of the def from disk. The previous flow
      // round-tripped the full CollectionDef through /schema, which
      // silently rolled back any concurrent schema-editor save with
      // this editor's mount-time `fields` snapshot.
      try {
        const res = await fetch(
          `/api/collections/${collectionSlug}/template/${kind}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data }),
          },
        );
        const body = (await res.json().catch(() => null)) as
          | { ok: true; publishWarning?: string }
          | { ok: false; error?: string; issues?: Array<{ message: string }> }
          | null;
        if (!res.ok || !body || !body.ok) {
          // 409s carry a structured `issues` array — surface each
          // message so the artist sees what specifically blocked the
          // save (a binding to a removed field, a wrong-typed field,
          // etc.).
          const issueMessages =
            body && "issues" in body && Array.isArray(body.issues)
              ? body.issues.map((i) => i.message).join("; ")
              : "";
          const message =
            issueMessages ||
            (body && "error" in body && body.error) ||
            `Save failed (HTTP ${res.status})`;
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
    [collectionSlug, kind],
  );

  return (
    <Puck
      config={config}
      data={initialData}
      onPublish={onPublish}
      overrides={{
        headerActions: ({ children }) => (
          <>
            <PuckBackLink href={`/admin/collections/${collectionSlug}`}>
              ← {def.pluralName}
            </PuckBackLink>
            <PuckLabelPill title="Template kind">
              {kind === "item" ? "Item template" : "Detail template"}
            </PuckLabelPill>
            <PuckSaveStatusPill status={status} errorMessage={errorMessage} />
            {children}
            <AdminAccountButton email={email} />
          </>
        ),
      }}
    />
  );
}
