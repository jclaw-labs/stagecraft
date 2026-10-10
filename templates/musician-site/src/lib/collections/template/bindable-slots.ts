/**
 * Which block props take a `Bindable<T>` (ADR-009 §4, #349).
 *
 * One table, read by three consumers:
 *
 *   - the walker (`renderer.tsx`) resolves exactly these props against the
 *     current item and applies the hide-if-empty rule;
 *   - the template editor (`buildPuckConfig`'s template surfaces) swaps
 *     these props' plain fields for `BindablePicker` fields;
 *   - `schema-changes.ts` checks these props' bindings when a schema edit
 *     would orphan or retype a bound field.
 *
 * Every other prop on every block is a plain literal. Block names are the
 * block library's (`src/puck/config.tsx`). Node- and React-free so the
 * walker and the schema validator can import it anywhere.
 */

import type { CollectionDef, FieldDef, FieldType } from "../schema";

import { STRING_VALUED_FIELD_TYPES } from "./binding";

/**
 * What a bindable prop resolves to, which decides the fields it can bind:
 *
 *   - `string`   — text, longText, date, url, email, color, select
 *   - `image`    — image
 *   - `richText` — richText (rendered as a Tiptap doc) or any `string` field
 *                  (rendered as paragraphs)
 */
export type BindableSlotKind = "string" | "image" | "richText";

const STRING_BINDABLE_FIELD_TYPES: ReadonlySet<FieldType> = new Set(STRING_VALUED_FIELD_TYPES);

const SLOT_FIELD_TYPES: Readonly<Record<BindableSlotKind, ReadonlySet<FieldType>>> = {
  string: STRING_BINDABLE_FIELD_TYPES,
  image: new Set(["image"]),
  richText: new Set<FieldType>(["richText", ...STRING_VALUED_FIELD_TYPES]),
};

/** Whether a field of type `type` can fill a `kind` slot. */
export function isFieldTypeCompatible(kind: BindableSlotKind, type: FieldType): boolean {
  return SLOT_FIELD_TYPES[kind].has(type);
}

export function compatibleFields(
  kind: BindableSlotKind,
  fields: ReadonlyArray<FieldDef>,
): FieldDef[] {
  return fields.filter((f) => isFieldTypeCompatible(kind, f.type));
}

export type BindableSlotMeta = {
  slotKind: BindableSlotKind;
  /** Help text shown above the picker in the template editor. */
  description?: string;
  /**
   * Implicit hide-if-empty (ADR-009 §4.1): when this prop is *bound* and the
   * binding resolves to nothing, the walker drops the whole block. Plain
   * literals never hide a block, so page bodies render exactly what they
   * store.
   */
  hidesBlockWhenUnbound: boolean;
};

/** Block name → prop name → slot metadata. */
export const BINDABLE_SLOTS: Readonly<
  Record<string, Readonly<Record<string, BindableSlotMeta>>>
> = Object.freeze({
  Text: {
    content: { slotKind: "string", description: "What this text reads.", hidesBlockWhenUnbound: true },
  },
  RichText: {
    text: {
      slotKind: "richText",
      description: "The paragraphs, or a rich-text / text field to show here.",
      hidesBlockWhenUnbound: true,
    },
  },
  Image: {
    image: { slotKind: "image", description: "Which image to show.", hidesBlockWhenUnbound: true },
    altOverride: {
      slotKind: "string",
      description: "Override the image's stored alt text. Leave blank to use the upload's alt.",
      hidesBlockWhenUnbound: false,
    },
  },
  Button: {
    text: { slotKind: "string", hidesBlockWhenUnbound: true },
    href: { slotKind: "string", hidesBlockWhenUnbound: true },
  },
  Link: {
    label: { slotKind: "string", hidesBlockWhenUnbound: true },
    href: { slotKind: "string", hidesBlockWhenUnbound: true },
  },
});

/** The fields of `def` each slot kind can bind to — feeds the template editor's pickers. */
export function bindableFieldsByKind(
  def: CollectionDef,
): Readonly<Record<BindableSlotKind, FieldDef[]>> {
  return {
    string: compatibleFields("string", def.fields),
    image: compatibleFields("image", def.fields),
    richText: compatibleFields("richText", def.fields),
  };
}
