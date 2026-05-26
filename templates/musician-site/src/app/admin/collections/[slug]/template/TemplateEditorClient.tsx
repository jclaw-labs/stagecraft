/**
 * Template editor (ADR-009 PR 6, real-item preview PR 5).
 *
 *   /admin/collections/<slug>/template/item    → itemTemplate
 *   /admin/collections/<slug>/template/detail  → detailTemplate
 *
 * Mounts Puck with the binding-aware editor config and persists the
 * resulting `Data` via `PUT /api/collections/<slug>/template/<kind>`.
 * The per-template route reads the rest of the def from disk and
 * applies only the chosen template slot — that keeps a concurrent
 * schema change in another tab from being silently rolled back.
 *
 * Layout is split: the Puck editor on the left, a live preview pane
 * on the right that renders the current template via `resolveTemplate`
 * against the artist-selected item. The preview pane defaults to the
 * collection's first item; the artist can swap it via the chrome
 * dropdown. Empty collection → an empty-state nudging the artist to
 * add an item first (the renderer needs a real item to bind against,
 * and an "empty" preview would just show placeholders again).
 */

"use client";

import { Puck, Render, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AdminAccountButton } from "@/components/admin/AdminAccountButton";
import { buildCollectionBlockComponentConfig } from "@/components/admin/buildCollectionBlockComponentConfig";
import {
  buildEditorPuckConfig,
  type ExtraBlocks,
} from "@/components/admin/buildEditorPuckConfig";
import {
  PuckBackLink,
  PuckLabelPill,
  PuckSaveStatusPill,
  type PuckEditorSaveStatus,
} from "@/components/admin/PuckEditorChrome";
import { useBeforeUnloadIfDirty } from "@/components/admin/useBeforeUnloadIfDirty";

import type { CollectionDef, Item } from "@/lib/collections";
import {
  blockNameForCollection,
  buildCollectionBlockRegistry,
} from "@/lib/collections/template/collection-block";
import { PRIMITIVE_BLOCKS } from "@/lib/collections/template/primitives";
import { buildTemplatePuckConfig } from "@/lib/collections/template/puck-config";
import {
  resolveTemplate,
  type LoadedCollections,
} from "@/lib/collections/template/renderer";
import type { Template } from "@/lib/collections/template/types";

export type TemplateKind = "item" | "detail";

type Props = {
  collectionSlug: string;
  def: CollectionDef;
  kind: TemplateKind;
  email: string;
  /**
   * Items the artist can pick from when previewing the template. The
   * route pre-fetches these via `listItemsInOrder` so the dropdown
   * defaults to the same order the public site lists them in. Empty
   * array → the preview pane shows the "add an item to enable
   * preview" empty state.
   */
  previewItems: ReadonlyArray<Item>;
  /**
   * Non-singleton CollectionDefs the detail-template editor offers as
   * Collection blocks. Defs cross the RSC boundary as plain data; we
   * derive both `extraBlocks` (Puck `ComponentConfig`s, whose render
   * closures aren't serialisable) and the preview registry from them
   * here, client-side. Item-template editors pass undefined — item
   * templates can't embed Collection blocks (ADR §4.3 cycle safety).
   */
  iterableCollectionDefs?: ReadonlyArray<CollectionDef>;
  /**
   * Items + defs every Collection block in the detail template could
   * iterate. Pre-loaded server-side because `loadCollectionsForTemplate`
   * needs filesystem access; the client receives the fully-populated
   * map up front so the preview stays synchronous through every
   * binding swap. Item-template editors don't pass this.
   */
  loadedCollections?: LoadedCollections;
};

