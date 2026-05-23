/**
 * Discard button for the admin chrome (ADR-010 §4).
 *
 * Posts to `POST /api/discard-draft`, which force-updates the `draft`
 * branch back to `main`'s current HEAD — wiping out every save that
 * accumulated since the last Publish. Destructive: there's no
 * server-side undo (GitHub's reflog holds the discarded commits for
 * a short window but isn't reachable through the admin).
 *
 * Rendered as a small text link rather than a button so it doesn't
 * visually compete with the Publish action. The confirm step is
 * mandatory — one click opens the confirm, second click on "Discard"
 * inside it actually fires. The confirm copy explicitly says
 * "This can't be undone."
 *
 * No deploy polling needed — discard doesn't touch `main`. The
 * artist's admin page may show stale data immediately after a
 * discard (their local writes are still in memory / on container
 * disk; only the remote draft was reset). The runtime-fetch + cache
 * layer (PR 4 of the rollout) will make this symmetric across
 * containers; until then, a manual refresh shows the new draft
 * state.
 */

"use client";

import { useState } from "react";
import type { CSSProperties } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "discarding" }
  | { kind: "discarded" }
  | { kind: "noop" }
  | { kind: "error"; message: string };

export function DiscardPendingChangesLink({
  isDegraded = false,
}: {
  /**
   * GitHub is unreachable. Discard force-updates the `draft` ref via
   * GitHub, so it can't run — disabled, with the AdminShell banner
   * explaining why (ADR-010 §5).
   */
  isDegraded?: boolean;
} = {}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function fire() {
    setStatus({ kind: "discarding" });
    try {
      const res = await fetch("/api/discard-draft", { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; mode: string; alreadyInSync: boolean }
        | { ok: false; code: string; error: string }
        | null;
      if (!res.ok || !body || !body.ok) {
        const message =
          (body && "error" in body && body.error) || `Discard failed (HTTP ${res.status})`;
        setStatus({ kind: "error", message });
        return;
      }
      setStatus({ kind: body.alreadyInSync ? "noop" : "discarded" });
    } catch (cause) {
      setStatus({
        kind: "error",
        message: cause instanceof Error ? cause.message : "Discard failed",
      });
    }
  }

  // While the discard is in flight, the link stays present but
  // disabled. After a terminal state, clicking the link re-enters
  // the confirm flow (so the artist can chain discards if they
  // want, though there's nothing to discard after the first).
  function onPrimaryClick() {
    if (isDegraded) return;
    if (status.kind === "idle" || status.kind === "discarded" || status.kind === "noop" || status.kind === "error") {
      setStatus({ kind: "confirming" });
    }
  }

  if (status.kind === "confirming") {
    return (
      <Confirm
        onCancel={() => setStatus({ kind: "idle" })}
        onConfirm={fire}
      />
    );
  }

  return (
    <div style={containerStyle}>
      <button
        type="button"
        onClick={onPrimaryClick}
        disabled={status.kind === "discarding" || isDegraded}
        title={isDegraded ? "Unavailable while GitHub is unreachable" : undefined}
        style={linkStyle}
      >
        {status.kind === "discarding" ? "Discarding…" : "Discard pending changes"}
      </button>
      <StatusLine status={status} />
    </div>
  );
}

function Confirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={confirmStyle}>
      <p style={confirmCopyStyle}>
        Discard all pending changes? This can&apos;t be undone.
      </p>
      <div style={confirmButtonsStyle}>
        <button type="button" onClick={onCancel} style={cancelButtonStyle}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} style={destructiveButtonStyle}>
          Discard
        </button>
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle" || status.kind === "confirming" || status.kind === "discarding") {
    return null;
  }
  if (status.kind === "discarded") {
    return (
      <span role="status" style={mutedStyle}>
        Discarded. Refresh to see the published state.
      </span>
    );
  }
  if (status.kind === "noop") {
    return (
      <span role="status" style={mutedStyle}>
        Nothing to discard.
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

const linkStyle: CSSProperties = {
  // Render as a flat, low-weight text affordance — sits below the
  // Publish button so it shouldn't visually compete with it.
  padding: 0,
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  textDecoration: "underline",
  background: "none",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};

const cancelButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const destructiveButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  border: "1px solid var(--color-text-error)",
  background: "var(--color-surface)",
  color: "var(--color-text-error)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};

const confirmStyle: CSSProperties = {
  padding: "var(--space-3)",
  background: "var(--color-surface-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  marginBottom: "var(--space-3)",
};

const confirmCopyStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text)",
  lineHeight: "var(--line-height-base)",
};

const confirmButtonsStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  justifyContent: "flex-end",
};

const mutedStyle: CSSProperties = {
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
