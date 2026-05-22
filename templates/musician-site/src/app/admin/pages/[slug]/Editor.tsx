"use client";

import { Puck, usePuck } from "@measured/puck";
import "@measured/puck/puck.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AdminAccountButton } from "@/components/admin/AdminAccountButton";
import { useBeforeUnloadIfDirty } from "@/components/admin/useBeforeUnloadIfDirty";
import { BLOCK_DESCRIPTIONS, puckConfig } from "@/puck/config";
import { DrawerItemPreview } from "@/puck/DrawerItemPreview";
import type { PageData } from "@/lib/content";

import {
  computeCategoryVisibility,
  isVisibilityDispatchTrivial,
} from "./drawer-visibility";

type Props = {
  initialData: PageData;
  pageSlug: string;
  email: string;
};

/**
 * Save lifecycle for the page editor (ADR-010 PR 3):
 *
 *   idle → publishing → saved
 *                    ↘ error(message)
 *
 * "publishing" = the /api/publish round-trip (broker → draft commit).
 * "saved"      = saved to the `draft` branch. The deploy doesn't
 *                fire from here; the artist hits "Publish changes" in
 *                the AdminShell to promote draft → main, at which
 *                point the deploy status surfaces in the sidebar
 *                button via `useDeployStatus`.
 *
 * No deploy polling on this path — the page editor's save is purely
 * to draft, and `useDeployStatus` lives in the sidebar Publish
 * button where the deploy actually fires.
 */
type PublishState =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "saved" }
  | { status: "error"; message: string };

export function Editor({ initialData, pageSlug, email }: Props) {
  const [publishState, setPublishState] = useState<PublishState>({ status: "idle" });
  // Puck doesn't surface dirty state to wrappers; track it ourselves
  // via onChange. Reset on successful publish (the saved data becomes
  // the new baseline).
  const [isDirty, setIsDirty] = useState(false);
  useBeforeUnloadIfDirty(isDirty);
  // Drawer block filter — typed into the search box above the
  // component list. Trimmed + lowercased before compare.
  const [drawerFilter, setDrawerFilter] = useState("");

  const onPublish = useCallback(
    async (data: PageData) => {
      setPublishState({ status: "publishing" });
      try {
        const res = await fetch("/api/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pageSlug, data }),
        });
        const body = (await res.json().catch(() => null)) as
          | { ok: true; commitSha: string | null }
          | { ok: false; error?: string }
          | null;
        if (!res.ok) {
          const message =
            (body && "error" in body && body.error) ||
            `Publish failed (HTTP ${res.status})`;
          setPublishState({ status: "error", message });
          throw new Error(message);
        }
        // Post-ADR-010 PR 3: /api/publish saves to the draft branch
        // without triggering a deploy. The artist explicitly hits
        // Publish (in the AdminShell) to promote draft → main, which
        // is when the deploy fires. No polling here — there's no
        // deploy in flight from this save. Indicate "Saved" via the
        // pill regardless of dev vs prod (both paths persisted the
        // change; only the storage layer differs).
        setPublishState({ status: "saved" });
        setIsDirty(false);
      } catch (cause) {
        setPublishState((current) =>
          current.status === "error"
            ? current
            : {
                status: "error",
                message: cause instanceof Error ? cause.message : "Publish failed",
              },
        );
      }
    },
    [pageSlug],
  );

  return (
    <Puck
      config={puckConfig}
      data={initialData}
      onPublish={onPublish}
      onChange={() => setIsDirty(true)}
      overrides={{
        drawer: ({ children }) => {
          const q = drawerFilter.trim().toLowerCase();
          const hasMatch =
            !q ||
            Object.keys(puckConfig.components).some((name) =>
              name.toLowerCase().includes(q),
            );
          return (
            <>
              <DrawerCategoryVisibilitySync filter={drawerFilter} />
              <DrawerSearchInput
                value={drawerFilter}
                onChange={setDrawerFilter}
              />
              {q && !hasMatch ? (
                <p
                  role="status"
                  style={{
                    margin: "0 0 var(--space-3) 0",
                    color: "var(--color-text-muted)",
                    fontSize: "var(--font-size-sm)",
                    fontStyle: "italic",
                  }}
                >
                  No matching blocks.
                </p>
              ) : null}
              {children}
            </>
          );
        },
        drawerItem: ({ name, children }) => {
          const q = drawerFilter.trim().toLowerCase();
          if (q && !name.toLowerCase().includes(q)) {
            // Render but hide so Puck's drag machinery keeps its DOM
            // references; removing items outright can confuse the
            // drawer-list virtualisation. `inert` keeps keyboard
            // focus out of the hidden item (a tabbable drag handle
            // would otherwise still be reachable).
            return (
              <div style={{ display: "none" }} aria-hidden inert>
                {children}
              </div>
            );
          }
          return <DrawerItemPreview name={name}>{children}</DrawerItemPreview>;
        },
        fields: ({ children, itemSelector }) => (
          <>
            {itemSelector ? <BlockHelp /> : null}
            {children}
          </>
        ),
        headerActions: ({ children }) => (
          <>
            <Link
              href="/admin/pages"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
                padding: "var(--space-1) var(--space-3)",
                fontSize: "var(--font-size-xs)",
                fontWeight: "var(--font-weight-semibold)" as unknown as number,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                textDecoration: "none",
              }}
              title="Back to pages list"
            >
              ← Pages
            </Link>
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-mono)",
              }}
              title="Page slug"
            >
              /{pageSlug}
            </span>
            <PublishStatusPill state={publishState} />
            {children}
            <AdminAccountButton email={email} />
          </>
        ),
      }}
    />
  );
}

