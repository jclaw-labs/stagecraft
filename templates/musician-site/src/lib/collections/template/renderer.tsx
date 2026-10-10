/**
 * Top-level entry point for rendering a block tree against an item.
 *
 * Pipeline:
 *
 *   1. Walk `template.content` top-down (`resolveTemplate`). Each block's
 *      bindable props (`BINDABLE_SLOTS`) resolve against `item`; a
 *      Collection block resolves its items from `loadedCollections`. Every
 *      array of nested blocks (Section.children, Columns.col1, …) is walked
 *      the same way. The result is a tree of plain literal props.
 *   2. Pass the resolved data to Puck's `<Render>` with the render config
 *      from `buildPuckConfig`. Puck handles slot rendering natively.
 *
 * Pages, templates and item bodies all go through this one walker and one
 * block library (#349): a page body is a tree whose bindable props happen
 * to hold plain literals, which pass through unchanged.
 *
 * Resolution and rendering are decoupled: block components never see a
 * binding, never reach into the current item, and don't need
 * `"use client"`. The whole tree is Server-Component-friendly.
 */

import type { ReactNode } from "react";
import { Render } from "@measured/puck";

import { buildPuckConfig } from "@/puck/build-config";

import { BINDABLE_SLOTS, type BindableSlotKind } from "./bindable-slots";
import {
  isBindableRef,
  resolveBindable,
  resolveRichTextBindable,
  resolveStringBindable,
} from "./binding";
import { blockNameForCollection, resolveCollectionBlockProps } from "./collection-block";
import type { BlockInstance, Template } from "./types";
import type { Bindable, CollectionDef, Item } from "../schema";
import type { ImageMetadata } from "../../image-types";

/**
 * Context handed to a Collection block's resolver.
 *
 * `item` is the item bindings resolve against — it changes as nested
 * templates iterate (a Collection block resolves its children against each
 * iterated item). `currentItem` is the item the *surrounding* template is
 * rendering — it stays the same all the way down so Collection-block filters
 * can reference it (ADR §5.1's `currentItemId` / `currentItemField`
 * FilterValue arms). For non-Collection-block walks the two are equal.
 */
export type ResolveContext = {
  item: Item;
  currentItem: Item;
  /**
   * The def of `item` — supplies field metadata (e.g. a `select` field's
   * option labels) so a binding's `format` can apply.
   */
  itemDef?: CollectionDef;
  loadedCollections: LoadedCollections;
};

export type TemplateRendererProps = {
  /** The template's Puck data (item / detail / list — same shape). */
  template: Template | null;
  /** The item to render against. Drives every binding's resolution. */
  item: Item;
  /** The item's collection. Supplies field metadata for `format`. */
  collection: CollectionDef;
  /**
   * The surrounding template's item — defaults to `item`. See
   * `ResolveContext`.
   */
  currentItem?: Item;
  /**
   * Collections whose Collection blocks (`<Slug>View`) this tree may embed.
   * Leave empty for item templates: they can't embed Collection blocks
   * (ADR §4.3 cycle safety), so any they contain render nothing.
   */
  collectionSlugs?: ReadonlyArray<string>;
  /** Items + defs the tree's Collection blocks iterate. */
  loadedCollections?: LoadedCollections;
};

