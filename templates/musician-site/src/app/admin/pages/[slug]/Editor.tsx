"use client";

import { createUsePuck, Puck } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import Link from "next/link";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AdminAccountButton } from "@/components/admin/AdminAccountButton";
import { AppearanceStyles } from "@/components/AppearanceStyles";
import { useBeforeUnloadIfDirty } from "@/components/admin/useBeforeUnloadIfDirty";
import { buildPuckConfig } from "@/puck/build-config";
import type { EmbeddableCollection } from "@/puck/collection-view-editor";
import { BLOCK_DESCRIPTIONS } from "@/puck/config";
import { DrawerItemPreview } from "@/puck/DrawerItemPreview";
import type { CollectionDef, Item } from "@/lib/collections/schema";
import { pageValuesForSave, type PageData } from "@/lib/page-data";
import type { Appearance } from "@/lib/site-config-types";

import {
  type CategoryConfig,
  computeCategoryVisibility,
  isVisibilityDispatchTrivial,
} from "./drawer-visibility";
import { type ItemRouteFailureBody, saveErrorMessage } from "@/lib/collections/save-error";

// Selector-based access to Puck's state: a component re-renders only when
// the slice it selects changes. (Bare `usePuck()` subscribes to the whole
// store and logs a dev warning saying so.)
const usePuck = createUsePuck();

type Props = {
  initialData: PageData;
  pageSlug: string;
  email: string;
  /**
   * Collections embeddable as page blocks (non-singleton, non-`pages`),
   * resolved server-side. Drives the generic Collection-block authoring config
   * (ADR-015 step 5) — see `buildPuckConfig`'s page surface.
   */
  embeddableCollections: EmbeddableCollection[];
  /** The site's theme, applied to the canvas so it matches the public page. */
  appearance: Appearance;
};

/**
 * Save lifecycle for the page editor (ADR-010 PR 3):
 *
 *   idle → saving → saved
 *               ↘ error(message)
 *
 * Puck's header button is labelled "Publish", but it only saves: the
 * page goes to the `draft` branch through the generic collection item
 * route. The deploy doesn't fire from here; the artist hits "Publish
 * changes" in the AdminShell to promote draft → main, at which point
 * the deploy status surfaces in the sidebar button via
 * `useDeployStatus`.
 */
type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

type ItemResponse =
  | { ok: true; item: { values: Item["values"] }; def?: Pick<CollectionDef, "fields"> }
  | ItemRouteFailureBody
  | null;

