/**
 * Binding resolution for block props.
 *
 * Blocks that can show item data type those props `Bindable<T>` — each
 * prop is a plain literal `T` (page bodies), an explicit
 * `{ kind: "literal" }` wrapper, or a reference to a `FieldId` on the
 * current item (templates). The renderer (`./renderer.tsx`) walks the
 * tree, calls these resolvers per-prop, and feeds the resolved values
 * into block components.
 *
 * **The contract:** a binding to a field that doesn't exist on the item,
 * or whose type doesn't match what the block expects, resolves to
 * `undefined`. Blocks treat `undefined` as "render nothing" (the
 * implicit hide-if-empty rule from ADR-009 §4.1). Type-incompatible
 * bindings are an authoring bug — the editor (PR 6) enforces type
 * compatibility at authoring time, so reaching the wrong-type branch
 * here means someone hand-edited a JSON file. We log a warning and
 * return `undefined` so the public site fails safe rather than crashing.
 */

import type { Data as PuckData } from "@measured/puck";
import { z } from "zod";

import type { ImageMetadata } from "../../image-types";
import { selectOptionLabel } from "../accessors";

import type {
  Bindable,
  BindableFormat,
  BindableRef,
  CollectionDef,
  CollectionRefValue,
  FieldId,
  FileRef,
  Item,
  TiptapJSON,
} from "../schema";

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

/**
 * Schema for a `Bindable<T>` on disk. Parameterised on the inner shape
 * so each block's field can specify its expected literal type.
 *
 * Validating the on-disk shape isn't strictly needed for the renderer
 * (it trusts the editor), but it's useful in tests and gives the
 * template-editor PR a ready-made validator.
 */
/** Zod enum mirroring the `BindableFormat` union in `schema.ts`. */
export const bindableFormatSchema = z.enum(["year", "weekday-day", "full", "label"]);

export function bindableSchema<T extends z.ZodTypeAny>(inner: T) {
  return z.union([
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("literal"), value: inner }),
      z.object({
        kind: z.literal("binding"),
        fieldId: z.string().min(1),
        format: bindableFormatSchema.optional(),
      }),
    ]),
    inner,
  ]);
}

/**
 * Whether a prop value is the object form of a `Bindable<T>` rather than a
 * plain literal. No literal a block takes (strings, `ImageMetadata`, Tiptap
 * docs, null) carries a `kind` key, so the check can't misfire on one.
 */
export function isBindableRef(value: unknown): value is BindableRef<unknown> {
  if (value === null || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "literal") return "value" in value;
  if (kind === "binding") return typeof (value as { fieldId?: unknown }).fieldId === "string";
  return false;
}

