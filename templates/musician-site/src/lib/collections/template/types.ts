/**
 * Shared types for the template-renderer module.
 *
 * A `Template` is the Puck JSON stored on `CollectionDef.itemTemplate`,
 * `detailTemplate`, or `listTemplate`. The shape mirrors Puck's `Data`
 * but we keep it loose at the boundary — the renderer walks `content`
 * and dispatches each entry to a block component by `type`.
 */

import type { Data as PuckData } from "@measured/puck";

import type { Bindable, FieldId } from "../schema";

/** One block instance inside a template. Maps to one rendered React element. */
export type BlockInstance = {
  type: string;
  props: Record<string, unknown>;
};

/** Convenience re-export so consumers don't have to reach into @measured/puck. */
export type Template = PuckData;

/**
 * Props passed by the artist (literal) or bound to a field. Bindable
 * props arrive at the block component with the same shape as on disk;
 * the component calls `resolveBindable(prop, item, expectedType)` to
 * get the runtime value.
 */
export type { Bindable, FieldId };
