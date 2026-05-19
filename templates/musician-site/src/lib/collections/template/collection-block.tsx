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
 *     collection's `itemTemplate` — a recursive `TemplateRenderer`
 *     call with `item = iteratedItem`, `currentItem = outerItem`.
 *
 * Cycle safety (ADR §4.3): itemTemplates can't contain Collection
 * blocks. The renderer enforces this by registering Collection
 * blocks only on the *detail* editor config; the item editor's
 * config has them removed.
 */

import type { ReactNode } from "react";
import { Render } from "@measured/puck";

import { applyFilter } from "./filter";
import { PRIMITIVE_BLOCKS, type BlockEntry, type ResolveContext } from "./primitives";
import { buildTemplatePuckConfig } from "./puck-config";
import { resolveTemplate } from "./renderer";
import type { Template } from "./types";
import type { Filter, FieldId, CollectionDef, Item } from "../schema";

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

  let filtered = applyFilter(loaded.items, raw.filter ?? null, ctx.currentItem);

  if (raw.sort) {
    const { fieldId, direction } = raw.sort;
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
 * Lexicographic / numeric compare on a single field. Mirrors
 * `store.ts`'s `sortByField` so the in-template sort and the
 * collection's `defaultSort` rank items the same way.
 */
function compareItemsByField(
  a: Item,
  b: Item,
  fieldId: FieldId,
  direction: "asc" | "desc",
): number {
  const av = scalarSortKey(a.values[fieldId]);
  const bv = scalarSortKey(b.values[fieldId]);
  if (av === null && bv === null) return a.slug.localeCompare(b.slug);
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp = av < bv ? -1 : av > bv ? 1 : 0;
  return direction === "asc" ? cmp : -cmp;
}

function scalarSortKey(value: Item["values"][string] | undefined): string | number | null {
  if (value === undefined) return null;
  switch (value.type) {
    case "text":
    case "longText":
    case "date":
    case "url":
    case "email":
    case "color":
    case "select":
    case "number":
      return value.value;
    case "boolean":
      return value.value ? 1 : 0;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Render component
// ---------------------------------------------------------------------------

/**
 * Public render component for a Collection block. Server-renderable;
 * iterates the resolved items and renders each via the source
 * collection's itemTemplate.
 */
export function CollectionBlockRender({
  items,
  sourceDef,
  currentItem,
}: CollectionBlockResolvedProps): ReactNode {
  if (!sourceDef) {
    // Source collection not loaded — render nothing rather than
    // throwing. The resolver's empty `items` already covers this,
    // but be defensive about render-time invariants.
    return null;
  }
  return (
    <div data-collection-view={sourceDef.slug}>
      {items.map((item) => (
        <CollectionBlockItem
          key={item.id}
          item={item}
          sourceDef={sourceDef}
          currentItem={currentItem}
        />
      ))}
    </div>
  );
}

function CollectionBlockItem({
  item,
  sourceDef,
  currentItem,
}: {
  item: Item;
  sourceDef: CollectionDef;
  currentItem: Item;
}): ReactNode {
  const template = sourceDef.itemTemplate;
  if (!template) {
    // No itemTemplate configured — render a minimal default:
    // every scalar field rendered as plain text. Keeps the block
    // useful out of the box, even before the artist authors a
    // template. Detail-template editing comes online when the
    // artist clicks "Edit item template" from the schema editor.
    return <DefaultItemRender item={item} sourceDef={sourceDef} />;
  }
  // Recursive resolve: this item's template, walked with `item =
  // iteratedItem` but `currentItem` carried through unchanged so
  // §5.1's currentItemId / currentItemField FilterValue arms still
  // reference the surrounding (outer) item.
  const resolved = resolveTemplate(template as Template, item, {
    registry: PRIMITIVE_BLOCKS,
    currentItem,
  });
  return <Render config={buildTemplatePuckConfig()} data={resolved} />;
}

/**
 * Fallback "render every scalar field as plain text" when the
 * source collection has no itemTemplate configured. Used both by
 * Collection blocks iterating items and by the detail-page route
 * for collections whose `detailTemplate` is null.
 */
function DefaultItemRender({
  item,
  sourceDef,
}: {
  item: Item;
  sourceDef: CollectionDef;
}): ReactNode {
  return (
    <article style={{ marginBottom: "var(--space-4)" }}>
      {sourceDef.fields.map((field) => {
        const value = item.values[field.id];
        if (value === undefined) return null;
        const display = scalarSortKey(value);
        if (display === null) return null;
        return (
          <p key={field.id} style={{ margin: "var(--space-1) 0" }}>
            <strong>{field.key}:</strong> {String(display)}
          </p>
        );
      })}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Block registration — one entry per collection (ADR §5)
// ---------------------------------------------------------------------------

/**
 * Build the BlockEntry that powers a single Collection block. The
 * block's "type" name (e.g. `TourDatesView`) is the dispatcher key
 * Puck uses to route to this entry's render function.
 *
 * Caller is `buildTemplatePuckConfigWithCollections` (sibling of
 * `buildTemplatePuckConfig`), which builds one entry per slug in
 * the registry. Editor-config callers (the Puck inspector surface)
 * use `buildCollectionBlockComponentConfig` instead — it adds the
 * authoring fields (filter / sort / limit / hideFields).
 */
export function buildCollectionBlockEntry(): BlockEntry<
  CollectionBlockRawProps,
  CollectionBlockResolvedProps
> {
  return {
    Component: CollectionBlockRender,
    resolveProps: resolveCollectionBlockProps,
    // The renderer config: every prop is data, no slot fields.
    // Puck's `Render` will dispatch by block type and call
    // `CollectionBlockRender` with the resolved props.
    fields: {
      items: { type: "custom" },
      sourceDef: { type: "custom" },
      hideFields: { type: "custom" },
      currentItem: { type: "custom" },
    },
  };
}

/**
 * Build the dispatcher-name → block-entry map a renderer would
 * register. One entry per collection slug. Used by the public
 * renderer at request time.
 */
export function buildCollectionBlockRegistry(
  collectionSlugs: ReadonlyArray<string>,
): Readonly<Record<string, BlockEntry>> {
  const entry = buildCollectionBlockEntry();
  const registry: Record<string, BlockEntry> = {};
  for (const slug of collectionSlugs) {
    registry[blockNameForCollection(slug)] = entry as unknown as BlockEntry;
  }
  return registry;
}

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
