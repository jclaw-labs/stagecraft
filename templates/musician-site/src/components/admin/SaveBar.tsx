"use client";

import type { CSSProperties, ReactNode } from "react";

import { useEffect, useState } from "react";

/**
 * Sticky bottom save bar used by every Settings panel.
 *
 * State machine:
 *   idle → saving → saved → idle    (after 2.4s)
 *                      ↓
 *   idle → saving → error
 *
 * `isDirty` controls the Save button's disabled state — clean panels can't
 * trigger a save. Parent owns the form values and dirtiness check; this
 * component is presentational.
 */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type SaveBarProps = {
  isDirty: boolean;
  status: SaveStatus;
  errorMessage?: string;
  onSave: () => void | Promise<void>;
  /** Optional left-aligned hint (e.g. "Editing site settings"). */
  hint?: ReactNode;
};

const containerStyle: CSSProperties = {
  position: "sticky",
  bottom: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-3)",
  padding: "var(--space-3) var(--space-4)",
  background: "var(--color-surface)",
  borderTop: "1px solid var(--color-border)",
  boxShadow: "0 -2px 8px rgba(0, 0, 0, 0.04)",
  zIndex: 10,
};

const buttonBase: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  border: "1px solid transparent",
};

export function SaveBar({
  isDirty,
  status,
  errorMessage,
  onSave,
  hint,
}: SaveBarProps) {
  // The "Saved" toast auto-dismisses after a short window so the user doesn't
  // have to manage it. Errors stay visible until the next save attempt.
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (status !== "saved") {
      setShowSaved(false);
      return;
    }
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 2400);
    return () => clearTimeout(t);
  }, [status]);

  const isSaving = status === "saving";
  const canSave = isDirty && !isSaving;

  return (
    <div style={containerStyle} role="region" aria-label="Save bar">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-muted)",
        }}
      >
        {hint}
        {isDirty ? (
          <span aria-live="polite" style={{ color: "var(--color-text-emphasis)" }}>
            Unsaved changes
          </span>
        ) : null}
        {showSaved ? (
          <span aria-live="polite" style={{ color: "var(--color-text)" }}>
            ✓ Saved
          </span>
        ) : null}
        {status === "error" && errorMessage ? (
          <span role="alert" style={{ color: "var(--color-text-error)" }}>
            {errorMessage}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={!canSave}
        style={{
          ...buttonBase,
          background: canSave ? "var(--color-action)" : "var(--color-action-disabled)",
          color: "var(--color-action-fg)",
          cursor: canSave ? "pointer" : "not-allowed",
        }}
      >
        {isSaving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
