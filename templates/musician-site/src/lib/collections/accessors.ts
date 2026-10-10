/**
 * Runtime-narrowing accessors for `Item.values`.
 *
 * Because the schema is editable at runtime by the artist, `Item.values`
 * is typed as `Record<FieldId, FieldValue>` — a discriminated union over
 * value kinds, but no compile-time guarantee that a given field exists
 * with the expected type. These accessors fill the ergonomic gap by
 * doing the runtime check and returning a narrowed value:
 *
 *   const venue = getText(item, "fld_venue");      // string, or throws
 *   const date  = getDate(item, "fld_date");       // string (ISO), or throws
 *   const cover = getImageOrNull(item, "fld_img"); // ImageMetadata | null
 *
 * The throwing variants are for required fields where the caller would
 * crash anyway on `undefined`. The `*OrNull` variants are for optional
 * fields where the caller has a meaningful no-value path.
 *
 * Type mismatches (e.g. asking for text on an image-typed field) always
 * throw — that's a programmer error in the consumer, not authoring
 * data.
 *
 * The PR-2 template renderer is the heaviest consumer and ships its own
 * resolution paths for `Bindable<T>` props; these helpers are for
 * hand-coded blocks and route handlers that read specific fields by id.
 */

import type { Data as PuckData } from "@puckeditor/core";

import type { ImageMetadata } from "../image-types";

import type {
  CollectionDef,
  CollectionRefValue,
  FieldDef,
  FieldId,
  FieldValue,
  FileRef,
  Item,
  TiptapJSON,
} from "./schema";

export class FieldAccessError extends Error {
  constructor(
    public itemId: string,
    public fieldId: FieldId,
    public reason: "missing" | "wrong-type",
    public expectedType: string,
    public actualType?: string,
  ) {
    super(
      reason === "missing"
        ? `Item ${itemId} has no value for field ${fieldId} (expected ${expectedType})`
        : `Item ${itemId} field ${fieldId} is type ${actualType}, expected ${expectedType}`,
    );
    this.name = "FieldAccessError";
  }
}

/**
 * Map from a value-kind discriminator to its value type. The `K extends K`
 * pattern forces TypeScript to distribute across the union of K values
 * so the result is a single value type, not an intersection — without
 * this, `ValueFor<"text">` resolves to `string & TiptapJSON & ...` (i.e.
 * `never`).
 */
type ValueFor<K extends FieldValue["type"]> = K extends K
  ? Extract<FieldValue, { type: K }>["value"]
  : never;

/**
 * Generic accessor — the building block for the typed variants. Most
 * callers should reach for `getText`, `getNumber`, etc. instead.
 */
function getTyped<K extends FieldValue["type"]>(
  item: Item,
  fieldId: FieldId,
  expectedType: K,
): ValueFor<K> {
  const fv = item.values[fieldId];
  if (fv === undefined) {
    throw new FieldAccessError(item.id, fieldId, "missing", expectedType);
  }
  if (fv.type !== expectedType) {
    throw new FieldAccessError(item.id, fieldId, "wrong-type", expectedType, fv.type);
  }
  return fv.value as ValueFor<K>;
}

function getTypedOrNull<K extends FieldValue["type"]>(
  item: Item,
  fieldId: FieldId,
  expectedType: K,
): ValueFor<K> | null {
  const fv = item.values[fieldId];
  if (fv === undefined) return null;
  if (fv.type !== expectedType) {
    throw new FieldAccessError(item.id, fieldId, "wrong-type", expectedType, fv.type);
  }
  return fv.value as ValueFor<K>;
}

// ---------------------------------------------------------------------------
// Typed accessors, one pair per FieldValue kind.
// ---------------------------------------------------------------------------

export const getText = (i: Item, f: FieldId): string => getTyped(i, f, "text");
export const getTextOrNull = (i: Item, f: FieldId): string | null => getTypedOrNull(i, f, "text");

export const getLongText = (i: Item, f: FieldId): string => getTyped(i, f, "longText");
export const getLongTextOrNull = (i: Item, f: FieldId): string | null =>
  getTypedOrNull(i, f, "longText");

export const getRichText = (i: Item, f: FieldId): TiptapJSON => getTyped(i, f, "richText");
export const getRichTextOrNull = (i: Item, f: FieldId): TiptapJSON | null =>
  getTypedOrNull(i, f, "richText");

