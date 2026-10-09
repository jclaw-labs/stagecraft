"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SaveStatus } from "./SaveBar";
import { useBeforeUnloadIfDirty } from "./useBeforeUnloadIfDirty";

/**
 * Hook that backs every custom singleton panel (Site Settings,
 * Header & Navigation, Appearance) with the same dirty-tracking +
 * save logic.
 *
 * Saves go through `PUT /api/collections/<collectionSlug>/items/_singleton`
 * — the same endpoint the generic collection editor uses. Two save
 * APIs for the same on-disk data was the original SSOT-drift smell;
 * one endpoint, one write path now.
 *
 * The hook owns:
 *   - the current value (with a setter)
 *   - a derived `isDirty` flag (deep-equality vs. the initial snapshot)
 *   - the SaveBar status machine (idle → saving → saved | error)
 *   - the actual save call (PUT `{ values: toValues(value) }` to the
 *     collection-item endpoint)
 *
 * Panels stay declarative: build the form with `value` + `setValue`,
 * drop `<SaveBar {...form.saveBarProps} />` at the bottom, done.
 *
 * The legacy `toValues` shape is what each panel maintains internally
 * (e.g. `SiteConfig` for Site Settings); we convert to the
 * Collection's `Item["values"]` shape at save time so the form code
 * stays panel-flavoured and the wire format stays one shape.
 */

// Avoid pulling `node:crypto` into the client bundle by depending on
// `Item["values"]` via the schema barrel — instead, derive the shape
// from a type-only import of `FieldValue`. The runtime helper for
// puckContent values comes from a node-import-free sibling module.
import type { FieldValue } from "@/lib/collections/schema";

export type ItemValues = Record<string, FieldValue>;

export type UseSettingsFormArgs<T> = {
  initial: T;
  /** Collection slug whose singleton item this form edits. */
  collectionSlug: string;
  /** Convert the form's local shape to Collection `Item["values"]`. */
  toValues: (value: T) => ItemValues;
};

export type UseSettingsFormResult<T> = {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  isDirty: boolean;
  status: SaveStatus;
  errorMessage: string | null;
  save: () => Promise<void>;
  saveBarProps: {
    isDirty: boolean;
    status: SaveStatus;
    errorMessage: string;
    onSave: () => Promise<void>;
  };
};

export function useSettingsForm<T>({
  initial,
  collectionSlug,
  toValues,
}: UseSettingsFormArgs<T>): UseSettingsFormResult<T> {
  // Snapshot the initial value as a JSON string and compare on every render.
  // The form schemas are plain JSON, so JSON.stringify is sufficient and
  // avoids pulling in a deep-equality dependency.
  const [initialSnapshot, setInitialSnapshot] = useState(() => JSON.stringify(initial));
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Pin `toValues` through a ref so an inline-passed callback (fresh
  // identity every render) doesn't thrash the `save` memo. The three
  // current callers pass module-level functions, but the hook
  // shouldn't depend on that discipline being maintained.
  const toValuesRef = useRef(toValues);
  useEffect(() => {
    toValuesRef.current = toValues;
  }, [toValues]);

  const isDirty = useMemo(
    () => JSON.stringify(value) !== initialSnapshot,
    [value, initialSnapshot],
  );
  useBeforeUnloadIfDirty(isDirty);

  const save = useCallback(async () => {
    setStatus("saving");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/collections/${collectionSlug}/items/_singleton`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: toValuesRef.current(value) }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        const message =
          (body && "error" in body && body.error) || `Save failed (HTTP ${res.status})`;
        setErrorMessage(message);
        setStatus("error");
        return;
      }
      // Reset the snapshot to the saved value so the form goes back to
      // pristine; the user can keep editing afterward.
      setInitialSnapshot(JSON.stringify(value));
      setStatus("saved");
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Save failed");
      setStatus("error");
    }
  }, [collectionSlug, value]);

  return {
    value,
    setValue,
    isDirty,
    status,
    errorMessage,
    save,
    saveBarProps: {
      isDirty,
      status,
      errorMessage: errorMessage ?? "",
      onSave: save,
    },
  };
}
