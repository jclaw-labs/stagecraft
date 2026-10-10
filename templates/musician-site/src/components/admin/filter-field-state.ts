/**
 * Pure helpers backing `FilterField.tsx`'s visual clause builder.
 *
 * The Filter shape itself is the SSOT (`filter-schema.ts`); these
 * helpers convert between it and the UI's editor state, plus morph
 * clauses across operator changes without losing the artist's
 * already-typed value.
 *
 * Lives in a separate file (no `"use client"`, no React) so the
 * visual ↔ serialized round-trip can be unit-tested without rendering.
 */

import type {
  Filter,
  FilterClause,
  FilterValue,
} from "@/lib/collections/filter-schema";
import type { CollectionDef, FieldDef, FieldType } from "@/lib/collections";
import { clauseWithoutMissingFields, mapClauseFields } from "@/lib/collections/template/filter";
import { viewFieldIdFor } from "@/lib/collections/template/view-requirements";

/**
 * Op token shown in the operator picker. Adds an `excludeCurrentItem`
 * pseudo-op for the field-less `{ excludeCurrentItem: true }` clause
 * shape — collapsing that case into the same picker keeps the row UI
 * uniform.
 */
export type ClauseOp =
  | "equals"
  | "notEquals"
  | "in"
  | "notIn"
  | "isEmpty"
  | "isNotEmpty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "excludeCurrentItem";

/**
 * Display order + artist-facing labels for the operator picker.
 * Mathematical operators use the symbol form (`≥`, `<`) because
 * the row is narrow and the verbose form crowds the value editor.
 */
export const CLAUSE_OPS: ReadonlyArray<{ value: ClauseOp; label: string }> = [
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "in", label: "is one of" },
  { value: "notIn", label: "is not one of" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "isEmpty", label: "is empty" },
  { value: "isNotEmpty", label: "is not empty" },
  { value: "excludeCurrentItem", label: "exclude current item" },
];

/**
 * Whether a clause carries one `value`, an array of `values`, or no
 * value at all. Drives the row UI: which value editor(s) to render.
 */
export type ClauseValueShape = "single" | "array" | "none" | "excludeCurrent";

export function clauseValueShape(op: ClauseOp): ClauseValueShape {
  switch (op) {
    case "equals":
    case "notEquals":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "contains":
      return "single";
    case "in":
    case "notIn":
      return "array";
    case "isEmpty":
    case "isNotEmpty":
      return "none";
    case "excludeCurrentItem":
      return "excludeCurrent";
  }
}

/** Pull the `op` discriminator out of a clause shape. */
export function clauseToOp(clause: FilterClause): ClauseOp {
  if ("excludeCurrentItem" in clause) return "excludeCurrentItem";
  return clause.op;
}

/**
 * Type guard: clause is one of the field-bearing arms (everything
 * except `{ excludeCurrentItem: true }`). Narrowing lets call sites
 * read `clause.field` without an `as` cast.
 */
export function isFieldBearingClause(
  clause: FilterClause,
): clause is Exclude<FilterClause, { excludeCurrentItem: true }> {
  return !("excludeCurrentItem" in clause);
}

/** Type guard: clause carries a single `value: FilterValue`. */
export function isSingleValueClause(
  clause: FilterClause,
): clause is Extract<FilterClause, { value: FilterValue }> {
  return isFieldBearingClause(clause) && "value" in clause;
}

/** Type guard: clause carries an array of `values: FilterValue[]`. */
export function isArrayValueClause(
  clause: FilterClause,
): clause is Extract<FilterClause, { values: FilterValue[] }> {
  return isFieldBearingClause(clause) && "values" in clause;
}

/**
 * Field types whose stored value the resolver can't compare against
 * (`scalarValueAt` returns `undefined`). Hidden from the per-clause
 * field picker so the artist can't pick a field whose filter would
 * silently hide every item.
 */
export const NON_FILTERABLE_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "richText",
  "image",
  "file",
  "puckContent",
]);

export function filterableFields(fields: ReadonlyArray<FieldDef>): FieldDef[] {
  return fields.filter((f) => !NON_FILTERABLE_FIELD_TYPES.has(f.type));
}

/**
 * Editor state derived from a `Filter`. `null` / undefined collapses
 * to `{ mode: "all", clauses: [] }`; the resolver treats that
 * identically to "no filter".
 */
export type FilterEditorState = {
  mode: "all" | "any";
  clauses: FilterClause[];
};

export function readFilter(filter: Filter | null | undefined): FilterEditorState {
  if (!filter) return { mode: "all", clauses: [] };
  if ("any" in filter) return { mode: "any", clauses: [...filter.any] };
  return { mode: "all", clauses: [...filter.all] };
}

/**
 * Build the on-disk `Filter` shape from editor state. Empty clause
 * list collapses to `null` — `{ all: [] }` would round-trip to the
 * same resolver behaviour but uses an extra JSON object for no gain.
 */
export function buildFilter(
  mode: "all" | "any",
  clauses: ReadonlyArray<FilterClause>,
): Filter | null {
  if (clauses.length === 0) return null;
  const list = [...clauses];
  return mode === "all" ? { all: list } : { any: list };
}

