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
