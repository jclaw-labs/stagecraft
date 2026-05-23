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
 * The confirm step is a modal (`PublishConfirmModal`) that lists the
 * pending changes. One click on the sidebar button opens the modal;
 * inside, "Publish" fires the API and "Cancel" / escape / click-
 * backdrop dismisses. Modal stays open during the publish API call
 * for visual continuity, then closes once `fire()` transitions
 * status to `in_flight` / `live` / `error` and the deploy-status
 * pill takes over.
 */

"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import type { PublishError as PublishErrorPayload } from "@/lib/publish-types";

import { PublishConfirmModal } from "./PublishConfirmModal";
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

export function PublishPendingChangesButton({
  isDegraded = false,
}: {
  /**
   * GitHub is unreachable (the read store is serving the FS snapshot).
   * Publishing requires GitHub, so the action is disabled — the
   * AdminShell banner explains why. Passed from the server, which knows
   * the request's degraded state (ADR-010 §5).
   */
  isDegraded?: boolean;
} = {}) {
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

  async function fire(commitSubject: string | null) {
    setStatus({ kind: "publishing" });
    try {
      const res = await fetch("/api/publish-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Send a body only when the artist supplied a subject; the
        // route's request schema is `partial({ commitSubject? })`,
        // so an empty body (no `commitSubject` at all) is the path
        // the route falls back to its own default on.
        body: commitSubject !== null ? JSON.stringify({ commitSubject }) : undefined,
      });
      const body = (await res.json().catch(() => null)) as PublishDraftResponseBody;
      setStatus(statusForFetchResponse(res, body, Date.now()));
    } catch (cause) {
      setStatus({
        kind: "error",
        message: cause instanceof Error ? cause.message : "Publish failed",
      });
    }
  }

  function onPrimaryClick() {
    // Can't publish while GitHub is unreachable — the button is
    // disabled, but guard the handler too.
    if (isDegraded) return;
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

  // The modal sits on top of normal chrome while the artist is in the
  // confirm step OR while the publish API call is in flight — the
  // latter so the artist gets visual continuity (button doesn't
  // "swap" out from under them) and a clear "Publishing…" affordance
  // before the deploy-status pill takes over.
  const isModalOpen = status.kind === "confirming" || status.kind === "publishing";

  return (
    <div style={containerStyle}>
      {isModalOpen ? (
        <PublishConfirmModal
          onCancel={() => setStatus({ kind: "idle" })}
          onConfirm={fire}
          isPublishing={status.kind === "publishing"}
        />
      ) : null}
      {status.kind === "concurrent_edit" ? (
        // Reload, not republish: in-memory editor state diverges from
        // whatever the other tab just committed. Reloading re-reads
        // from disk so the artist sees the merged state before they
        // try again.
        //
        // Secondary (cancelButtonStyle) rather than primary (buttonStyle)
        // so the action reads as visually distinct from the Publish
        // button it replaces — the artist's task changed, not just the
        // label.
        //
        // Data-loss safety net: any admin surface with in-progress
        // edits is expected to mount `useBeforeUnloadIfDirty`, which
        // triggers the browser's "Leave this page?" prompt on the
        // upcoming `location.reload()`. Today's surfaces (every
        // singleton panel via `useSettingsForm`, the Puck editor)
        // satisfy that; new admin surfaces need to as well.
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={cancelButtonStyle}
        >
          Reload
        </button>
      ) : (
        <button
          type="button"
          onClick={onPrimaryClick}
          disabled={status.kind === "publishing" || status.kind === "in_flight" || isDegraded}
          title={isDegraded ? "Unavailable while GitHub is unreachable" : undefined}
          style={
            isBusy(status) || isDegraded
              ? { ...buttonStyle, ...buttonDisabledStyle }
              : buttonStyle
          }
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

/**
 * Successful `POST /api/publish-draft` shape, locked here as a
 * literal type so the `body.mode` / `body.alreadyInSync` branches in
 * `statusForFetchResponse` are checked against the actual response.
 * The route doesn't currently emit a Zod schema for the success
 * envelope; once it does, this type should consume that schema's
 * `z.infer` instead.
 */
type PublishDraftSuccessBody = {
  ok: true;
  commitSha: string | null;
  mode: string;
  alreadyInSync: boolean;
};

/**
 * Full response shape (success or failure), null if the body wasn't
 * valid JSON. Reuses `PublishErrorPayload` so a rename or addition
 * to the structured error enum fails this file at compile time.
 */
type PublishDraftResponseBody =
  | PublishDraftSuccessBody
  | PublishErrorPayload
  | null;

/**
 * Pure dispatch from a `POST /api/publish-draft` response → `Status`.
 * Extracted so the dispatch (in particular the
 * `code === "concurrent-edit"` branch) is testable without a fetch
 * mock; `fire()` is then a thin shell around it.
 *
 * Takes `now` as a parameter — the only side-effect-bearing input
 * — so tests can pass a fixed timestamp and assert on the resulting
 * `in_flight.publishedAt`.
 */
function statusForFetchResponse(
  res: Response,
  body: PublishDraftResponseBody,
  now: number,
): Status {
  if (!res.ok || !body || !body.ok) {
    // ADR-010 §6: a `concurrent-edit` code is a separate recovery
    // path from a generic publish failure — surfacing it as the
    // same red error toast would just retrain the artist to
    // re-click Publish, which would race again.
    if (body && "code" in body && body.code === "concurrent-edit") {
      return { kind: "concurrent_edit" };
    }
    const message =
      (body && "error" in body && body.error) || `Publish failed (HTTP ${res.status})`;
    return { kind: "error", message };
  }
  if (body.alreadyInSync) {
    return { kind: "noop" };
  }
  if (body.mode === "local" || body.commitSha === null) {
    // Dev fallback: no deploy to poll for; treat as immediately
    // live. The artist's local dev server already serves the
    // saved files.
    return { kind: "live" };
  }
  // Production: deploy is in flight; start polling.
  return { kind: "in_flight", publishedAt: now };
}

// Exported for direct testing — `PublishPendingChangesButton`'s
// status machine is driven by fetch responses + a polling hook, so
// SSR snapshots of the button can't reach the concurrent-edit /
// stalled / error states. Tests render `StatusLine` with a literal
// status, and exercise `statusForFetchResponse` with literal
// (Response, body) pairs.
export { StatusLine as __StatusLine, statusForFetchResponse as __statusForFetchResponse };

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
