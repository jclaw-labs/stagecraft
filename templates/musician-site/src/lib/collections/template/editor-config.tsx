/**
 * Binding-aware Puck `Config` for template authoring (ADR-009 PR 6).
 *
 * Sits next to `puck-config.ts` (used by the public template
 * renderer). Where the public config exposes block props as plain
 * literal fields, the editor config wraps each bindable prop with a
 * `BindablePicker` custom field that lets the artist toggle each prop
 * between "literal value" and "bound to a field on this collection".
 *
 * The shape stored on disk matches what the walker expects: each
 * bindable prop value is a `Bindable<T>` discriminated union, not a
 * raw literal. The public renderer (PR 2) resolves these against the
 * current item at render time.
 *
 * Important asymmetry: this config is *only* for the template editor.
 * Per-item puckContent editing (e.g. authoring a specific page's
 * body) uses the public config directly — there's no "current item"
 * to bind against when authoring a single item's body.
 */

import type { Bindable, CollectionDef, FieldDef, FieldType } from "../schema";

import { STRING_VALUED_FIELD_TYPES } from "./binding";

/**
 * Fields whose value can be bound to a `Bindable<string>` prop (Text
 * content, Button label, Link label, Image alt override, …).
 *
 * Mirrors `STRING_VALUED_FIELD_TYPES` from `binding.ts` — duplicated
 * as a `ReadonlySet<FieldType>` because callers want set-membership
 * checks, not array-includes against a narrow tuple type.
 */
const STRING_BINDABLE_FIELD_TYPES: ReadonlySet<FieldType> = new Set(
  STRING_VALUED_FIELD_TYPES,
);

/** Fields bindable to a `Bindable<ImageMetadata>` prop (Image src). */
const IMAGE_BINDABLE_FIELD_TYPES: ReadonlySet<FieldType> = new Set(["image"]);

/**
 * Per-T list of fields a `Bindable<T>` slot can accept.
 *
 * Adding a new `T`: extend the union here + plug the matching set
 * lookup into `compatibleFields` below.
 */
export type BindableSlotKind = "string" | "image";

export function compatibleFields(
  kind: BindableSlotKind,
  fields: ReadonlyArray<FieldDef>,
): FieldDef[] {
  const allowed =
    kind === "string" ? STRING_BINDABLE_FIELD_TYPES : IMAGE_BINDABLE_FIELD_TYPES;
  return fields.filter((f) => allowed.has(f.type));
}

/**
 * Default Bindable<T> value when adding a brand-new prop instance.
 * Starts in literal mode so the editor isn't immediately constrained
 * to a specific field choice.
 */
export function defaultBindable<T>(literal: T): Bindable<T> {
  return { kind: "literal", value: literal };
}

/**
 * What we hand Puck as the per-block `fields` config in the editor.
 *
 * Each bindable prop becomes a `custom` field; Puck calls the
 * supplied `render` with the current value + an onChange. The
 * `render` is loaded lazily from a client file so server components
 * importing this module don't pull in the React-DOM client deps.
 */
export type BindableSlotMeta = {
  /** "string" → Text-like fields; "image" → image fields. */
  slotKind: BindableSlotKind;
  /** Default literal value when the artist hasn't authored one. */
  defaultLiteral: unknown;
  /** Help text shown under the field in the inspector. */
  description?: string;
};

/**
 * Per-block slot metadata. Keyed by block name → field name.
 *
 * Kept here (not on `PRIMITIVE_BLOCKS`) so the public-renderer
 * registry stays free of editor-only metadata. The editor config
 * builder reads this to decide which fields need the custom
 * BindablePicker treatment.
 */
export const BINDABLE_SLOTS: Readonly<
  Record<string, Readonly<Record<string, BindableSlotMeta>>>
> = Object.freeze({
  Text: {
    content: { slotKind: "string", defaultLiteral: "Text", description: "What this text reads." },
  },
  Image: {
    src: { slotKind: "image", defaultLiteral: null, description: "Which image to show." },
    altOverride: {
      slotKind: "string",
      defaultLiteral: "",
      description: "Override the image's stored alt text. Leave literal blank to use the upload's alt.",
    },
  },
  Button: {
    label: { slotKind: "string", defaultLiteral: "Click me" },
    href: { slotKind: "string", defaultLiteral: "#" },
  },
  Link: {
    label: { slotKind: "string", defaultLiteral: "Read more" },
    href: { slotKind: "string", defaultLiteral: "#" },
  },
  // RichTextRender's `field` is a plain field id (not a Bindable<T>),
  // so it doesn't show up here — see `RICH_FIELDS` below.
});

/**
 * Per-block raw-field-id slot metadata. Used by RichTextRender +
 * future PuckContentRender — blocks whose entire purpose is to embed
 * a single field at this position. The picker for these is "which
 * field" only (no literal mode).
 */
export const RICH_FIELDS: Readonly<
  Record<string, Readonly<Record<string, { fieldType: FieldType; description?: string }>>>
> = Object.freeze({
  RichTextRender: {
    field: {
      fieldType: "richText",
      description: "Which richText field to render here.",
    },
  },
});

/**
 * Build the per-collection editor config. The fields registered here
 * are the *editor* surface; what's stored on disk is exactly the
 * shape the walker (PR 2) consumes, so the renderer doesn't change.
 *
 * `def` is the collection whose template is being edited — used to
 * populate the "which field" dropdowns in BindablePicker.
 */
export function getCollectionContextForEditor(def: CollectionDef): {
  stringFields: FieldDef[];
  imageFields: FieldDef[];
  richTextFields: FieldDef[];
} {
  return {
    stringFields: compatibleFields("string", def.fields),
    imageFields: compatibleFields("image", def.fields),
    richTextFields: def.fields.filter((f) => f.type === "richText"),
  };
}
