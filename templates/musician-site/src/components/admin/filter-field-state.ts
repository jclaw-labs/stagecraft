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
} from "#lib/collections/filter-schema.js";
import type { FieldDef, FieldType } from "#lib/collections/index.js";
import { filterForDefs, type FilterFieldsDef } from "#lib/collections/template/filter.js";
import { viewFieldIdFor } from "#lib/collections/template/view-requirements.js";

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

/**
 * Which option a field picker shows for a saved field id. The id first
 * goes through `viewFieldIdFor`, so a default block's declared id that a
 * re-added same-name field took over shows that field, the one the page
 * reads. An id the def lacks even then is `"removed"`: the page ignores
 * the clause, and the picker says so instead of showing its first field.
 * An empty id is `"none"`: no field was ever picked (a collection with
 * no filterable fields saves one), and the page ignores that clause too.
 * A field the def has but `filterableFields` leaves out (image, file,
 * richText, puckContent) is `"unfilterable"`: the picker has no option
 * for it, so it gets one naming the field. The page keeps that clause,
 * and a value-comparing one hides every item (`comparesValues`).
 */
export type FieldPick =
  | { kind: "field"; fieldId: string }
  | { kind: "unfilterable"; field: FieldDef }
  | { kind: "removed" }
  | { kind: "none" };

export function fieldPickFor(def: FilterFieldsDef, savedId: string): FieldPick {
  if (savedId === "") return { kind: "none" };
  const fieldId = viewFieldIdFor(def, savedId);
  const field = def.fields.find((f) => f.id === fieldId);
  if (!field) return { kind: "removed" };
  return NON_FILTERABLE_FIELD_TYPES.has(field.type)
    ? { kind: "unfilterable", field }
    : { kind: "field", fieldId };
}

/**
 * Whether `op` compares the clause's field against one or more values.
 * The page reads no value from an unfilterable field, so such a clause
 * on one matches no item; `isEmpty` / `isNotEmpty` only check presence
 * and still work.
 */
export function comparesValues(op: ClauseOp): boolean {
  const shape = clauseValueShape(op);
  return shape === "single" || shape === "array";
}

/**
 * Whether the page ignores `clause`, for a block iterating `sourceDef`
 * inside a template for `currentItemDef`. Runs the clause through
 * `filterForDefs`, the same call the Collection block's resolver
 * (`resolveCollectionBlockProps`) makes, so the inspector marks what the
 * page skips. Without `currentItemDef`, `currentItemField` values count
 * as present, as they do on the page.
 */
export function isClauseIgnored(
  clause: FilterClause,
  sourceDef: FilterFieldsDef,
  currentItemDef?: FilterFieldsDef,
): boolean {
  // In an `all` group of one, a clause that names no missing field
  // survives (an `excludeCurrentItem` clause included), and one that does
  // leaves nothing, so the result is `null`.
  return filterForDefs({ all: [clause] }, sourceDef, currentItemDef) === null;
}

/** Current-item fields a clause's values name that the page can't read, and what the clause then does. */
export type UnfilterableCurrentItemValue = {
  fields: FieldDef[];
  outcome: "matchesNone" | "matchesEveryWithValue" | "valueSkipped";
};

const MATCHES_EVERY_ITEM_WITH_A_VALUE: ReadonlySet<ClauseOp> = new Set<ClauseOp>([
  "notEquals",
  "notIn",
  "gte",
  "lte",
]);

/**
 * What the page does with a clause whose value is a current-item field
 * it can't read (image, file, richText, puckContent; see
 * `fieldPickFor`), for a template whose item comes from
 * `currentItemDef`. The page reads no value from such a field, so the
 * clause compares each item against nothing:
 *
 *   - `equals`, `contains`, `in`, `>` and `<` match no item
 *     (`"matchesNone"`).
 *   - `does not equal`, `is not one of`, `≥` and `≤` match every item
 *     that has a value for the clause's field
 *     (`"matchesEveryWithValue"`): `compareScalars` counts values it
 *     can't order as equal.
 *   - In an `is one of` / `is not one of` list that also holds a value
 *     the page can read, the page only skips that value
 *     (`"valueSkipped"`).
 *
 * `fields` lists each such field once, in value order. `null` when no
 * value names one, and without `currentItemDef`, since there's nothing
 * to check against.
 */
export function unfilterableCurrentItemValue(
  clause: FilterClause,
  currentItemDef?: FilterFieldsDef,
): UnfilterableCurrentItemValue | null {
  if (!currentItemDef) return null;
  const values = isSingleValueClause(clause)
    ? [clause.value]
    : isArrayValueClause(clause)
      ? clause.values
      : [];
  // `null` for a value that isn't a current-item field (a literal, the
  // current item's id, today), which the page always reads.
  const picks = values.map((value) =>
    value.kind === "currentItemField" ? fieldPickFor(currentItemDef, value.fieldId) : null,
  );
  const fields: FieldDef[] = [];
  for (const pick of picks) {
    if (pick?.kind === "unfilterable" && !fields.some((f) => f.id === pick.field.id)) fields.push(pick.field);
  }
  if (fields.length === 0) return null;
  const readable = picks.some((pick) => pick === null || pick.kind === "field");
  const outcome = readable
    ? "valueSkipped"
    : MATCHES_EVERY_ITEM_WITH_A_VALUE.has(clauseToOp(clause))
      ? "matchesEveryWithValue"
      : "matchesNone";
  return { fields, outcome };
}