/** Normalise a `Bindable<T>` to its object form (plain literals get wrapped). */
export function toBindableRef<T>(value: Bindable<T>): BindableRef<T> {
  return isBindableRef(value) ? (value as BindableRef<T>) : { kind: "literal", value: value as T };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Map from each FieldValue kind to the resolved scalar type it produces.
 * Used by `resolveBindable` to validate at runtime that the bound field
 * matches the prop's expected type.
 */
type ResolvedTypeFor = {
  text: string;
  longText: string;
  richText: TiptapJSON;
  number: number;
  boolean: boolean;
  select: string;
  multiSelect: string[];
  date: string;
  url: string;
  email: string;
  color: string;
  image: ImageMetadata;
  file: FileRef;
  collectionRef: CollectionRefValue;
  multiCollectionRef: string[];
  puckContent: PuckData;
};

/**
 * Resolve a `Bindable<T>` against the current item.
 *
 * The `expectedType` is the FieldValue kind the block expects. Literals
 * bypass the check (they're already type `T`). Bindings are looked up
 * on the item; a missing field or a type mismatch returns `undefined`.
 */
export function resolveBindable<K extends keyof ResolvedTypeFor>(
  bindable: Bindable<ResolvedTypeFor[K]>,
  item: Item,
  expectedType: K,
): ResolvedTypeFor[K] | undefined {
  const ref = toBindableRef(bindable);
  if (ref.kind === "literal") {
    return ref.value;
  }
  return resolveBinding(ref.fieldId, item, expectedType);
}

/**
 * Resolve a binding (just the fieldId, no literal case) to the typed
 * value. Same contract as `resolveBindable` for the binding arm —
 * returns `undefined` if missing or type-mismatched.
 *
 * Useful where a value is *always* a field reference, never a literal.
 */
export function resolveBinding<K extends keyof ResolvedTypeFor>(
  fieldId: FieldId,
  item: Item,
  expectedType: K,
): ResolvedTypeFor[K] | undefined {
  const value = item.values[fieldId];
  if (value === undefined) return undefined;
  if (value.type !== expectedType) {
    if (typeof console !== "undefined") {
      // Authoring bug: a binding points at a field of the wrong type.
      // Surface in dev so it's noticed; fail safe in prod.
      console.warn(
        `[collections] field ${fieldId} on item ${item.id} is type "${value.type}", ` +
          `expected "${expectedType}" — binding resolved to undefined`,
      );
    }
    return undefined;
  }
  // The narrowing has been verified above (value.type === expectedType).
  // TypeScript can't follow the narrowing through the generic K, so cast
  // through unknown — same pattern as the typed accessors in
  // `../accessors.ts`.
  return (value as { value: unknown }).value as ResolvedTypeFor[K];
}

/**
 * Field-value kinds whose value is a plain string and so can render as
 * one inside a Text / Button / Link / Image-alt block.
 *
 * The editor (PR 6) constrains a Text block's binding picker to show
 * only fields of these types. At runtime we re-check defensively: a
 * field whose type isn't on this list resolves to `undefined` (and
 * warns).
 *
 * **Adding a new string-valued field type:** keep this list in sync.
 * Adding a `phoneNumber` field type, for example, should also append
 * `"phoneNumber"` here so Text blocks can bind to it. The static
 * check in tests doesn't catch a missing entry — be deliberate.
 */
export const STRING_VALUED_FIELD_TYPES = [
  "text",
  "longText",
  "date",
  "url",
  "email",
  "color",
  "select",
] as const;
type StringValuedType = (typeof STRING_VALUED_FIELD_TYPES)[number];

/**
 * Resolve a `Bindable<string>` whose binding may target any string-
 * valued field type. The "string-valued" set is defined above. Use
 * this from any primitive whose content surface is rendered as text
 * (Text, Button label, Link label, Image alt-override).
 */
export function resolveStringBindable(
  bindable: Bindable<string>,
  item: Item,
  itemDef?: CollectionDef,
): string | undefined {
  const ref = toBindableRef(bindable);
  if (ref.kind === "literal") return ref.value;
  return resolveStringBinding(ref, item, itemDef);
}

function resolveStringBinding(
  bindable: Extract<BindableRef<string>, { kind: "binding" }>,
  item: Item,
  itemDef?: CollectionDef,
): string | undefined {
  const value = item.values[bindable.fieldId];
  if (value === undefined) return undefined;
  if (!STRING_VALUED_FIELD_TYPES.includes(value.type as StringValuedType)) {
    if (typeof console !== "undefined") {
      console.warn(
        `[collections] field ${bindable.fieldId} on item ${item.id} is type "${value.type}", ` +
          `expected one of [${STRING_VALUED_FIELD_TYPES.join(", ")}] — binding resolved to undefined`,
      );
    }
    return undefined;
  }
  const raw = (value as { value: string }).value;
  if (bindable.format === undefined) return raw;
  return formatBoundString(
    raw,
    value.type as StringValuedType,
    bindable.format,
    bindable.fieldId,
    itemDef,
  );
}

/**
 * Apply a `BindableFormat` to an already-resolved string. Date presets format
 * the ISO value in UTC; `label` maps a `select` value to its option label
 * (needs `itemDef` for the option list). Any mismatch — a date format on a
 * non-date field, an unparseable date, a missing def, or a select value with
 * no matching option — falls back to the raw value. Formatting is
 * presentational; it never blanks a binding the way a type mismatch does.
 */
function formatBoundString(
  raw: string,
  fieldType: StringValuedType,
  format: BindableFormat,
  fieldId: FieldId,
  itemDef: CollectionDef | undefined,
): string {
  if (format === "label") {
    if (fieldType !== "select") return raw;
    const field = itemDef?.fields.find((f) => f.id === fieldId);
    if (field?.type !== "select") return raw;
    return selectOptionLabel(field, raw);
  }
  // Date presets (year / weekday-day / full).
  if (fieldType !== "date") return raw;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return raw;
  const d = new Date(ms);
  switch (format) {
    case "year":
      return String(d.getUTCFullYear());
    case "weekday-day":
      return d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    case "full":
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
    default:
      return raw;
  }
}

/**
 * Resolve a `Bindable<string | TiptapJSON>` — the RichText block's text. A
 * literal is the paragraph text a page stores; a binding may point at a
 * `richText` field (resolves to its Tiptap doc) or at any string-valued field
 * (resolves like `resolveStringBindable`, so a longText bio can fill a
 * RichText block).
 */
export function resolveRichTextBindable(
  bindable: Bindable<string | TiptapJSON>,
  item: Item,
  itemDef?: CollectionDef,
): string | TiptapJSON | undefined {
  const ref = toBindableRef(bindable);
  if (ref.kind === "literal") return ref.value;
  const value = item.values[ref.fieldId];
  if (value?.type === "richText") return value.value;
  return resolveStringBinding(ref, item, itemDef);
}

// ---------------------------------------------------------------------------
// Construction helpers — useful for tests, default props, and the
// editor (PR 6) when generating template scaffolding.
// ---------------------------------------------------------------------------

/** Wrap a literal value as a `Bindable<T>` in the "literal" arm. */
export const literal = <T>(value: T): Bindable<T> => ({ kind: "literal", value });

/** Build a `Bindable<T>` in the "binding" arm. */
export const binding = <T>(fieldId: FieldId): Bindable<T> => ({ kind: "binding", fieldId });
