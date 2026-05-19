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
import { templatePuckConfig } from "./puck-config";
import { resolveTemplate } from "./renderer";
import type { Template } from "./types";
import type { Filter, FieldId, CollectionDef, Item } from "../schema";
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
  // Use the cached PRIMITIVE_BLOCKS-only config so this doesn't rebuild
  // once per iterated item.
  return <Render config={templatePuckConfig} data={resolved} />;
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