export function TemplateRenderer({
  template,
  item,
  collection,
  currentItem,
  collectionSlugs = [],
  loadedCollections,
}: TemplateRendererProps): ReactNode {
  if (!template) return null;
  const resolved = resolveTemplate(template, item, {
    collectionSlugs,
    currentItem,
    itemDef: collection,
    loadedCollections,
  });
  return <Render config={buildPuckConfig({ variant: "render", collectionSlugs })} data={resolved} />;
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

/** Options bag for `resolveTemplate`. Every field is optional. */
export type ResolveTemplateOptions = {
  /**
   * Collections whose Collection blocks resolve. Empty (the default) for
   * item templates — ADR §4.3 cycle safety.
   */
  collectionSlugs?: ReadonlyArray<string>;
  /** The surrounding template's item. Defaults to `item`. */
  currentItem?: Item;
  /**
   * The def of `item`. Threaded into binding resolution so a binding's
   * `format` can reach field metadata (e.g. a `select` field's option
   * labels). Omit it and `format: "label"` falls back to the raw value.
   */
  itemDef?: CollectionDef;
  /**
   * Items + defs Collection blocks may iterate, keyed by collection slug.
   * Missing means those blocks find no source and render nothing.
   */
  loadedCollections?: LoadedCollections;
};

/**
 * Walk a tree top-down and produce a new one whose block props contain
 * literal values everywhere. Exported for tests and for static-export
 * pipelines that want to resolve once at build time and cache.
 */
export function resolveTemplate(
  template: Template,
  item: Item,
  options: ResolveTemplateOptions = {},
): Template {
  const collectionBlocks = new Set((options.collectionSlugs ?? []).map(blockNameForCollection));
  const ctx: ResolveContext = {
    item,
    currentItem: options.currentItem ?? item,
    itemDef: options.itemDef,
    loadedCollections: options.loadedCollections ?? {},
  };
  return {
    ...template,
    content: resolveBlocks(template.content ?? [], ctx, collectionBlocks) as Template["content"],
  };
}

function resolveBlocks(
  blocks: ReadonlyArray<unknown>,
  ctx: ResolveContext,
  collectionBlocks: ReadonlySet<string>,
): unknown[] {
  const out: unknown[] = [];
  for (const block of blocks) {
    if (!isBlockInstance(block)) {
      // Data, not a block (Gallery's `images: [{ image }]`, ButtonRow's
      // `buttons`) — left untouched.
      out.push(block);
      continue;
    }
    const resolved = resolveBlock(block, ctx, collectionBlocks);
    if (resolved) out.push(resolved);
  }
  return out;
}

function isBlockInstance(value: unknown): value is BlockInstance {
  return (
    !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
  );
}

/**
 * Resolve one block. Returns `null` when a bound prop marked
 * `hidesBlockWhenUnbound` resolves to nothing — the implicit hide-if-empty
 * rule (ADR-009 §4.1).
 */
function resolveBlock(
  block: BlockInstance,
  ctx: ResolveContext,
  collectionBlocks: ReadonlySet<string>,
): BlockInstance | null {
  const props = block.props;
  if (!props || typeof props !== "object") return block;

  if (collectionBlocks.has(block.type)) {
    const resolved = resolveCollectionBlockProps(
      props as Parameters<typeof resolveCollectionBlockProps>[0],
      ctx,
    ) as Record<string, unknown>;
    // Carry the block's `id` onto the resolved props: Puck keys rendered
    // blocks by `props.id`, and the resolver returns only render fields.
    const id = (props as { id?: unknown }).id;
    return { type: block.type, props: id === undefined ? resolved : { id, ...resolved } };
  }

  let next: Record<string, unknown> | undefined;
  const slots = BINDABLE_SLOTS[block.type] ?? {};
  for (const [propName, meta] of Object.entries(slots)) {
    const value = props[propName];
    if (value === undefined) continue;
    const resolved = resolveSlot(value, meta.slotKind, ctx);
    // A binding to an empty string hides like a missing field (no ticket
    // URL → no ticket button); a literal "" is what the author stored and
    // renders as-is.
    const isEmpty =
      resolved === undefined || (resolved === "" && isBindableRef(value) && value.kind === "binding");
    if (isEmpty && meta.hidesBlockWhenUnbound) return null;
    if (resolved !== value) (next ??= { ...props })[propName] = resolved;
  }
  // Recurse into every array of nested blocks. Any prop may be a slot —
  // Section.children, Columns.col1…col4, Stack.children — so the walk is
  // structural rather than per-block.
  for (const [key, value] of Object.entries(props)) {
    if (!Array.isArray(value) || !value.some(isBlockInstance)) continue;
    (next ??= { ...props })[key] = resolveBlocks(value, ctx, collectionBlocks);
  }
  return next ? { ...block, props: next } : block;
}

function resolveSlot(value: unknown, kind: BindableSlotKind, ctx: ResolveContext): unknown {
  // A plain literal resolves to itself — returned by identity so page
  // bodies come out of the walk unchanged.
  if (!isBindableRef(value)) return value;
  switch (kind) {
    case "string":
      return resolveStringBindable(value as Bindable<string>, ctx.item, ctx.itemDef);
    case "image":
      return resolveBindable(value as Bindable<ImageMetadata>, ctx.item, "image");
    case "richText":
      return resolveRichTextBindable(value as Bindable<string>, ctx.item, ctx.itemDef);
  }
}
