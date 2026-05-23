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
import { changeKey } from "@/lib/draft-changes-keys";
import { fetchDraftChangesWithLabels } from "@/lib/draft-changes-client";
import {
  MAX_COMMIT_MESSAGE_LENGTH,
  MAX_COMMIT_SUBJECT_LENGTH,
} from "@/lib/publish-types";

/**
 * What the artist chose to publish (ADR-012). `allSelected` lets the
 * button take the cheaper whole-draft squash (`/api/publish-draft`)
 * when nothing is deselected, and the per-item path
 * (`/api/publish-selected`) only for a genuine subset.
 */
export type PublishSelection = { selectedKeys: string[]; allSelected: boolean };

// Match `PagesPanel.tsx`'s modal pattern: capture the
// previously-focused element on mount, focus the primary action
// inside the modal, restore focus on unmount. Without this, keyboard
// / screen-reader users land in the page chrome on close instead of
// back on the Publish trigger button they came from.

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; changes: DraftChange[]; truncated: boolean }
  | { kind: "error" };

export function PublishConfirmModal({
  onCancel,
  onConfirm,
  isPublishing,
}: {
  onCancel: () => void;
  onConfirm: (commitSubject: string | null, selection: PublishSelection) => void;
  isPublishing: boolean;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [subject, setSubject] = useState<string>("");
  // Which changes are ticked for publishing (ADR-012), keyed by the
  // canonical `changeKey`. Seeded to "all" once the list loads (the
  // default is publish-everything); the artist unticks to hold items.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Tracks whether the artist has touched the input. Until they do,
  // the loaded-changes effect keeps the field synced to the
  // auto-generated default — so the count reflects late-arriving
  // data. Once they edit, we stop overwriting.
  const [subjectTouched, setSubjectTouched] = useState<boolean>(false);
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Labeled read (`?labels=1`) so the change list shows item display
    // names ("About Us") rather than slugs — it costs a per-item store
    // read server-side, which the lightweight chrome reads skip. Never
    // rejects: failures surface as `{ ok: false }` → the error state.
    // `cancelled` guards a late resolve after the artist closes the modal.
    let cancelled = false;
    void fetchDraftChangesWithLabels().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({ kind: "error" });
        return;
      }
      setState({
        kind: "loaded",
        changes: result.status.changes,
        truncated: result.status.truncated,
      });
      // Seed the selection to "all" in the same batched update as the
      // loaded state, so the first loaded render already shows every box
      // ticked (no one-frame "0 of N" flicker from a post-commit effect).
      setSelected(new Set(result.status.changes.map(changeKey)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync the auto-generated default into the subject field whenever
  // changes load, as long as the artist hasn't typed in it yet.
  // Won't overwrite a user-edited value.
  // Keep the auto-generated subject in sync with what's actually ticked
  // (the selected count, or the total when per-item selection doesn't
  // apply) until the artist edits the field — so a subset publish commits
  // an accurate "Publish N changes" message, not the full pending count.
  useEffect(() => {
    if (state.kind !== "loaded" || subjectTouched) return;
    const selectable = state.changes.length > 0 && !state.truncated;
    const count = selectable
      ? state.changes.filter((c) => selected.has(changeKey(c))).length
      : state.changes.length;
    setSubject(defaultSubject(count));
  }, [state, subjectTouched, selected]);

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

  const totalChanges = state.kind === "loaded" ? state.changes.length : 0;
  // Per-item selection only applies to a fully-loaded, non-truncated
  // list; loading / error / truncated states fall back to "publish
  // everything pending" (the server refuses a selective publish on a
  // truncated diff, since an image's variants could be split — ADR-012).
  const canSelect = state.kind === "loaded" && totalChanges > 0 && !state.truncated;
  // Count + collect only LOADED keys that are ticked. Basing the math on
  // this (not `selected.size`) keeps it correct even if `selected` ever
  // held a key not in the current list — a size-equality shortcut could
  // otherwise route a desynced selection to the full squash.
  const selectedLoadedKeys =
    state.kind === "loaded"
      ? state.changes.map(changeKey).filter((k) => selected.has(k))
      : [];
  const selectedCount = selectedLoadedKeys.length;
  const allSelected = canSelect && selectedCount === totalChanges;
  const nothingSelected = canSelect && selectedCount === 0;

  function toggleOne(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (state.kind !== "loaded") return;
    setSelected((prev) =>
      prev.size === state.changes.length ? new Set() : new Set(state.changes.map(changeKey)),
    );
  }

  function confirm() {
    const trimmed = subject.trim();
    const commitSubject = trimmed.length === 0 ? null : trimmed;
    const selection: PublishSelection = canSelect
      ? { selectedKeys: selectedLoadedKeys, allSelected }
      : // Couldn't show a list — publish whatever's pending (full draft).
        { selectedKeys: [], allSelected: true };
    onConfirm(commitSubject, selection);
  }

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
        <Body
          state={state}
          selected={selected}
          allSelected={allSelected}
          onToggle={toggleOne}
          onToggleAll={toggleAll}
        />
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
                keypress would be noisy. The visible count tracks
                the *first line* (git's subject), since the artist
                ramp + body convention only cares about the subject
                length — long bodies are fine, long subject lines
                aren't. Total message length is capped separately by
                `MAX_COMMIT_MESSAGE_LENGTH` on the textarea + route. */}
            <span
              aria-hidden="true"
              style={counterStyleFor(subjectLineLength(subject), MAX_COMMIT_SUBJECT_LENGTH)}
            >
              {`${subjectLineLength(subject)} / ${MAX_COMMIT_SUBJECT_LENGTH}`}
            </span>
          </div>
          <textarea
            id="publish-commit-subject"
            value={subject}
            maxLength={MAX_COMMIT_MESSAGE_LENGTH}
            placeholder="Publish pending changes"
            disabled={isPublishing}
            rows={3}
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
            onClick={confirm}
            disabled={isPublishing || nothingSelected}
            title={nothingSelected ? "Select at least one change to publish" : undefined}
            style={
              isPublishing || nothingSelected
                ? { ...primaryButtonStyle, ...primaryButtonDisabledStyle }
                : primaryButtonStyle
            }
          >
            {publishLabel(isPublishing, canSelect, selectedCount, totalChanges)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Body({
  state,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
}: {
  state: LoadState;
  selected: Set<string>;
  allSelected: boolean;
  onToggle: (key: string) => void;
  onToggleAll: () => void;
}): ReactNode {
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
  // A truncated diff can't be published item-by-item (an image's
  // variants could straddle the cap), so the list goes read-only and
  // Publish commits everything pending (ADR-012).
  const selectable = !state.truncated;
  return (
    <div style={groupsContainerStyle}>
      {state.truncated ? (
        <p style={truncatedNoticeStyle} role="status">
          Showing the first {state.changes.length} changes — too many to
          publish item-by-item. Publish commits everything pending.
        </p>
      ) : (
        <label style={selectAllRowStyle}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && selected.size > 0;
            }}
            onChange={onToggleAll}
          />
          <span>Select all</span>
        </label>
      )}
      {groups.map((group) => (
        <section key={group.key} style={groupSectionStyle}>
          <h3 style={groupHeadingStyle}>
            {`${group.heading} · ${group.items.length}`}
          </h3>
          <ul style={listStyle}>
            {group.items.map((c) => {
              const key = changeKey(c);
              const label = describeLabel(c);
              return (
                <li key={key} style={listItemStyle}>
                  {selectable ? (
                    <label style={changeRowLabelStyle}>
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => onToggle(key)}
                        aria-label={label}
                      />
                      <span style={changeLabelStyle}>{label}</span>
                    </label>
                  ) : (
                    <span style={changeLabelStyle}>{label}</span>
                  )}
                  <span style={changeStatusStyle}>{c.status}</span>
                </li>
              );
            })}
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

/**
 * Publish button label that reflects the selection (ADR-012): a count
 * of what's about to ship when a subset is selectable, plain "Publish"
 * otherwise (loading / error / truncated all publish everything).
 */
function publishLabel(
  isPublishing: boolean,
  canSelect: boolean,
  selectedCount: number,
  total: number,
): string {
  if (isPublishing) return "Publishing…";
  if (!canSelect) return "Publish";
  if (selectedCount === total) return total === 1 ? "Publish 1 change" : `Publish all ${total}`;
  return `Publish ${selectedCount} of ${total}`;
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
      // Plain edit / add: prefer the artist's display name ("About Us")
      // over the slug ("about") when the labeled read resolved one.
      // Renames keep slugs above — the slug move is the point there.
      return `${c.collectionSlug} · ${c.displayName ?? c.itemSlug}`;
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

const selectAllRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  cursor: "pointer",
};

const changeRowLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-2)",
  flex: 1,
  minWidth: 0,
  cursor: "pointer",
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
/**
 * Length of the first line of the commit message — what git
 * stores as the "subject" and what tooling shows in `git log
 * --oneline`. The counter ramp tracks this rather than the whole
 * message because a long body is fine; a long subject is the
 * thing that gets truncated by code-review surfaces.
 */
function subjectLineLength(message: string): number {
  const newline = message.indexOf("\n");
  return newline === -1 ? message.length : newline;
}

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
  // `inherit` so the textarea picks up the modal's body font
  // rather than the user-agent monospace default. Multi-line
  // commit messages read better in the same family as the rest of
  // the modal copy.
  fontFamily: "inherit",
  lineHeight: "var(--line-height-base)",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  borderRadius: "var(--radius-sm)",
  width: "100%",
  boxSizing: "border-box",
  // Vertical-only resize keeps the modal's column layout intact —
  // a horizontally-stretched textarea would push past the modal
  // chrome.
  resize: "vertical",
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

const primaryButtonDisabledStyle: CSSProperties = {
  background: "var(--color-action-disabled)",
  cursor: "not-allowed",
};
