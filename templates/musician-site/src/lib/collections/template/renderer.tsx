/**
 * The template walker: resolves a block tree against an item.
 *
 * `resolveTemplate` walks `template.content` top-down. Each block's
 * bindable props (`BINDABLE_SLOTS`) resolve against `item`; a Collection
 * block resolves its items from `loadedCollections`. Every array of nested
 * blocks (Section.children, Columns.col1, …) is walked the same way. The
 * result is a tree of plain literal props, which `<Render>` draws with the
 * render config from `@/puck/render-config` (`TemplateRenderer` there does
 * both steps).
 *
 * Pages, templates and item bodies all go through this one walker and one
 * block library (#349): a page body is a tree whose bindable props happen
 * to hold plain literals, which pass through unchanged.
 *
 * Resolution and rendering are decoupled: block components never see a
 * binding, never reach into the current item, and don't need
 * `"use client"`. This module renders nothing itself, so it imports no
 * Puck config and sits below the render config in the import graph.
 *
 * The walker also warns, outside production, on a block type the library
 * doesn't know and on a Section width outside `SECTION_WIDTHS`. Both are
 * what content written in the pre-#349 vocabulary looks like when
 * `scripts/migrate-block-library.mjs` hasn't been run over it; they render
 * nothing or full-width rather than failing.
 */

import { BLOCKS, SECTION_WIDTHS } from "@/puck/config";

import { BINDABLE_SLOTS, type BindableSlotKind } from "./bindable-slots";
import {
  isBindableRef,
  resolveBindable,
  resolveRichTextBindable,
  resolveStringBindable,
} from "./binding";
import { blockNameForCollection, resolveCollectionBlockProps } from "./collection-block";
import type { BlockInstance, LoadedCollections, ResolveContext, Template } from "./types";
import type { Bindable, CollectionDef, Item } from "../schema";
import type { ImageMetadata } from "../../image-types";

export type { LoadedCollections, ResolveContext };

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

function isDeclaredArrayField(blockType: string, propName: string): boolean {
  const fields = (BLOCKS as Record<string, { fields?: Record<string, { type?: unknown }> }>)[
    blockType
  ]?.fields;
  return fields?.[propName]?.type === "array";
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
  warnOnUnmigratedBlock(block, collectionBlocks);
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
  // structural rather than per-block. A prop the library declares as a
  // Puck `array` field is data, even when its rows carry a `type`
  // (NewsletterSignup's `additionalFields: [{ name, type: "text" }]`).
  for (const [key, value] of Object.entries(props)) {
    if (!Array.isArray(value) || !value.some(isBlockInstance)) continue;
    if (isDeclaredArrayField(block.type, key)) continue;
    (next ??= { ...props })[key] = resolveBlocks(value, ctx, collectionBlocks);
  }
  return next ? { ...block, props: next } : block;
}

// ---------------------------------------------------------------------------
// Unmigrated content
// ---------------------------------------------------------------------------

const LIBRARY_BLOCKS: ReadonlySet<string> = new Set(Object.keys(BLOCKS));
const KNOWN_SECTION_WIDTHS: ReadonlySet<unknown> = new Set(SECTION_WIDTHS);
const warnedUnmigrated = new Set<string>();

/**
 * Warn (once per message, outside production) when a block is something the
 * library can't draw: a type it doesn't know, or a Section width outside
 * `SECTION_WIDTHS`. Old-vocabulary content (`RichTextRender`, Section
 * `narrow` / `default` / `wide`) lands here when
 * `scripts/migrate-block-library.mjs` hasn't been run over it, and would
 * otherwise vanish or go full-width without a trace. A Collection block the
 * caller didn't allow (one inside an item template, or for a collection that
 * no longer exists) is unknown here too, and renders nothing for the same
 * reason. The render itself is unchanged.
 */
function warnOnUnmigratedBlock(block: BlockInstance, collectionBlocks: ReadonlySet<string>): void {
  if (process.env.NODE_ENV === "production") return;
  if (!LIBRARY_BLOCKS.has(block.type) && !collectionBlocks.has(block.type)) {
    warnUnmigratedOnce(
      `unknown block type "${block.type}" — it renders nothing. If it's from the old ` +
        `template vocabulary, run scripts/migrate-block-library.mjs over the content.`,
    );
    return;
  }
  const width = (block.props as { width?: unknown } | undefined)?.width;
  if (block.type === "Section" && width !== undefined && !KNOWN_SECTION_WIDTHS.has(width)) {
    warnUnmigratedOnce(
      `Section width ${JSON.stringify(width)} isn't one of ${SECTION_WIDTHS.join(" / ")} — ` +
        `it renders full-width. If it's from the old template vocabulary, run ` +
        `scripts/migrate-block-library.mjs over the content.`,
    );
  }
}

function warnUnmigratedOnce(message: string): void {
  if (warnedUnmigrated.has(message)) return;
  warnedUnmigrated.add(message);
  console.warn(`[collections] resolveTemplate: ${message}`);
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
