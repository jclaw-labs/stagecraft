/**
 * Binding resolution for template props.
 *
 * Templates contain Primitive blocks whose props are typed `Bindable<T>`
 * — each prop is either a literal value of type `T` or a reference to a
 * `FieldId` on the current item. The renderer (`./renderer.tsx`) walks
 * the template, calls these resolvers per-prop, and feeds the resolved
 * values into block components.
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

import type {
  Bindable,
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
export function bindableSchema<T extends z.ZodTypeAny>(inner: T) {
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("literal"), value: inner }),
    z.object({ kind: z.literal("binding"), fieldId: z.string().min(1) }),
  ]);
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
  if (bindable.kind === "literal") {
    return bindable.value;
  }
  return resolveBinding(bindable.fieldId, item, expectedType);
}

/**
 * Resolve a binding (just the fieldId, no literal case) to the typed
 * value. Same contract as `resolveBindable` for the binding arm —
 * returns `undefined` if missing or type-mismatched.
 *
 * Useful for the field-render primitives (RichTextRender,
 * PuckContentRender) where the prop is *always* a fieldId, never a
 * literal.
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
): string | undefined {
  if (bindable.kind === "literal") return bindable.value;
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
  return (value as { value: string }).value;
}

// ---------------------------------------------------------------------------
// Construction helpers — useful for tests, default props, and the
// editor (PR 6) when generating template scaffolding.
// ---------------------------------------------------------------------------

/** Wrap a literal value as a `Bindable<T>` in the "literal" arm. */
export const literal = <T>(value: T): Bindable<T> => ({ kind: "literal", value });

/** Build a `Bindable<T>` in the "binding" arm. */
export const binding = <T>(fieldId: FieldId): Bindable<T> => ({ kind: "binding", fieldId });
