/**
 * Pre-action indicator in the admin sidebar.
 *
 * Sits above `PublishPendingChangesButton`. Fetches `/api/draft-changes`
 * on mount and renders one of three states:
 *
 *   - count > 0    → "N unpublished changes" (emphasised, singular for N=1)
 *   - count === 0  → "All published" (muted)
 *   - dev / unconfigured → nothing (no draft branch concept)
 *
 * Loading + fetch-error states render nothing — the indicator is
 * informational, not load-bearing. Letting it disappear silently on
 * a transient blip is better than surfacing a red error in chrome
 * the artist isn't reading.
 *
 * One-shot fetch; no polling. The state only flips on Publish /
 * Discard (which the artist initiates from this same chrome) or on
 * navigation between admin pages (which re-mounts the indicator).
 * Adding live updates for the cross-tab case is deferred — the
 * artist's other tab will reflect on its next navigation.
 */

"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

type Status =
  | { kind: "loading" }
  | { kind: "pending"; count: number }
  | { kind: "clean" }
  | { kind: "hidden" };

type DraftChangesResponseBody =
  | {
      ok: true;
      status: { count: number; mode: "local" | "github" };
    }
  | { ok: false; code?: string; error?: string }
  | null;

export function PendingChangesIndicator() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    const ac = new AbortController();
    async function load() {
      try {
        // `cache: "no-store"` so a save → navigate sequence doesn't
        // serve a stale count from the browser cache. The route
        // handler also returns `cache-control: no-store` — both
        // belts.
        //
        // `signal: ac.signal` so navigating away from the admin
        // while the request is in flight actually cancels the
        // network request (the `cancelled` flag alone would gate
        // the `setStatus` but leave the request running).
        const res = await fetch("/api/draft-changes", {
          cache: "no-store",
          signal: ac.signal,
        });
        const body = (await res.json().catch(() => null)) as DraftChangesResponseBody;
        if (ac.signal.aborted) return;
        if (!res.ok || !body || !body.ok) {
          // Don't surface fetch errors in chrome — the artist's
          // immediate task isn't the indicator. Hide silently.
          setStatus({ kind: "hidden" });
          return;
        }
        if (body.status.mode === "local") {
          setStatus({ kind: "hidden" });
          return;
        }
        setStatus(
          body.status.count > 0
            ? { kind: "pending", count: body.status.count }
            : { kind: "clean" },
        );
      } catch (cause) {
        // Aborts during teardown are expected — don't transition out
        // of `loading` so a fast re-mount (e.g., back-button nav)
        // doesn't show the wrong state momentarily.
        if (cause instanceof Error && cause.name === "AbortError") return;
        setStatus({ kind: "hidden" });
      }
    }
    void load();
    return () => ac.abort();
  }, []);

  if (status.kind === "loading" || status.kind === "hidden") {
    return null;
  }

  if (status.kind === "pending") {
    return (
      <div style={containerStyle} role="status" aria-live="polite">
        <span style={pendingTextStyle}>
          {status.count} unpublished {status.count === 1 ? "change" : "changes"}
        </span>
      </div>
    );
  }

  return (
    <div style={containerStyle} role="status" aria-live="polite">
      <span style={cleanTextStyle}>All published</span>
    </div>
  );
}

const containerStyle: CSSProperties = {
  marginBottom: "var(--space-2)",
  fontSize: "var(--font-size-xs)",
};

const pendingTextStyle: CSSProperties = {
  color: "var(--color-text-emphasis)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

const cleanTextStyle: CSSProperties = {
  color: "var(--color-text-muted)",
};
