/**
 * Publish button for the admin chrome (ADR-010).
 *
 * Posts to `POST /api/publish-draft`, which squashes whatever's
 * accumulated on `draft` into `main` (triggering the deploy). When
 * there's nothing pending the endpoint short-circuits with
 * `alreadyInSync: true` — we surface "Nothing to publish" in that
 * case rather than 500.
 *
 * After a successful publish in production, `useDeployStatus` polls
 * `/api/publish-status` and surfaces the deploy lifecycle — the
 * button reports "Building…" while Vercel/Netlify builds, then "Live"
 * when the deploy reaches `ready`. Without polling the artist sees
 * "Published" instantly but the live site doesn't update for ~60s,
 * which trips every first-time user.
 *
 * A small confirmation step gates the action: one click opens the
 * confirm; second click on "Publish" inside it actually fires. The
 * confirm is cancellable and prevents accidental publishes (e.g.,
 * the artist hits the button mid-edit by mistake).
 */

"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { useDeployStatus } from "./useDeployStatus";

type Status =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "publishing" }
  | { kind: "noop" }
  | { kind: "in_flight"; publishedAt: number }
  | { kind: "live" }
  | { kind: "stalled" }
  // ADR-010 §6: the publish layer maps a stale-ref retry exhaustion to
  // `code: "concurrent-edit"` (HTTP 409). The recovery is a page
  // reload: the in-memory editor state is stale relative to the
  // artist's repo, so re-publishing without reloading would just race
  // again with whichever tab won the previous round.
  | { kind: "concurrent_edit" }
  | { kind: "error"; message: string };

export function PublishPendingChangesButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const deployStatus = useDeployStatus(
    status.kind === "in_flight" ? status.publishedAt : null,
  );

  // Reflect deploy-polling terminal states into our local status.
  // The hook owns the in_flight phase progression; we only lift the
  // resolved states (ready / error / stalled) so the button label
  // and a subsequent click-to-republish work off a single state
  // machine rather than two parallel ones.
  useEffect(() => {
    if (status.kind !== "in_flight" || !deployStatus) return;
    if (deployStatus.status === "ready") {
      setStatus({ kind: "live" });
    } else if (deployStatus.status === "error") {
      setStatus({ kind: "error", message: deployStatus.message });
    } else if (deployStatus.status === "stalled") {
      setStatus({ kind: "stalled" });
    }
  }, [status, deployStatus]);

  async function fire() {
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
        // ADR-010 §6: a `concurrent-edit` code is a separate recovery
        // path from a generic publish failure — surfacing it as the
        // same red error toast would just retrain the artist to
        // re-click Publish, which would race again.
        if (body && "code" in body && body.code === "concurrent-edit") {
          setStatus({ kind: "concurrent_edit" });
          return;
        }
        const message =
          (body && "error" in body && body.error) || `Publish failed (HTTP ${res.status})`;
        setStatus({ kind: "error", message });
        return;
      }
      if (body.alreadyInSync) {
        setStatus({ kind: "noop" });
        return;
      }
      if (body.mode === "local" || body.commitSha === null) {
        // Dev fallback: no deploy to poll for; treat as immediately
        // live. The artist's local dev server already serves the
        // saved files.
        setStatus({ kind: "live" });
        return;
      }
      // Production: deploy is in flight; start polling.
      setStatus({ kind: "in_flight", publishedAt: Date.now() });
    } catch (cause) {
      setStatus({
        kind: "error",
        message: cause instanceof Error ? cause.message : "Publish failed",
      });
    }
  }

  function onPrimaryClick() {
    // Re-clicking after a terminal state re-enters the confirm flow.
    if (
      status.kind === "idle" ||
      status.kind === "noop" ||
      status.kind === "live" ||
      status.kind === "stalled" ||
      status.kind === "error"
    ) {
      setStatus({ kind: "confirming" });
    }
  }

  return (
    <div style={containerStyle}>
      {status.kind === "confirming" ? (
        <Confirm
          onCancel={() => setStatus({ kind: "idle" })}
          onConfirm={fire}
        />
      ) : status.kind === "concurrent_edit" ? (
        // Reload, not republish: in-memory editor state diverges from
        // whatever the other tab just committed. Reloading re-reads
        // from disk so the artist sees the merged state before they
        // try again.
        <button type="button" onClick={() => window.location.reload()} style={buttonStyle}>
          Reload
        </button>
      ) : (
        <button
          type="button"
          onClick={onPrimaryClick}
          disabled={status.kind === "publishing" || status.kind === "in_flight"}
          style={isBusy(status) ? { ...buttonStyle, ...buttonDisabledStyle } : buttonStyle}
        >
          {buttonLabel(status, deployStatus)}
        </button>
      )}
      <StatusLine status={status} deployStatus={deployStatus} />
    </div>
  );
}

function isBusy(status: Status): boolean {
  return status.kind === "publishing" || status.kind === "in_flight";
}

function buttonLabel(
  status: Status,
  deployStatus: ReturnType<typeof useDeployStatus>,
): string {
  switch (status.kind) {
    case "publishing":
      return "Publishing…";
    case "in_flight": {
      // Mirror Editor.tsx's old "Building…" / "Finalizing…" labels.
      if (deployStatus?.status === "in_flight" && deployStatus.phase === "finalizing") {
        return "Finalizing…";
      }
      return "Building…";
    }
    default:
      return "Publish changes";
  }
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
        Publish all pending changes? This triggers a deploy.
      </p>
      <div style={confirmButtonsStyle}>
        <button type="button" onClick={onCancel} style={cancelButtonStyle}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm} style={buttonStyle}>
          Publish
        </button>
      </div>
    </div>
  );
}

function StatusLine({
  status,
  deployStatus,
}: {
  status: Status;
  deployStatus: ReturnType<typeof useDeployStatus>;
}) {
  if (status.kind === "idle" || status.kind === "confirming" || status.kind === "publishing") {
    return null;
  }
  if (status.kind === "in_flight") {
    // While the deploy is in flight, surface the phase as a hint.
    const phase = deployStatus?.status === "in_flight" ? deployStatus.phase : "queued";
    return (
      <span role="status" style={mutedStyle}>
        Deploy is {phase}.
      </span>
    );
  }
  if (status.kind === "live") {
    return (
      <span role="status" style={mutedStyle}>
        Live.
      </span>
    );
  }
  if (status.kind === "noop") {
    return (
      <span role="status" style={mutedStyle}>
        Nothing to publish.
      </span>
    );
  }
  if (status.kind === "stalled") {
    return (
      <span role="status" style={mutedStyle}>
        Build still running — refresh to check.
      </span>
    );
  }
  if (status.kind === "concurrent_edit") {
    return (
      <span role="status" style={mutedStyle}>
        Someone else just saved — reload to see the latest version
        before publishing.
      </span>
    );
  }
  return (
    <span role="alert" style={errorStyle} title={status.message}>
      {status.message}
    </span>
  );
}

// Exported for direct testing — `PublishPendingChangesButton`'s
// status machine is driven by fetch responses + a polling hook, so
// SSR snapshots of the button can't reach the concurrent-edit /
// stalled / error states. Tests render `StatusLine` with a literal
// status instead.
export { StatusLine as __StatusLine };

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

const cancelButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
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
