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
import { useCallback, useMemo, useState } from "react";

import { AdminAccountButton } from "@/components/admin/AdminAccountButton";
import {
  PuckBackLink,
  PuckLabelPill,
  PuckSaveStatusPill,
  type PuckEditorSaveStatus,
} from "@/components/admin/PuckEditorChrome";
import { useBeforeUnloadIfDirty } from "@/components/admin/useBeforeUnloadIfDirty";
import { puckContentValue } from "@/lib/collections/puck-content-value";
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

  const [status, setStatus] = useState<PuckEditorSaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  useBeforeUnloadIfDirty(isDirty);

  const onPublish = useCallback(
    async (data: Data) => {
      setStatus("saving");
      setErrorMessage(null);
      // Round-trip the item with this one field updated. The PUT
      // endpoint takes a `values` object; we send a merged copy so
      // sibling fields aren't dropped.
      const nextValues = {
        ...initialItem.values,
        [fieldId]: puckContentValue(data),
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
        setIsDirty(false);
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
      onChange={() => setIsDirty(true)}
      overrides={{
        headerActions: ({ children }) => (
          <>
            <PuckBackLink href={`/admin/collections/${collectionSlug}/items/${itemSlug}`}>
              ← {pluralName}
            </PuckBackLink>
            <PuckLabelPill title="Editing field">{fieldKey}</PuckLabelPill>
            <PuckSaveStatusPill status={status} errorMessage={errorMessage} />
            {children}
            <AdminAccountButton email={email} />
          </>
        ),
      }}
    />
  );
}
