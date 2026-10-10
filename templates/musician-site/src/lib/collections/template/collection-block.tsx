/**
 * Collection block — embed an entire collection on a page or
 * detail template (ADR-009 §5).
 *
 * One Collection block is registered per existing collection
 * (`PagesView`, `TourDatesView`, …). They're a separate block kind
 * from primitives because:
 *
 *   - They load their items from a *different* collection than the
 *     template they live in. The walker pre-loads those items via
 *     `ResolveTemplateOptions.loadedCollections`.
 *   - Their filter / sort / limit / hideFields are authored in the
 *     block's Puck inspector, then resolved at render time against
 *     the surrounding template's `currentItem`.
 *   - They render each iterated item through the *source*
 *     collection's `itemTemplate` — a recursive walk with
 *     `item = iteratedItem`, `currentItem = outerItem`.
 *
 * This module holds the data side: the on-disk and resolved props, the
 * walker's resolver, block naming and source discovery. The render
 * component (`CollectionBlockRender`) lives with the render config in
 * `@/puck/render-config`, because it renders item templates through that
 * same config. That keeps this module free of the walker and of any Puck
 * config, so the walker can import it without an import cycle.
 *
 * Cycle safety (ADR §4.3): itemTemplates can't contain Collection
 * blocks. The editor offers them only on pages and detail templates,
 * and the walker resolves them only when the caller passes
 * `collectionSlugs` — an item template's walk passes none.
 */

import type { ReactNode } from "react";

import { Image } from "@/components/Image";

import { applyFilter, mapFilterFields, withoutClausesOnMissingFields } from "./filter";
import type { ResolveContext, Template } from "./types";
import { viewFieldIdFor } from "./view-requirements";
import type { FieldDef, FieldValue, Filter, FieldId, CollectionDef, Item } from "../schema";
import { compareItemsByField, scalarSortKey } from "../sort-key";

// ---------------------------------------------------------------------------
// On-disk props (what the Puck JSON stores)
// ---------------------------------------------------------------------------

export type CollectionBlockSort = {
  fieldId: FieldId;
  direction: "asc" | "desc";
};

export type CollectionBlockRawProps = {
  /**
   * Collection slug whose items this block iterates. Implicit in the
   * block name (e.g. `TourDatesView` ↔ `tour-dates`), but also stored
   * on the props so the resolver doesn't have to derive it from the
   * dispatched block type.
   */
  sourceCollection: string;
  filter?: Filter | null;
  sort?: CollectionBlockSort | null;
  limit?: number | null;
  hideFields?: FieldId[];
};

// ---------------------------------------------------------------------------
// Resolved props (what the render component receives)
// ---------------------------------------------------------------------------

export type CollectionBlockResolvedProps = {
  /**
   * Items, already filtered + sorted + limited. The render component
   * iterates this and renders each through the source collection's
   * itemTemplate.
   */
  items: ReadonlyArray<Item>;
  /** Source collection's def — supplies the itemTemplate to render each item through. */
  sourceDef: CollectionDef | null;
  hideFields: ReadonlyArray<FieldId>;
  /**
   * The surrounding template's item — threaded through so inner
   * walks for each iterated item see the *outer* item as
   * `currentItem` (the §5.1 contract).
   */
  currentItem: Item;
};

// ---------------------------------------------------------------------------
// Resolver — walker hook
// ---------------------------------------------------------------------------

export function resolveCollectionBlockProps(
  raw: CollectionBlockRawProps,
  ctx: ResolveContext,
): CollectionBlockResolvedProps {
  const sourceSlug = raw.sourceCollection;
  const loaded = ctx.loadedCollections[sourceSlug];
  if (!loaded) {
    // Source collection wasn't pre-loaded — block renders nothing.
    // The renderer is supposed to walk the template once and pre-
    // load every referenced source; reaching this branch means
    // either the walker forgot, or the collection doesn't exist.
    return {
      items: [],
      sourceDef: null,
      hideFields: raw.hideFields ?? [],
      currentItem: ctx.currentItem,
    };
  }

  // The default blocks save a specialised view's declared field ids
  // (`collection-view-props.ts`). Once the artist deletes one of those
  // fields and adds a same-name one back, the sort and filter follow the
  // new field, the same way the card does (`viewFieldIdFor`). A
  // `currentItemField` value names a field of the surrounding item, so it
  // resolves against that item's def.
  const fieldIdFor = (fieldId: FieldId): FieldId => viewFieldIdFor(loaded.def, fieldId);
  const { currentItemDef } = ctx;
  const currentItemFieldIdFor = currentItemDef
    ? (fieldId: FieldId): FieldId => viewFieldIdFor(currentItemDef, fieldId)
    : undefined;
  // A clause still naming a field the collection no longer has (deleted
  // with no stand-in, or a role like tour-date `status` that never takes
  // one) would hide every item for good; it's dropped, so that filter
  // stops filtering instead. The same goes for a `currentItemField` value
  // naming a field the surrounding item's def no longer has, when that
  // def is known.
  const sourceFieldIds = new Set(loaded.def.fields.map((f) => f.id));
  const currentItemFieldIds = currentItemDef
    ? new Set(currentItemDef.fields.map((f) => f.id))
    : null;
  const filter = raw.filter
    ? withoutClausesOnMissingFields(
        mapFilterFields(raw.filter, fieldIdFor, currentItemFieldIdFor),
        (fieldId) => sourceFieldIds.has(fieldId),
        (fieldId) => currentItemFieldIds?.has(fieldId) ?? true,
      )
    : null;
  let filtered = applyFilter(loaded.items, filter, ctx.currentItem);

  if (raw.sort) {
    const fieldId = fieldIdFor(raw.sort.fieldId);
    const { direction } = raw.sort;
    filtered = filtered.slice().sort((a, b) => compareItemsByField(a, b, fieldId, direction));
  }

  if (raw.limit !== null && raw.limit !== undefined && raw.limit > 0) {
    filtered = filtered.slice(0, raw.limit);
  }

  return {
    items: filtered,
    sourceDef: loaded.def,
    hideFields: raw.hideFields ?? [],
    currentItem: ctx.currentItem,
  };
}

