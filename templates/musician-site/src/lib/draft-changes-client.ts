/**
 * Client-side coalescing for `GET /api/draft-changes`.
 *
 * Several admin-chrome components read the draft diff on the same page
 * load: the sidebar `PendingChangesIndicator` (on every admin page)
 * and the per-row "Unpublished" badges in `PagesPanel`. They mount in
 * the same render pass and want the identical answer, yet each used to
 * fire its own fetch — and so its own GitHub `compare` call.
 *
 * `fetchDraftChangesShared` collapses that: the first caller starts the
 * request; anyone who asks while it's still in flight gets the same
 * promise. The shared promise is dropped the instant it settles, so the
 * NEXT read — a later navigation, or the Publish modal opening after the
 * page has settled — fetches fresh. That's deliberate: the route handler
 * and the components use `no-store` precisely so a save → navigate
 * sequence reflects immediately, and a lingering result cache would
 * reintroduce the staleness they avoid. We only fold together the
 * simultaneous burst; we never serve a settled result.
 *
 * Not abortable per-caller. A shared request can't be cancelled by one
 * component unmounting without breaking the others, so callers guard
 * their own state updates against unmount (a `cancelled` flag) instead.
 * If every caller has left by the time it resolves, the result is simply
 * discarded.
 *
 * Never rejects: network / auth / broker failures come back as
 * `{ ok: false }` so callers degrade to a hidden / unbadged state
 * without a try/catch of their own.
 */

import { type DraftChange } from "./draft-changes";

export type DraftChangesSnapshot = {
  count: number;
  changes: DraftChange[];
  mode: "local" | "github";
  truncated: boolean;
};

export type DraftChangesResult =
  | { ok: true; status: DraftChangesSnapshot }
  | { ok: false };

type ResponseBody =
  | {
      ok: true;
      status: {
        count: number;
        changes?: DraftChange[];
        mode: "local" | "github";
        truncated?: boolean;
      };
    }
  | { ok: false; code?: string; error?: string }
  | null;

let inFlight: Promise<DraftChangesResult> | null = null;

async function requestDraftChanges(url: string): Promise<DraftChangesResult> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as ResponseBody;
    if (!res.ok || !body || !body.ok) return { ok: false };
    return {
      ok: true,
      status: {
        count: body.status.count,
        changes: body.status.changes ?? [],
        mode: body.status.mode,
        truncated: body.status.truncated ?? false,
      },
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Read the draft-vs-main diff, sharing one in-flight request with any
 * other caller that asks before it resolves. Used by the lightweight
 * chrome (sidebar indicator + per-row badges).
 */
export function fetchDraftChangesShared(): Promise<DraftChangesResult> {
  if (inFlight) return inFlight;
  const promise = requestDraftChanges("/api/draft-changes").finally(() => {
    // Drop as soon as it settles so the next read is fresh. Guard
    // against clobbering a newer request that started in the meantime.
    if (inFlight === promise) inFlight = null;
  });
  inFlight = promise;
  return promise;
}

/**
 * Read the diff with human-facing item labels resolved server-side
 * (`?labels=1`). For the Publish modal, which shows item names rather
 * than slugs. Not coalesced with `fetchDraftChangesShared` — it's a
 * heavier, different read (per-item store reads) with a single caller
 * (one open modal), and the artist wants current state before
 * publishing anyway.
 */
export function fetchDraftChangesWithLabels(): Promise<DraftChangesResult> {
  return requestDraftChanges("/api/draft-changes?labels=1");
}

/** Test seam: forget any in-flight reference so cases don't bleed. */
export function __resetDraftChangesClientForTests(): void {
  inFlight = null;
}
