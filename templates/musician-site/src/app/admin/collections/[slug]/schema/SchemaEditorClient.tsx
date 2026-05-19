/**
 * Client wrapper for the SchemaEditor (ADR-009 PR 5).
 *
 * Owns local form state + dirty tracking, calls
 * `PUT /api/collections/<slug>/schema`. On a 409 (validation
 * report), surfaces `issues` and `warnings` back to the editor so
 * inline errors can render.
 */

"use client";

import { useCallback, useMemo, useState } from "react";

import {
  SchemaEditor,
  type SchemaEditorIssue,
  type SchemaEditorWarning,
} from "@/components/admin/SchemaEditor";
import { SaveBar, type SaveStatus } from "@/components/admin/SaveBar";

import type { CollectionDef } from "@/lib/collections";

export function SchemaEditorClient({
  collectionSlug,
  initialDef,
}: {
  collectionSlug: string;
  initialDef: CollectionDef;
}) {
  const [def, setDef] = useState<CollectionDef>(initialDef);
  const [initialSnapshot, setInitialSnapshot] = useState(() => JSON.stringify(initialDef));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<SchemaEditorIssue[]>([]);
  const [warnings, setWarnings] = useState<SchemaEditorWarning[]>([]);

  const isDirty = useMemo(
    () => JSON.stringify(def) !== initialSnapshot,
    [def, initialSnapshot],
  );

  const save = useCallback(async () => {
    setStatus("saving");
    setErrorMessage(null);
    setIssues([]);
    setWarnings([]);
    try {
      const res = await fetch(`/api/collections/${collectionSlug}/schema`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(def),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            ok: true;
            def: CollectionDef;
            warnings?: SchemaEditorWarning[];
            publishWarning?: string;
          }
        | {
            ok: false;
            error?: string;
            issues?: SchemaEditorIssue[];
            warnings?: SchemaEditorWarning[];
          }
        | null;

      if (res.status === 409 && body && !body.ok) {
        setIssues(body.issues ?? []);
        setWarnings(body.warnings ?? []);
        setErrorMessage(body.error ?? "Schema change blocked");
        setStatus("error");
        return;
      }
      if (!res.ok || !body || !body.ok) {
        const message =
          (body && "error" in body && body.error) || `Save failed (HTTP ${res.status})`;
        setErrorMessage(message);
        setStatus("error");
        return;
      }
      setDef(body.def);
      setInitialSnapshot(JSON.stringify(body.def));
      setWarnings(body.warnings ?? []);
      setStatus("saved");
      if ("publishWarning" in body && body.publishWarning) {
        setErrorMessage(`Saved locally, publish warning: ${body.publishWarning}`);
      }
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Save failed");
      setStatus("error");
    }
  }, [collectionSlug, def]);

  return (
    <>
      <SchemaEditor def={def} onChange={setDef} issues={issues} warnings={warnings} />
      <SaveBar
        isDirty={isDirty}
        status={status}
        errorMessage={errorMessage ?? ""}
        onSave={save}
      />
    </>
  );
}
