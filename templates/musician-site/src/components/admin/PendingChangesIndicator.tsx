/**
 * Pre-action indicator in the admin sidebar.
 *
 * Sits above `PublishPendingChangesButton`. Fetches `/api/draft-status`
 * on mount and renders one of three states:
 *
 *   - hasPending=true   → "Unpublished changes" (emphasised)
 *   - hasPending=false  → "All published" (muted)
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
  | { kind: "pending" }
  | { kind: "clean" }
  | { kind: "hidden" };

type DraftStatusResponseBody =
  | {
      ok: true;
      status: { hasPending: boolean; mode: "local" | "github" };
    }
  | { ok: false; code?: string; error?: string }
  | null;

export function PendingChangesIndicator() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // `cache: "no-store"` so a save → navigate sequence doesn't
        // serve a stale "All published" from the browser cache. The
        // route handler itself returns dynamic JSON without
        // cache-control headers, but default browser caching of GET
        // responses can still bite.
        const res = await fetch("/api/draft-status", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as DraftStatusResponseBody;
        if (cancelled) return;
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
        setStatus({ kind: body.status.hasPending ? "pending" : "clean" });
      } catch {
        if (cancelled) return;
        setStatus({ kind: "hidden" });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === "loading" || status.kind === "hidden") {
    return null;
  }

  if (status.kind === "pending") {
    return (
      <div style={containerStyle} role="status" aria-live="polite">
        <span style={pendingTextStyle}>Unpublished changes</span>
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
