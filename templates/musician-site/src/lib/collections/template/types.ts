/**
 * Shared types for the template-renderer module.
 *
 * A `Template` is the Puck JSON stored on `CollectionDef.itemTemplate`,
 * `detailTemplate`, or `listTemplate`. The shape mirrors Puck's `Data`
 * but we keep it loose at the boundary — the renderer walks `content`
 * and dispatches each entry to a block component by `type`.
 */

import type { Data as PuckData } from "@puckeditor/core";

import type { Bindable, CollectionDef, FieldId, Item } from "../schema";

/** One block instance inside a template. Maps to one rendered React element. */
export type BlockInstance = {
  type: string;
  props: Record<string, unknown>;
};

/** Convenience re-export so consumers don't have to reach into @puckeditor/core. */
export type Template = PuckData;

/**
 * Props passed by the artist (literal) or bound to a field. Bindable
 * props arrive at the block component with the same shape as on disk;
 * the component calls `resolveBindable(prop, item, expectedType)` to
 * get the runtime value.
 */
export type { Bindable, FieldId };

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
