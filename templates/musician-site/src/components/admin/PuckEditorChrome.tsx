/**
 * Shared chrome for the Puck-based admin editors (template editor +
 * embedded puckContent body editor). Both editors mount Puck at full
 * viewport and need:
 *
 *   - A back link to the parent collection
 *   - A label chip (template kind, or which field is being edited)
 *   - A save-status pill that mirrors the SaveBar's idle/saving/saved/
 *     error states (the SaveBar itself is for the form-based admin
 *     surfaces; Puck owns its own bottom UI)
 *
 * Extracted so the two editors stay in sync — drift between them was
 * already cropping up before this split.
 */

"use client";

import type { CSSProperties, ReactNode } from "react";

export type PuckEditorSaveStatus = "idle" | "saving" | "saved" | "error";

const backLinkStyle: CSSProperties = {
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

const labelPillStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  fontFamily: "var(--font-mono)",
};

const statusPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  background: "var(--color-surface-raised)",
  color: "var(--color-text-muted)",
  borderRadius: "var(--radius-sm)",
};

export function PuckBackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} style={backLinkStyle} title="Back">
      {children}
    </a>
  );
}

export function PuckLabelPill({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span style={labelPillStyle} title={title}>
      {children}
    </span>
  );
}

export function PuckSaveStatusPill({
  status,
  errorMessage,
}: {
  status: PuckEditorSaveStatus;
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
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return null;
    }
  }
}