export function Editor({
  initialData,
  pageSlug,
  email,
  embeddableCollections,
  appearance,
}: Props) {
  // The block library's page surface (#349): every block, the page root
  // fields, and a Collection block per embeddable collection. Memoised so
  // Puck doesn't re-init on every keystroke (a fresh config identity resets
  // editor state).
  const config = useMemo(
    () => buildPuckConfig({ surface: "page", collections: embeddableCollections }),
    [embeddableCollections],
  );
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  // Puck doesn't surface dirty state to wrappers; track it ourselves
  // via onChange. Reset on a successful save (the saved data becomes
  // the new baseline).
  const [isDirty, setIsDirty] = useState(false);
  useBeforeUnloadIfDirty(isDirty);
  // Drawer block filter — typed into the search box above the
  // component list. Trimmed + lowercased before compare.
  const [drawerFilter, setDrawerFilter] = useState("");

  // Puck's `onPublish` (the header's "Publish" button). Reads the
  // page's current item so the save keeps fields the editor doesn't
  // own (nav visibility from the Pages panel), then PUTs the merged
  // values. Saves to the draft branch; nothing is published.
  const savePageToDraft = useCallback(
    async (data: PageData) => {
      setSaveState({ status: "saving" });
      const itemUrl = `/api/collections/pages/items/${encodeURIComponent(pageSlug)}`;
      // A rejected save names its validation issues (e.g. which
      // required field is missing), labelled with the GET's def fields.
      let fields: CollectionDef["fields"] = [];
      const fail = (res: Response, body: ItemResponse) => {
        const failure = body && !body.ok ? body : null;
        setSaveState({ status: "error", message: saveErrorMessage(res.status, failure, fields) });
      };
      try {
        const getRes = await fetch(itemUrl, { cache: "no-store" });
        const current = (await getRes.json().catch(() => null)) as ItemResponse;
        if (!getRes.ok || !current || !current.ok) {
          fail(getRes, current);
          return;
        }
        fields = current.def?.fields ?? [];
        const res = await fetch(itemUrl, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: pageValuesForSave(data, current.item.values) }),
        });
        const body = (await res.json().catch(() => null)) as ItemResponse;
        if (!res.ok || !body || !body.ok) {
          fail(res, body);
          return;
        }
        setSaveState({ status: "saved" });
        setIsDirty(false);
      } catch (cause) {
        setSaveState({
          status: "error",
          message: cause instanceof Error ? cause.message : "Save failed",
        });
      }
    },
    [pageSlug],
  );

  // The canvas iframe renders the page's blocks outside the public
  // layout, so on its own it misses the theme that layout applies.
  // Wrapping the canvas root in `.stagecraft-site` with the site's
  // AppearanceStyles gives it the same tokens, typography and gallery
  // layout as the published page (#395). The <style> lands in the
  // iframe's document, so its `:root` tokens don't reach the editor
  // chrome. Only the theme comes along: the header, footer, page
  // background image and lightbox stay on the public layout.
  //
  // Puck renders this override as the canvas's component type, so it has
  // to keep its identity across renders: a new function would remount the
  // whole canvas on every edit, save-state change and drawer keystroke.
  const CanvasFrame = useCallback(
    ({ children }: { children: ReactNode }) => (
      <div className="stagecraft-site">
        <AppearanceStyles appearance={appearance} />
        {children}
      </div>
    ),
    [appearance],
  );

  const drawerFilterState = useMemo<DrawerFilterState>(
    () => ({ filter: drawerFilter, setFilter: setDrawerFilter, config }),
    [drawerFilter, config],
  );

  return (
    <DrawerFilterContext.Provider value={drawerFilterState}>
      <Puck
        config={config}
        data={initialData}
        onPublish={savePageToDraft}
        onChange={() => setIsDirty(true)}
        overrides={{
          iframe: CanvasFrame,
          drawer: FilteredDrawer,
          drawerItem: FilteredDrawerItem,
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
              <SaveStatusPill state={saveState} />
              {children}
              <AdminAccountButton email={email} />
            </>
          ),
        }}
      />
    </DrawerFilterContext.Provider>
  );
}

/**
 * The drawer search filter, shared with the `drawer` and `drawerItem`
 * overrides. Puck renders those overrides as component types, so they
 * have to keep their identity across Editor renders: an inline function
 * remounts the whole drawer on every keystroke, which drops the search
 * input's focus after one character and resets
 * `DrawerCategoryVisibilitySync`, so clearing the filter never brought
 * hidden categories back. Module-level components read the filter from
 * this context instead.
 */
type DrawerFilterState = {
  filter: string;
  setFilter: (next: string) => void;
  config: ReturnType<typeof buildPuckConfig>;
};

const DrawerFilterContext = createContext<DrawerFilterState | null>(null);

function useDrawerFilter(): DrawerFilterState {
  const state = useContext(DrawerFilterContext);
  if (!state) throw new Error("useDrawerFilter: rendered outside the page Editor");
  return state;
}

function FilteredDrawer({ children }: { children: ReactNode }) {
  const { filter, setFilter, config } = useDrawerFilter();
  const q = filter.trim().toLowerCase();
  const hasMatch =
    !q || Object.keys(config.components).some((name) => name.toLowerCase().includes(q));
  return (
    <>
      <DrawerCategoryVisibilitySync filter={filter} categories={config.categories ?? {}} />
      <DrawerSearchInput value={filter} onChange={setFilter} />
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
}

function FilteredDrawerItem({ name, children }: { name: string; children: ReactNode }) {
  const q = useDrawerFilter().filter.trim().toLowerCase();
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
}

function SaveStatusPill({ state }: { state: SaveState }) {
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
    case "saving":
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
 * so it has Puck context (`usePuck`, from `createUsePuck`).
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
function DrawerCategoryVisibilitySync({
  filter,
  categories,
}: {
  filter: string;
  categories: Record<string, CategoryConfig | undefined>;
}) {
  const dispatch = usePuck((s) => s.dispatch);
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
          categories,
          previous.componentList,
        ),
      }),
    });
  }, [filter, categories, dispatch]);
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
  const selectedItem = usePuck((s) => s.selectedItem);
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