/** Default `FilterValue` for a fresh clause — always a literal. */
export function defaultFilterValue(): FilterValue {
  return { kind: "literal", value: "" };
}

/**
 * Default clause for the "+ Add clause" button. Picks the first
 * filterable field; if the collection has no filterable fields, the
 * field is "" (the row UI surfaces the empty-state hint).
 */
export function defaultClause(fields: ReadonlyArray<FieldDef>): FilterClause {
  return {
    field: fields[0]?.id ?? "",
    op: "equals",
    value: defaultFilterValue(),
  };
}

/**
 * Pull the first FilterValue out of any clause shape — used when
 * morphing operators so the artist's already-typed value carries
 * across (e.g. `equals "Paris"` → `in ["Paris"]`).
 */
export function firstFilterValue(clause: FilterClause): FilterValue | undefined {
  if ("excludeCurrentItem" in clause) return undefined;
  if ("value" in clause) return clause.value;
  if ("values" in clause) return clause.values[0];
  return undefined;
}

/**
 * Change a clause's operator, morphing the shape if necessary.
 *
 * Preserves the field (or falls back to the first available field
 * when transitioning out of `excludeCurrentItem`, which has none).
 * Preserves the first FilterValue across single↔array transitions;
 * value-less ops (`isEmpty`, `excludeCurrentItem`) discard it.
 */
export function morphClauseToOp(
  clause: FilterClause,
  newOp: ClauseOp,
  fields: ReadonlyArray<FieldDef>,
): FilterClause {
  if (newOp === "excludeCurrentItem") return { excludeCurrentItem: true };
  const fallbackField = fields[0]?.id ?? "";
  const field = "excludeCurrentItem" in clause ? fallbackField : clause.field;
  const carryValue = firstFilterValue(clause) ?? defaultFilterValue();
  switch (newOp) {
    case "equals":
    case "notEquals":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "contains":
      return { field, op: newOp, value: carryValue };
    case "in":
    case "notIn":
      return { field, op: newOp, values: [carryValue] };
    case "isEmpty":
    case "isNotEmpty":
      return { field, op: newOp };
  }
}

/**
 * Replace the field on a non-`excludeCurrentItem` clause. Idempotent;
 * a no-op on `excludeCurrentItem`.
 */
export function setClauseField(clause: FilterClause, fieldId: string): FilterClause {
  if ("excludeCurrentItem" in clause) return clause;
  return { ...clause, field: fieldId };
}

/**
 * Replace the (single) value on a value-bearing clause. Returns the
 * clause unchanged for shapes that don't carry a single `value`.
 */
export function setClauseValue(clause: FilterClause, value: FilterValue): FilterClause {
  if ("excludeCurrentItem" in clause) return clause;
  if ("value" in clause) return { ...clause, value };
  return clause;
}

/**
 * Replace the `values` array on an `in`/`notIn` clause. Returns the
 * clause unchanged for shapes that don't carry `values`.
 */
export function setClauseValues(clause: FilterClause, values: FilterValue[]): FilterClause {
  if ("excludeCurrentItem" in clause) return clause;
  if ("values" in clause) return { ...clause, values };
  return clause;
}

// ---------------------------------------------------------------------------
// Clauses the page ignores
// ---------------------------------------------------------------------------

/** The fields a field picker reads from: `slug` for `viewFieldIdFor`, plus the field list. */
export type FieldPickerDef = Pick<CollectionDef, "slug" | "fields">;

/**
 * Which option a field picker shows for a saved field id. The id first
 * goes through `viewFieldIdFor`, so a default block's declared id that a
 * re-added same-name field took over shows that field, the one the page
 * reads. An id the def lacks even then is `"removed"`: the page ignores
 * the clause, and the picker says so instead of showing its first field.
 * An empty id isn't a removed field (a collection with no filterable
 * fields saves one), so it comes back as is.
 */
export type FieldPick = { kind: "field"; fieldId: string } | { kind: "removed" };

export function fieldPickFor(def: FieldPickerDef, savedId: string): FieldPick {
  if (savedId === "") return { kind: "field", fieldId: savedId };
  const fieldId = viewFieldIdFor(def, savedId);
  return def.fields.some((f) => f.id === fieldId) ? { kind: "field", fieldId } : { kind: "removed" };
}

/**
 * Whether the page ignores `clause`, for a block iterating `sourceDef`
 * inside a template for `currentItemDef`. Runs the same mapping and the
 * same check the Collection block's resolver does
 * (`resolveCollectionBlockProps`), so the inspector marks what the page
 * skips. Without `currentItemDef`, `currentItemField` values count as
 * present, as they do on the page.
 */
export function isClauseIgnored(
  clause: FilterClause,
  sourceDef: FieldPickerDef,
  currentItemDef?: FieldPickerDef,
): boolean {
  const mapped = mapClauseFields(
    clause,
    (fieldId) => viewFieldIdFor(sourceDef, fieldId),
    currentItemDef ? (fieldId) => viewFieldIdFor(currentItemDef, fieldId) : undefined,
  );
  const has = (def: FieldPickerDef) => (fieldId: string) => def.fields.some((f) => f.id === fieldId);
  return (
    clauseWithoutMissingFields(
      mapped,
      has(sourceDef),
      currentItemDef ? has(currentItemDef) : undefined,
    ) === null
  );
}
