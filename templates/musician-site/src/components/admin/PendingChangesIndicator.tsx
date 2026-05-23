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

import { fetchDraftChangesShared } from "@/lib/draft-changes-client";

type Status =
  | { kind: "loading" }
  | { kind: "pending"; count: number; truncated: boolean }
  | { kind: "clean" }
  | { kind: "hidden" };

export function PendingChangesIndicator() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    // Shared with the other chrome that reads the diff on the same page
    // load (e.g. PagesPanel's badges) so they fold into one compare
    // call. The fetcher never rejects — failures arrive as
    // `{ ok: false }`, which we hide silently (the artist's task isn't
    // the indicator). `cancelled` guards against an update after
    // unmount; we leave `loading` in place on unmount so a fast
    // re-mount during navigation doesn't flash the wrong state.
    let cancelled = false;
    void fetchDraftChangesShared().then((result) => {
      if (cancelled) return;
      if (!result.ok || result.status.mode === "local") {
        setStatus({ kind: "hidden" });
        return;
      }
      setStatus(
        result.status.count > 0
          ? {
              kind: "pending",
              count: result.status.count,
              truncated: result.status.truncated,
            }
          : { kind: "clean" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === "loading" || status.kind === "hidden") {
    return null;
  }

  if (status.kind === "pending") {
    // Render "300+" when the diff hit the compare API's hard cap
    // — we don't know the real total, only that there's at least
    // that many. The "+" prevents the artist from reading "300"
    // as an exact count.
    const countLabel = status.truncated ? `${status.count}+` : `${status.count}`;
    const nounLabel =
      !status.truncated && status.count === 1 ? "change" : "changes";
    return (
      <div style={containerStyle} role="status" aria-live="polite">
        <span style={pendingTextStyle}>
          {countLabel} unpublished {nounLabel}
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
