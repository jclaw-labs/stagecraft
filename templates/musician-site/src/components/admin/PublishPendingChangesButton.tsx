/**
 * Publish button for the admin chrome (ADR-010).
 *
 * Posts to `POST /api/publish-draft`, which squashes whatever's
 * accumulated on `draft` into `main` (triggering the deploy). When
 * there's nothing pending the endpoint short-circuits with
 * `alreadyInSync: true` — we surface "Nothing to publish" in that
 * case rather than 500.
 *
 * Lives in the AdminShell sidebar so every admin page exposes a way
 * to ship pending changes. A future iteration (once
 * `GET /api/pending-changes` lands) will gate the button on actual
 * pendingness and surface a count.
 */

"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "success"; commitSha: string | null; alreadyInSync: boolean }
  | { kind: "error"; message: string };

export function PublishPendingChangesButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onClick() {
    if (status.kind === "publishing") return;
    setStatus({ kind: "publishing" });
    try {
      const res = await fetch("/api/publish-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; commitSha: string | null; mode: string; alreadyInSync: boolean }
        | { ok: false; code: string; error: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        const message =
          (body && "error" in body && body.error) || `Publish failed (HTTP ${res.status})`;
        setStatus({ kind: "error", message });
        return;
      }
      setStatus({
        kind: "success",
        commitSha: body.commitSha,
        alreadyInSync: body.alreadyInSync,
      });
    } catch (cause) {
      setStatus({
        kind: "error",
        message: cause instanceof Error ? cause.message : "Publish failed",
      });
    }
  }

  return (
    <div style={containerStyle}>
      <button
        type="button"
        onClick={onClick}
        disabled={status.kind === "publishing"}
        style={
          status.kind === "publishing"
            ? { ...buttonStyle, ...buttonDisabledStyle }
            : buttonStyle
        }
      >
        {status.kind === "publishing" ? "Publishing…" : "Publish changes"}
      </button>
      <StatusLine status={status} />
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle" || status.kind === "publishing") return null;
  if (status.kind === "success") {
    return (
      <span role="status" style={successStyle}>
        {status.alreadyInSync
          ? "Nothing to publish."
          : status.commitSha
            ? "Published."
            : "Saved locally (dev mode)."}
      </span>
    );
  }
  return (
    <span role="alert" style={errorStyle} title={status.message}>
      {status.message}
    </span>
  );
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  marginBottom: "var(--space-3)",
};

const buttonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  border: "1px solid transparent",
  background: "var(--color-action)",
  color: "var(--color-action-fg)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  textAlign: "center",
};

const buttonDisabledStyle: CSSProperties = {
  background: "var(--color-action-disabled)",
  cursor: "wait",
};

const successStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
};

const errorStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-error)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
