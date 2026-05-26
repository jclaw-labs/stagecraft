/**
 * Top-level entry point for rendering a template against an item.
 *
 * Pipeline:
 *
 *   1. Walk `template.content` top-down. For each block, look up its
 *      entry in the registry and call `entry.resolveProps(raw, ctx)`.
 *      The result is a new block whose props are literal values —
 *      every `Bindable<T>` has been replaced with its resolved value
 *      against `item`. Slot props (arrays of nested blocks) get
 *      recursed.
 *   2. Pass the resolved data to Puck's `<Render>`. Puck handles
 *      slot rendering natively (the slot's `BlockInstance[]` becomes
 *      a `SlotComponent` the block's component calls).
 *
 * Resolution and rendering are decoupled: block components never see
 * `Bindable`, never reach into the current item, and don't need
 * `"use client"`. The whole tree is Server-Component-friendly.
 *
 * Unknown block types (not in the registry) flow through with their
 * raw props untouched. Puck's `<Render>` skips components it doesn't
 * know about.
 */

import type { ReactNode } from "react";
import { Render } from "@measured/puck";

import { PRIMITIVE_BLOCKS, type BlockEntry } from "./primitives";
import { buildTemplatePuckConfig } from "./puck-config";
import type { BlockInstance, Template } from "./types";
import type { CollectionDef, Item } from "../schema";

export type TemplateRendererProps = {
  /** The template's Puck data (item / detail / list — same shape). */
  template: Template | null;
  /** The item to render against. Drives every binding's resolution. */
  item: Item;
  /** The item's collection. Reserved for future Collection-block use. */
  collection: CollectionDef;
  /**
   * The surrounding template's item — defaults to `item`. Collection
   * blocks iterate other collections' items but their filters
   * reference the outer (current) item; the inner walks pass this
   * through unchanged. See `ResolveContext` for the full rationale.
   */
  currentItem?: Item;
  /**
   * Block registry. Defaults to `PRIMITIVE_BLOCKS`. Detail / page-
   * body renders pass an extended registry that adds one Collection
   * block per loaded collection — built from `buildCollectionBlockRegistry`
   * and unioned with the primitives.
   */
  registry?: Readonly<Record<string, BlockEntry>>;
  /**
   * Items + defs the template's Collection blocks iterate. The
   * caller (catch-all route) pre-walks the template via
   * `findCollectionBlockSources`, loads each in parallel, and passes
   * the map here. Item-template renders skip this; Collection
   * blocks aren't permitted inside them.
   */
  loadedCollections?: LoadedCollections;
};

export function TemplateRenderer({
  template,
  item,
  collection,
  currentItem,
  registry = PRIMITIVE_BLOCKS,
  loadedCollections,
}: TemplateRendererProps): ReactNode {
  if (!template) return null;
  const resolved = resolveTemplate(template, item, {
    registry,
    currentItem,
    itemDef: collection,
    loadedCollections,
  });
  const config = registry === PRIMITIVE_BLOCKS ? undefined : buildTemplatePuckConfig(registry);
  return <Render config={config ?? buildTemplatePuckConfig()} data={resolved} />;
}

/**
 * Items + defs that Collection blocks can iterate. Keyed by
 * collection slug — the renderer pre-loads these server-side so the
 * walker stays sync. Each entry pairs the source collection's def
 * (for itemTemplate lookup + field metadata) with its current items
 * (already validated and ordered as `listItemsInOrder` returns).
 */
export type LoadedCollections = Readonly<
  Record<string, { def: CollectionDef; items: ReadonlyArray<Item> }>
>;

/**
 * Options bag for `resolveTemplate`. Optional: each field has a
 * sensible default. PR 7c adds `loadedCollections` for Collection
 * blocks that iterate over other collections; the renderer pre-
 * loads them so the walker stays pure / sync.
 */
export type ResolveTemplateOptions = {
  /** Block dispatch registry. Defaults to `PRIMITIVE_BLOCKS`. */
  registry?: Readonly<Record<string, BlockEntry>>;
  /**
   * The surrounding template's item. Defaults to `item`. Inner walks
   * (Collection blocks iterating in PR 7c) pass it explicitly so the
   * outer-item context persists through iteration.
   */
  currentItem?: Item;
  /**
   * The def of `item`. Threaded into binding resolution so a binding's
   * `format` can reach field metadata (e.g. a `select` field's option
   * labels). Optional — omit it and `format: "label"` falls back to the
   * raw value (date presets still work, they need only the value).
   */
  itemDef?: CollectionDef;
  /**
   * Items + defs Collection blocks may iterate. Keys are collection
   * slugs; the renderer pre-loads only the collections the template
   * actually references. Empty / missing means no Collection blocks
   * will find their source — they'll render nothing.
   */
  loadedCollections?: LoadedCollections;
};

/**
 * Walk a template top-down and produce a new template whose block
 * props contain literal values everywhere. Exported for tests and for
 * static-export pipelines that want to resolve once at build time and
 * cache.
 */
export function resolveTemplate(
  template: Template,
  item: Item,
  options: ResolveTemplateOptions = {},
): Template {
  const registry = options.registry ?? PRIMITIVE_BLOCKS;
  const currentItem = options.currentItem ?? item;
  const loadedCollections = options.loadedCollections ?? {};
  const itemDef = options.itemDef;
  const ctx = {
    item,
    currentItem,
    itemDef,
    loadedCollections,
    recurse: (block: BlockInstance) =>
      resolveBlock(block, item, currentItem, itemDef, loadedCollections, registry, ctx.recurse),
  };
  return {
    ...template,
    content: (template.content ?? []).map(ctx.recurse) as Template["content"],
  };
}

/** Resolve one block: dispatch to the registry entry's `resolveProps`. */
function resolveBlock(
  block: BlockInstance,
  item: Item,
  currentItem: Item,
  itemDef: CollectionDef | undefined,
  loadedCollections: LoadedCollections,
  registry: Readonly<Record<string, BlockEntry>>,
  recurse: (b: BlockInstance) => BlockInstance,
): BlockInstance {
  const entry = registry[block.type];
  if (!entry) {
    // Unknown block — leave as-is. Puck's <Render> will skip it.
    return block;
  }
  const resolved = entry.resolveProps(block.props, {
    item,
    currentItem,
    itemDef,
    loadedCollections,
    recurse,
  });
  return { type: block.type, props: resolved as Record<string, unknown> };
}