export function TemplateEditorClient({
  collectionSlug,
  def,
  kind,
  email,
  previewItems,
  iterableCollectionDefs,
  loadedCollections,
}: Props) {
  const extraBlocks = useMemo<ExtraBlocks | undefined>(() => {
    if (kind !== "detail" || !iterableCollectionDefs) return undefined;
    return Object.fromEntries(
      iterableCollectionDefs.map((d) => [
        blockNameForCollection(d.slug),
        // `d` is the source collection this block iterates; `def` is
        // the containing template's collection so the FilterField's
        // currentItemField picker has fields to offer.
        buildCollectionBlockComponentConfig(d, def),
      ]),
    );
  }, [def, kind, iterableCollectionDefs]);
  const initialData = useMemo<Data>(() => {
    const stored = kind === "item" ? def.itemTemplate : def.detailTemplate;
    if (stored && typeof stored === "object" && "content" in stored) {
      return stored as Data;
    }
    return { content: [], root: { props: {} } };
  }, [def, kind]);

  const config = useMemo(
    // Detail templates can embed Collection blocks (one per existing
    // collection); item templates can't, per ADR §4.3 cycle safety.
    // `extraBlocks` is built from the server-supplied `iterableCollectionDefs`
    // above — the closures inside each block's render aren't
    // RSC-serialisable, so the factory has to run client-side.
    () => buildEditorPuckConfig(def, { kind, extraBlocks }),
    [def, kind, extraBlocks],
  );

  const [status, setStatus] = useState<PuckEditorSaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  useBeforeUnloadIfDirty(isDirty);

  // Track the artist's live Puck data so the preview pane can render
  // it without waiting for a save. Initialise from disk; Puck calls
  // `onChange(data)` on every keystroke / drag, and the preview
  // re-renders against the current selection. `Template` is a type
  // alias for Puck's `Data` (see `template/types.ts`), so no cast.
  const [liveData, setLiveData] = useState<Template>(initialData);

  // Remount Puck whenever `initialData` changes (concurrent edit in
  // another tab refetched the def, or a future `router.refresh()`).
  // Puck takes `data` as an initial value only — without a key
  // change it holds the pre-refetch tree internally, diverging from
  // the resynced `liveData` on the right. Bumping the key forces a
  // clean mount that picks up the new disk state.
  //
  // `useRef` skips the first mount so Puck doesn't remount on its
  // own first render. Subsequent `initialData` changes are real
  // refetches and warrant the remount.
  const isFirstRun = useRef(true);
  const [puckMountId, setPuckMountId] = useState(0);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    setLiveData(initialData);
    setPuckMountId((id) => id + 1);
  }, [initialData]);

  const [selectedItemSlug, setSelectedItemSlug] = useState<string | null>(
    previewItems[0]?.slug ?? null,
  );

  // Clean up the selection if the currently-selected slug falls out
  // of `previewItems` (e.g. the artist deleted the item in another
  // tab and the page refetched). Without this, `selectedItem`
  // resolves to null and the preview pane shows the defensive
  // "Select an item" branch — confusing copy for a state the
  // artist didn't choose.
  useEffect(() => {
    if (
      selectedItemSlug !== null &&
      !previewItems.some((i) => i.slug === selectedItemSlug)
    ) {
      setSelectedItemSlug(previewItems[0]?.slug ?? null);
    }
  }, [previewItems, selectedItemSlug]);

  const selectedItem = useMemo<Item | null>(() => {
    if (!selectedItemSlug) return null;
    return previewItems.find((i) => i.slug === selectedItemSlug) ?? null;
  }, [previewItems, selectedItemSlug]);

  const previewRegistry = useMemo(() => {
    // Two different reasons for the primitives-only registry, both
    // landing here:
    //   - item kind → Collection blocks aren't permitted (ADR §4.3
    //     cycle safety). Always primitives only.
    //   - detail kind with no `iterableCollectionDefs` → caller
    //     misconfiguration (the detail route should always pass
    //     them). Fall back to primitives so the preview still
    //     renders; surfaces as a missing-block-type in the resolved
    //     output rather than a crash.
    if (kind === "item" || !iterableCollectionDefs) return PRIMITIVE_BLOCKS;
    const collectionRegistry = buildCollectionBlockRegistry(
      iterableCollectionDefs.map((d) => d.slug),
    );
    return { ...PRIMITIVE_BLOCKS, ...collectionRegistry };
  }, [kind, iterableCollectionDefs]);

  const previewPuckConfig = useMemo(
    () => buildTemplatePuckConfig(previewRegistry),
    [previewRegistry],
  );

  const resolvedPreview = useMemo(() => {
    if (!selectedItem) return null;
    return resolveTemplate(liveData, selectedItem, {
      registry: previewRegistry,
      currentItem: selectedItem,
      itemDef: def,
      loadedCollections: loadedCollections ?? {},
    });
  }, [liveData, selectedItem, previewRegistry, def, loadedCollections]);

  const onPublish = useCallback(
    async (data: Data) => {
      setStatus("saving");
      setErrorMessage(null);
      // The dedicated per-template route writes ONLY the chosen slot,
      // reading the rest of the def from disk. The previous flow
      // round-tripped the full CollectionDef through /schema, which
      // silently rolled back any concurrent schema-editor save with
      // this editor's mount-time `fields` snapshot.
      try {
        const res = await fetch(
          `/api/collections/${collectionSlug}/template/${kind}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data }),
          },
        );
        const body = (await res.json().catch(() => null)) as
          | { ok: true; publishWarning?: string }
          | { ok: false; error?: string; issues?: Array<{ message: string }> }
          | null;
        if (!res.ok || !body || !body.ok) {
          // 409s carry a structured `issues` array — surface each
          // message so the artist sees what specifically blocked the
          // save (a binding to a removed field, a wrong-typed field,
          // etc.).
          const issueMessages =
            body && "issues" in body && Array.isArray(body.issues)
              ? body.issues.map((i) => i.message).join("; ")
              : "";
          const message =
            issueMessages ||
            (body && "error" in body && body.error) ||
            `Save failed (HTTP ${res.status})`;
          setStatus("error");
          setErrorMessage(message);
          return;
        }
        setStatus("saved");
        setIsDirty(false);
        if ("publishWarning" in body && body.publishWarning) {
          setErrorMessage(`Saved locally, publish warning: ${body.publishWarning}`);
        }
      } catch (cause) {
        setStatus("error");
        setErrorMessage(cause instanceof Error ? cause.message : "Save failed");
      }
    },
    [collectionSlug, kind],
  );

  const onChange = useCallback((next: Data) => {
    setIsDirty(true);
    setLiveData(next);
  }, []);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
        height: "100vh",
        width: "100vw",
      }}
    >
      <div style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <Puck
          key={puckMountId}
          config={config}
          data={initialData}
          onPublish={onPublish}
          onChange={onChange}
          overrides={{
            headerActions: ({ children }) => (
              <>
                <PuckBackLink href={`/admin/collections/${collectionSlug}`}>
                  ← {def.pluralName}
                </PuckBackLink>
                <PuckLabelPill title="Template kind">
                  {kind === "item" ? "Item template" : "Detail template"}
                </PuckLabelPill>
                <PreviewItemPicker
                  items={previewItems}
                  selectedSlug={selectedItemSlug}
                  onChange={setSelectedItemSlug}
                />
                <PuckSaveStatusPill status={status} errorMessage={errorMessage} />
                {children}
                <AdminAccountButton email={email} />
              </>
            ),
          }}
        />
      </div>
      <PreviewPane
        collectionSlug={collectionSlug}
        config={previewPuckConfig}
        data={resolvedPreview}
        hasItems={previewItems.length > 0}
        selectedSlug={selectedItemSlug}
      />
    </div>
  );
}

/**
 * Inline preview-item picker for the Puck header. Native `<select>` so
 * we don't drag in the heavier admin form primitive — the chrome is
 * a tight strip where extra padding matters.
 */
function PreviewItemPicker({
  items,
  selectedSlug,
  onChange,
}: {
  items: ReadonlyArray<Item>;
  selectedSlug: string | null;
  onChange: (slug: string) => void;
}) {
  if (items.length === 0) {
    return (
      <span
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
        }}
        title="No items to preview against"
      >
        No items
      </span>
    );
  }
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        fontSize: "var(--font-size-xs)",
        color: "var(--color-text-muted)",
      }}
    >
      <span>Preview item:</span>
      <select
        aria-label="Preview item"
        value={selectedSlug ?? ""}
        onChange={(event) => onChange(event.target.value)}
        style={{
          fontSize: "var(--font-size-xs)",
          padding: "var(--space-1) var(--space-2)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-surface)",
          color: "var(--color-text)",
        }}
      >
        {items.map((item) => (
          <option key={item.slug} value={item.slug}>
            {item.slug}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Right-hand pane that renders the resolved template. Three states:
 *
 *   - empty collection         → empty-state nudge to add an item
 *   - no selection (shouldn't  → fallback empty-state, same look as
 *     happen, but defensive)     above
 *   - resolved template        → Puck `<Render>` against `resolvedPreview`
 */
function PreviewPane({
  collectionSlug,
  config,
  data,
  hasItems,
  selectedSlug,
}: {
  collectionSlug: string;
  config: ReturnType<typeof buildTemplatePuckConfig>;
  data: Template | null;
  hasItems: boolean;
  selectedSlug: string | null;
}) {
  const wrapperStyle = {
    minWidth: 0,
    minHeight: 0,
    overflow: "auto" as const,
    background: "var(--color-surface-subtle)",
    borderLeft: "1px solid var(--color-border)",
    padding: "var(--space-4)",
  };

  if (!hasItems) {
    return (
      <aside style={wrapperStyle} aria-label="Template preview">
        <PreviewHeader />
        <EmptyState>
          The template renders against a real item, so it needs at least one to
          bind against.{" "}
          <Link
            href={`/admin/collections/${collectionSlug}/items/new`}
            style={{ color: "var(--color-action)" }}
          >
            Add an item
          </Link>{" "}
          to enable preview.
        </EmptyState>
      </aside>
    );
  }

  if (!data || !selectedSlug) {
    return (
      <aside style={wrapperStyle} aria-label="Template preview">
        <PreviewHeader />
        <EmptyState>Select an item from the dropdown to preview.</EmptyState>
      </aside>
    );
  }

  return (
    <aside style={wrapperStyle} aria-label="Template preview">
      <PreviewHeader />
      <div data-testid="template-preview-render">
        <Render config={config} data={data} />
      </div>
    </aside>
  );
}

function PreviewHeader() {
  return (
    <h2
      style={{
        fontSize: "var(--font-size-xs)",
        fontWeight: "var(--font-weight-semibold)" as unknown as number,
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        margin: 0,
        marginBottom: "var(--space-3)",
      }}
    >
      Preview
    </h2>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: "var(--font-size-sm)",
        color: "var(--color-text-muted)",
        maxWidth: "var(--max-width-narrow)",
        lineHeight: "var(--line-height-base)",
      }}
    >
      {children}
    </p>
  );
}

