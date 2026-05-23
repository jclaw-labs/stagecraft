/**
 * Confirm-step modal for Publish (ADR-010 §"Publish UX").
 *
 * Replaces the inline "Publish all pending changes?" copy with a
 * full-screen modal that surfaces the per-item diff so the artist
 * sees what they're about to ship before they click. The list comes
 * from `/api/draft-changes` — same endpoint the indicator polls,
 * but here we read the `changes` array (parsed + collapsed
 * server-side; see `lib/draft-changes.ts`).
 *
 * UX shape:
 *
 *   - Loading state: copy says "Loading the change list…", buttons
 *     remain functional. The artist can cancel while the fetch is
 *     in flight; the AbortController on the fetch cleans up.
 *   - Error state: copy explains the list couldn't load and notes
 *     that publishing will still commit whatever's pending. The
 *     artist isn't blocked just because the diff preview broke.
 *   - Loaded state: list of changes. Empty list ("Nothing to
 *     publish.") is theoretically reachable if the modal opens
 *     concurrently with someone else discarding draft; we surface
 *     that instead of silently shipping nothing.
 *
 * Mirrors the modal pattern in `PagesPanel.tsx` (click backdrop to
 * cancel, escape closes when not publishing, focus capture +
 * restore on mount / unmount).
 *
 * **Commit-message override** (ADR-010 §3): the modal shows a
 * pre-filled subject input so the artist can edit the auto-
 * generated "Publish N changes" message before committing. The
 * `onConfirm` callback receives the trimmed subject (or `null` if
 * cleared) so the button layer can include it in the publish-draft
 * request body — the route's `requestSchema` already accepts an
 * optional `commitSubject`.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { DraftChange } from "@/lib/draft-changes";
import { MAX_COMMIT_SUBJECT_LENGTH } from "@/lib/publish-types";

// Match `PagesPanel.tsx`'s modal pattern: capture the
// previously-focused element on mount, focus the primary action
// inside the modal, restore focus on unmount. Without this, keyboard
// / screen-reader users land in the page chrome on close instead of
// back on the Publish trigger button they came from.

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; changes: DraftChange[]; truncated: boolean }
  | { kind: "error" };

type ResponseBody =
  | {
      ok: true;
      status: {
        count: number;
        changes: DraftChange[];
        mode: "local" | "github";
        truncated?: boolean;
      };
    }
  | { ok: false; code?: string; error?: string }
  | null;

export function PublishConfirmModal({
  onCancel,
  onConfirm,
  isPublishing,
}: {
  onCancel: () => void;
  onConfirm: (commitSubject: string | null) => void;
  isPublishing: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [subject, setSubject] = useState<string>("");
  // Tracks whether the artist has touched the input. Until they do,
  // the loaded-changes effect keeps the field synced to the
  // auto-generated default — so the count reflects late-arriving
  // data. Once they edit, we stop overwriting.
  const [subjectTouched, setSubjectTouched] = useState<boolean>(false);
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    async function load() {
      try {
        const res = await fetch("/api/draft-changes", {
          cache: "no-store",
          signal: ac.signal,
        });
        const body = (await res.json().catch(() => null)) as ResponseBody;
        if (ac.signal.aborted) return;
        if (!res.ok || !body || !body.ok) {
          setState({ kind: "error" });
          return;
        }
        setState({
          kind: "loaded",
          changes: body.status.changes,
          truncated: body.status.truncated ?? false,
        });
      } catch (cause) {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setState({ kind: "error" });
      }
    }
    void load();
    return () => ac.abort();
  }, []);

  // Sync the auto-generated default into the subject field whenever
  // changes load, as long as the artist hasn't typed in it yet.
  // Won't overwrite a user-edited value.
  useEffect(() => {
    if (state.kind !== "loaded" || subjectTouched) return;
    setSubject(defaultSubject(state.changes.length));
  }, [state, subjectTouched]);

  // Focus capture / restore. Runs once on mount + once on unmount;
  // intentionally has no deps so the cleanup fires only when the
  // modal actually closes.
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    publishButtonRef.current?.focus();
    return () => {
      triggerRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPublishing) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPublishing, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
      onClick={isPublishing ? undefined : onCancel}
      style={backdropStyle}
    >
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <h2 id="publish-modal-title" style={titleStyle}>
          Publish pending changes
        </h2>
        <p style={subtitleStyle}>
          Publishing commits everything below to your live site and triggers a
          deploy.
        </p>
        <Body state={state} />
        <div style={labelStyle}>
          {/* Explicit `htmlFor` association (vs the previous label-
              wrapping pattern) so the counter span next to the label
              text doesn't leak into the input's accessible name. */}
          <div style={labelRowStyle}>
            <div style={labelLeftGroupStyle}>
              <label htmlFor="publish-commit-subject" style={labelTextStyle}>
                Commit message
              </label>
              {/* "Reset" surfaces only when the artist has drifted off
                  the auto-generated default — clicking it re-seeds the
                  input. Without it the recovery is "close the modal +
                  re-open"; this is a faster path for an accidental
                  clear or "I changed my mind." */}
              {state.kind === "loaded" &&
              subject !== defaultSubject(state.changes.length) ? (
                <button
                  type="button"
                  onClick={() => {
                    setSubject(defaultSubject(state.changes.length));
                    setSubjectTouched(false);
                  }}
                  disabled={isPublishing}
                  style={resetButtonStyle}
                >
                  Reset
                </button>
              ) : null}
            </div>
            {/* Counter is `aria-hidden` because user agents already
                announce remaining `maxLength` via the input's
                attribute; surfacing "N / 200" verbally on every
                keypress would be noisy. The visible count is for
                sighted users tracking proximity to the cap. */}
            <span
              aria-hidden="true"
              style={counterStyleFor(subject.length, MAX_COMMIT_SUBJECT_LENGTH)}
            >
              {`${subject.length} / ${MAX_COMMIT_SUBJECT_LENGTH}`}
            </span>
          </div>
          <input
            id="publish-commit-subject"
            type="text"
            value={subject}
            maxLength={MAX_COMMIT_SUBJECT_LENGTH}
            placeholder="Publish pending changes"
            disabled={isPublishing}
            onChange={(e) => {
              setSubject(e.target.value);
              setSubjectTouched(true);
            }}
            style={inputStyle}
          />
        </div>
        <div style={buttonRowStyle}>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPublishing}
            style={cancelButtonStyle}
          >
            Cancel
          </button>
          <button
            ref={publishButtonRef}
            type="button"
            onClick={() => {
              const trimmed = subject.trim();
              onConfirm(trimmed.length === 0 ? null : trimmed);
            }}
            disabled={isPublishing}
            style={primaryButtonStyle}
          >
            {isPublishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Body({ state }: { state: LoadState }): ReactNode {
  if (state.kind === "loading") {
    return <p style={mutedCopyStyle}>Loading the change list…</p>;
  }
  if (state.kind === "error") {
    return (
      <p style={mutedCopyStyle}>
        Couldn&apos;t load the change list. Publishing will still commit
        whatever&apos;s pending on draft.
      </p>
    );
  }
  if (state.changes.length === 0) {
    return <p style={mutedCopyStyle}>Nothing to publish.</p>;
  }
  const groups = groupChanges(state.changes);
  return (
    <div style={groupsContainerStyle}>
      {/* Heads-up when the compare API truncated the file list. The
          publish flow still commits the full draft tree — the cap
          only affects what we can show, not what we push. */}
      {state.truncated ? (
        <p style={truncatedNoticeStyle} role="status">
          Showing the first {state.changes.length} changes. Publishing
          commits everything pending.
        </p>
      ) : null}
      {groups.map((group) => (
        <section key={group.key} style={groupSectionStyle}>
          <h3 style={groupHeadingStyle}>
            {`${group.heading} · ${group.items.length}`}
          </h3>
          <ul style={listStyle}>
            {group.items.map((c) => (
              <li key={changeKey(c)} style={listItemStyle}>
                <ChangeRow change={c} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Bucket parsed `DraftChange[]`s by their owning collection (or
 * `contentSlug` for images, "Other" for `kind: "other"` paths), with
 * groups sorted alphabetically and the catch-all `Other` group
 * always last. Within a group, items keep their compare-API order.
 *
 * Exported for tests so the grouping logic is verifiable without
 * driving the full modal render.
 */
export function groupChanges(
  changes: DraftChange[],
): Array<{ key: string; heading: string; items: DraftChange[] }> {
  const OTHER = "__other__";
  const buckets = new Map<string, DraftChange[]>();
  for (const c of changes) {
    const key = collectionOf(c) ?? OTHER;
    const existing = buckets.get(key);
    if (existing) {
      existing.push(c);
    } else {
      buckets.set(key, [c]);
    }
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === OTHER) return 1;
    if (b === OTHER) return -1;
    return a.localeCompare(b);
  });
  return keys.map((key) => ({
    key,
    heading: key === OTHER ? "Other" : key,
    items: buckets.get(key)!,
  }));
}

function collectionOf(c: DraftChange): string | null {
  switch (c.kind) {
    case "item":
    case "singleton":
    case "def":
    case "order":
      return c.collectionSlug;
    case "image":
      return c.contentSlug;
    case "other":
      return null;
  }
}

function ChangeRow({ change }: { change: DraftChange }): ReactNode {
  return (
    <>
      <span style={changeLabelStyle}>{describeLabel(change)}</span>
      <span style={changeStatusStyle}>{change.status}</span>
    </>
  );
}

/**
 * Auto-generated subject seeded into the message input on first
 * load. Matches the cardinal-aware phrasing the indicator uses so
 * the artist sees the same wording in both places. The input is
 * editable; if the artist clears it, `onConfirm` passes `null` and
 * the route falls back to its own "Publish pending changes"
 * default.
 */
function defaultSubject(count: number): string {
  if (count === 0) return "Publish pending changes";
  if (count === 1) return "Publish 1 change";
  return `Publish ${count} changes`;
}

function describeLabel(c: DraftChange): string {
  switch (c.kind) {
    case "item": {
      // For renames we surface the source — slug, collection, or both
      // — so the artist can confirm the change is the one they meant.
      // Cross-collection renames always render the arrow (even when
      // the slug didn't move) because the move itself is the change.
      // Same-collection renames only render the arrow when the slug
      // actually changed; otherwise GitHub flagged a content-mode
      // shift as renamed and the arrow would be a spurious cue.
      const sameSlug = c.previousItemSlug === c.itemSlug;
      const crossCollection = c.previousCollectionSlug !== undefined;
      if (crossCollection) {
        const prevSlug = c.previousItemSlug ?? c.itemSlug;
        return `${c.previousCollectionSlug} · ${prevSlug} → ${c.collectionSlug} · ${c.itemSlug}`;
      }
      if (c.previousItemSlug && !sameSlug) {
        return `${c.collectionSlug} · ${c.previousItemSlug} → ${c.itemSlug}`;
      }
      return `${c.collectionSlug} · ${c.itemSlug}`;
    }
    case "singleton":
      return `${c.collectionSlug}`;
    case "def":
      return `${c.collectionSlug} · schema`;
    case "order":
      return `${c.collectionSlug} · item order`;
    case "image":
      return `Image · ${c.imageId}`;
    case "other":
      return c.path;
  }
}

function changeKey(c: DraftChange): string {
  // Stable per-change identity for React's key prop. The path is
  // unique within one diff (one file = one entry, image collapse
  // notwithstanding — which keeps the original.* path).
  return c.kind === "image" ? `image:${c.contentSlug}/${c.imageId}` : c.path;
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--color-overlay)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const modalStyle: CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  padding: "var(--space-6)",
  width: "min(32rem, calc(100% - var(--space-8)))",
  maxHeight: "calc(100vh - var(--space-8))",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-lg)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
};

const mutedCopyStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
};

const truncatedNoticeStyle: CSSProperties = {
  margin: 0,
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-emphasis)",
  background: "var(--color-surface-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
};

const groupsContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
  overflowY: "auto",
  minHeight: 0,
};

const groupSectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const groupHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const listItemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "var(--space-3)",
  padding: "var(--space-2) var(--space-3)",
  background: "var(--color-surface-subtle)",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--font-size-sm)",
};