function PublishStatusPill({ state }: { state: PublishState }) {
  const base = {
    display: "inline-flex" as const,
    alignItems: "center",
    gap: "var(--space-1)",
    padding: "var(--space-1) var(--space-2)",
    fontSize: "var(--font-size-xs)",
    fontWeight: "var(--font-weight-semibold)" as unknown as number,
    borderRadius: "var(--radius-sm)",
    whiteSpace: "nowrap" as const,
  };

  switch (state.status) {
    case "idle":
      return null;
    case "publishing":
      return (
        <span
          role="status"
          style={{
            ...base,
            background: "var(--color-surface-raised)",
            color: "var(--color-text-muted)",
          }}
        >
          <Spinner /> Saving…
        </span>
      );
    case "saved":
      return (
        <span
          role="status"
          style={{
            ...base,
            background: "var(--color-surface-raised)",
            color: "var(--color-text)",
          }}
          title="Saved to draft. Hit Publish in the sidebar to push live."
        >
          <Dot /> Saved
        </span>
      );
    case "error":
      return (
        <span
          role="alert"
          style={{
            ...base,
            background: "var(--color-surface-raised)",
            color: "var(--color-text-error)",
          }}
          title={state.message}
        >
          Save failed
        </span>
      );
  }
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "0.625rem",
        height: "0.625rem",
        border: "2px solid var(--color-border-strong)",
        borderTopColor: "var(--color-text-muted)",
        borderRadius: "50%",
        animation: "stagecraftSpin 0.8s linear infinite",
      }}
    />
  );
}

function Dot() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "0.5rem",
        height: "0.5rem",
        borderRadius: "50%",
        background: "var(--color-action)",
      }}
    />
  );
}

/**
 * Hide drawer category headers whose components are all filtered
 * out by the active search. Puck reads category visibility from
 * `state.ui.componentList`, not from the live `config` prop, so a
 * memoised config doesn't work — we have to dispatch `setUi`.
 *
 * Renders nothing; effect-only. Lives inside the `drawer` override
 * so it has Puck context (`usePuck`).
 *
 * Three subtleties:
 *
 * - The dispatch uses the functional form so it can read the
 *   previous entry per category and preserve `expanded` (the
 *   artist's manual collapse state). Replacing the whole entry
 *   would wipe `expanded` on every keystroke. Logic lives in the
 *   pure `computeCategoryVisibility` helper next to this file.
 * - `recordHistory: false` keeps these dispatches out of Puck's
 *   undo stack. Without it, every filter keystroke adds an undo
 *   entry — Ctrl-Z would walk back through the filter's
 *   visibility flips before reaching the artist's actual content
 *   edits.
 * - On initial mount with an empty filter, the computed result
 *   matches Puck's default initialisation (all categories
 *   visible) so the dispatch is a state-equivalent no-op. The
 *   ref-based short-circuit skips that one dispatch per drawer
 *   mount. Once the artist has typed at least once
 *   (`hasDispatchedRef.current` flips true), every empty-filter
 *   case dispatches normally — that's when categories were just
 *   hidden by a filter and need to come back to visible.
 */
function DrawerCategoryVisibilitySync({ filter }: { filter: string }) {
  const { dispatch } = usePuck();
  const hasDispatchedRef = useRef(false);
  useEffect(() => {
    // Initial mount with empty filter: every category is visible
    // by default in Puck's reducer. Dispatching the same state would
    // round-trip for nothing. After the artist has typed at least
    // once (`hasDispatchedRef.current` flips true), every dispatch
    // matters — even an empty-filter one, because it has to restore
    // visibility for categories the previous filter hid.
    const isInitialMountNoOp =
      isVisibilityDispatchTrivial(filter) && !hasDispatchedRef.current;
    if (isInitialMountNoOp) return;
    hasDispatchedRef.current = true;
    dispatch({
      type: "setUi",
      recordHistory: false,
      ui: (previous) => ({
        componentList: computeCategoryVisibility(
          filter,
          puckConfig.categories ?? {},
          previous.componentList,
        ),
      }),
    });
  }, [filter, dispatch]);
  return null;
}

/**
 * Search-style input shown at the top of the component drawer. Lifted
 * into its own component so its identity is stable across Editor
 * re-renders — Puck re-creates the `overrides` object whenever its
 * parent updates, and pulling this out of the inline override keeps
 * the input from being reconciled away (which would lose focus
 * mid-keystroke).
 */
function DrawerSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && value) {
          // Don't let the keystroke bubble to Puck's editor — it can
          // catch Escape for "deselect block" or similar shortcuts.
          e.stopPropagation();
          onChange("");
        }
      }}
      placeholder="Filter blocks…"
      aria-label="Filter blocks"
      style={{
        width: "100%",
        margin: "0 0 var(--space-3) 0",
        padding: "var(--space-2) var(--space-3)",
        fontSize: "var(--font-size-sm)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface)",
        color: "var(--color-text)",
      }}
    />
  );
}

/**
 * One-line description of the selected block, surfaced above the
 * inspector's field controls. Reads `selectedItem` from `usePuck` —
 * `itemSelector` from the override args only tells us *that*
 * something is selected, not what type. When nothing is selected
 * (root focus or a stale selector), this renders nothing.
 */
function BlockHelp() {
  const { selectedItem } = usePuck();
  if (!selectedItem) return null;
  const description =
    BLOCK_DESCRIPTIONS[selectedItem.type as keyof typeof BLOCK_DESCRIPTIONS];
  if (!description) return null;
  return (
    <p
      role="note"
      style={{
        margin: "0 0 var(--space-4) 0",
        color: "var(--color-text-muted)",
        fontSize: "var(--font-size-sm)",
        lineHeight: "var(--line-height-base)",
        fontStyle: "italic",
      }}
    >
      {description}
    </p>
  );
}