export const getNumber = (i: Item, f: FieldId): number => getTyped(i, f, "number");
export const getNumberOrNull = (i: Item, f: FieldId): number | null =>
  getTypedOrNull(i, f, "number");

export const getBoolean = (i: Item, f: FieldId): boolean => getTyped(i, f, "boolean");

export const getSelect = (i: Item, f: FieldId): string => getTyped(i, f, "select");
export const getSelectOrNull = (i: Item, f: FieldId): string | null =>
  getTypedOrNull(i, f, "select");

export const getMultiSelect = (i: Item, f: FieldId): string[] => getTyped(i, f, "multiSelect");

export const getDate = (i: Item, f: FieldId): string => getTyped(i, f, "date");
export const getDateOrNull = (i: Item, f: FieldId): string | null => getTypedOrNull(i, f, "date");

export const getUrl = (i: Item, f: FieldId): string => getTyped(i, f, "url");
export const getUrlOrNull = (i: Item, f: FieldId): string | null => getTypedOrNull(i, f, "url");

export const getEmail = (i: Item, f: FieldId): string => getTyped(i, f, "email");
export const getEmailOrNull = (i: Item, f: FieldId): string | null =>
  getTypedOrNull(i, f, "email");

export const getColor = (i: Item, f: FieldId): string => getTyped(i, f, "color");
export const getColorOrNull = (i: Item, f: FieldId): string | null =>
  getTypedOrNull(i, f, "color");

export const getImage = (i: Item, f: FieldId): ImageMetadata => getTyped(i, f, "image");
export const getImageOrNull = (i: Item, f: FieldId): ImageMetadata | null =>
  getTypedOrNull(i, f, "image");

export const getFile = (i: Item, f: FieldId): FileRef => getTyped(i, f, "file");
export const getFileOrNull = (i: Item, f: FieldId): FileRef | null => getTypedOrNull(i, f, "file");

export const getCollectionRef = (i: Item, f: FieldId): CollectionRefValue =>
  getTyped(i, f, "collectionRef");
export const getCollectionRefOrNull = (i: Item, f: FieldId): CollectionRefValue | null =>
  getTypedOrNull(i, f, "collectionRef");

export const getMultiCollectionRef = (i: Item, f: FieldId): string[] =>
  getTyped(i, f, "multiCollectionRef");

export const getPuckContent = (i: Item, f: FieldId): PuckData => getTyped(i, f, "puckContent");
export const getPuckContentOrNull = (i: Item, f: FieldId): PuckData | null =>
  getTypedOrNull(i, f, "puckContent");

// ---------------------------------------------------------------------------
// Untyped access (rare; prefer the typed variants above).
// ---------------------------------------------------------------------------

export const hasField = (i: Item, f: FieldId): boolean => f in i.values;
export const getFieldValue = (i: Item, f: FieldId): FieldValue | undefined => i.values[f];

// ---------------------------------------------------------------------------
// Display label
// ---------------------------------------------------------------------------

/**
 * Human-facing label for an item — the value of its `slugSourceFieldId`
 * (e.g. a page's title, "About Us"), falling back to the slug when the
 * collection has no slug source, the field is missing, or it's empty.
 * Used by the admin list views and the publish modal so an artist reads
 * names, not slugs. Never throws — `slugSourceFieldId` is a text field
 * by schema, but this tolerates drift (wrong type / absent) by falling
 * back to the slug rather than raising.
 */
export function itemDisplayLabel(def: CollectionDef, item: Item): string {
  if (def.slugSourceFieldId) {
    const fv = item.values[def.slugSourceFieldId];
    if (fv && fv.type === "text" && fv.value.trim()) return fv.value.trim();
  }
  return item.slug;
}

/**
 * Artist-facing label for a stored `select` / `multiSelect` value (e.g.
 * `"on_sale"` → `"On sale"`). Falls back to the raw value when the field
 * isn't a select or no option matches — an option the artist deleted
 * after items were saved still shows something rather than nothing.
 */
export function selectOptionLabel(field: FieldDef | undefined, value: string): string {
  if (field?.type !== "select" && field?.type !== "multiSelect") return value;
  return field.options.find((o) => o.value === value)?.label ?? value;
}