/**
 * The default body of a Collection block item with no itemTemplate and
 * no specialised renderer (`CollectionBlockRender`'s fallback).
 *
 * Renders `image` values as `<picture>` (so photo / cover-art / store
 * collections aren't visually empty out of the box), `url` values as
 * clickable links (so `externalUrl` on store-items, `ticketUrl` on
 * tour-dates etc. behave like links), and every other scalar field
 * type via `scalarSortKey`. `puckContent`, `richText`, `file`, and
 * `collectionRef` are skipped — meaningful default rendering for those
 * needs more context than this fallback has.
 */
export function DefaultItemFieldsList({
  item,
  def,
}: {
  item: Item;
  def: CollectionDef;
}): ReactNode {
  return (
    <>
      {def.fields.map((field) => {
        const value = item.values[field.id];
        if (value === undefined) return null;
        return renderDefaultField(field, value);
      })}
    </>
  );
}

function renderDefaultField(field: FieldDef, value: FieldValue): ReactNode {
  if (value.type === "image") {
    return (
      <div key={field.id} style={{ margin: "var(--space-2) 0" }}>
        <Image image={value.value} sizes="(max-width: 800px) 100vw, 800px" />
      </div>
    );
  }
  if (value.type === "url") {
    return (
      <p key={field.id} style={{ margin: "var(--space-1) 0" }}>
        <strong>{field.key}:</strong>{" "}
        <a href={value.value} rel="noopener noreferrer">
          {value.value}
        </a>
      </p>
    );
  }
  const display = scalarSortKey(value);
  if (display === null) return null;
  return (
    <p key={field.id} style={{ margin: "var(--space-1) 0" }}>
      <strong>{field.key}:</strong> {String(display)}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Block naming — one Collection block per collection (ADR §5)
// ---------------------------------------------------------------------------

/**
 * Derive the Puck block name (e.g. `TourDatesView`) from a
 * collection slug (`tour-dates`). Stable transformation:
 * kebab-case → PascalCase + `View`. Reversed via
 * `collectionSlugForBlockName`.
 */
export function blockNameForCollection(slug: string): string {
  const pascal = slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `${pascal}View`;
}

// ---------------------------------------------------------------------------
// Template pre-walk: discover which collections to pre-load
// ---------------------------------------------------------------------------

/**
 * Walk a template tree and collect every `sourceCollection` slug
 * any Collection block references. The renderer uses this server-
 * side to know which collections to load before invoking the sync
 * walker.
 *
 * Returns a sorted, deduplicated array — sorted only for test
 * determinism; callers don't depend on order.
 */
export function findCollectionBlockSources(template: Template | null): string[] {
  if (!template || !Array.isArray(template.content)) return [];
  const sources = new Set<string>();
  walkForSources(template.content, sources);
  return [...sources].sort();
}

function walkForSources(blocks: unknown[], out: Set<string>): void {
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const blockObj = block as { type?: unknown; props?: unknown };
    const props = blockObj.props;
    if (!props || typeof props !== "object") continue;

    // Collection blocks store their source collection slug on
    // `sourceCollection` (set by `defaultProps` when the block is
    // added; not editable in the inspector). Pick it up structurally
    // so this walker doesn't have to know which block names belong
    // to Collection blocks.
    const sourceSlug = (props as { sourceCollection?: unknown }).sourceCollection;
    if (typeof sourceSlug === "string" && sourceSlug.length > 0) {
      out.add(sourceSlug);
    }

    // Recurse into any array-valued prop (slot children, e.g.
    // Section.children — same structural-walk pattern as the
    // schema-changes template walker).
    for (const value of Object.values(props as Record<string, unknown>)) {
      if (Array.isArray(value)) walkForSources(value, out);
    }
  }
}