const changeLabelStyle: CSSProperties = {
  color: "var(--color-text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const changeStatusStyle: CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-xs)",
  textTransform: "lowercase",
  flexShrink: 0,
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const labelRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "var(--space-2)",
};

const labelLeftGroupStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-2)",
};

const resetButtonStyle: CSSProperties = {
  padding: 0,
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
  background: "none",
  border: "none",
  textDecoration: "underline",
  cursor: "pointer",
  textAlign: "left",
};

const labelTextStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

/**
 * Counter colour ramp: muted at all values below 90% of the cap,
 * emphasised text from 90% up, error-coloured at the cap so the
 * artist sees why the input has stopped accepting characters.
 *
 * Thresholds are inclusive: 180 chars at max=200 is "near", 200 is
 * "at". Below 180 stays default-muted so the counter is unobtrusive
 * during normal use.
 */
function counterStyleFor(length: number, max: number): CSSProperties {
  if (length >= max) return atLimitCounterStyle;
  if (length >= Math.floor(max * 0.9)) return nearLimitCounterStyle;
  return counterStyle;
}

const counterStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
  fontVariantNumeric: "tabular-nums",
};

const nearLimitCounterStyle: CSSProperties = {
  ...counterStyle,
  color: "var(--color-text-emphasis)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

const atLimitCounterStyle: CSSProperties = {
  ...counterStyle,
  color: "var(--color-text-error)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

const inputStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  borderRadius: "var(--radius-sm)",
  width: "100%",
  boxSizing: "border-box",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  justifyContent: "flex-end",
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

const primaryButtonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  border: "1px solid transparent",
  background: "var(--color-action)",
  color: "var(--color-action-fg)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
};
