/**
 * Collection-block filter shape, declared separately from
 * `schema.ts` so client components (FilterField, the Puck
 * inspector) can import it without pulling `schema.ts`'s
 * `node:crypto` dependency into the browser bundle.
 *
 * The shape itself is ADR-009 §5.1. Re-exported from `schema.ts`
 * for the curated public surface; production code can import
 * either path interchangeably.
 */

import { z } from "zod";

const fieldIdSchema = z.string().min(1);

const filterValueSchema: z.ZodType<FilterValue> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.unknown() }),
  z.object({ kind: z.literal("currentItemId") }),
  z.object({ kind: z.literal("currentItemField"), fieldId: fieldIdSchema }),
]);

const filterClauseSchema: z.ZodType<FilterClause> = z.union([
  z.object({
    field: fieldIdSchema,
    op: z.union([z.literal("equals"), z.literal("notEquals")]),
    value: filterValueSchema,
  }),
  z.object({
    field: fieldIdSchema,
    op: z.union([z.literal("in"), z.literal("notIn")]),
    values: z.array(filterValueSchema),
  }),
  z.object({
    field: fieldIdSchema,
    op: z.union([z.literal("isEmpty"), z.literal("isNotEmpty")]),
  }),
  z.object({
    field: fieldIdSchema,
    op: z.union([z.literal("gt"), z.literal("gte"), z.literal("lt"), z.literal("lte")]),
    value: filterValueSchema,
  }),
  z.object({
    field: fieldIdSchema,
    op: z.literal("contains"),
    value: filterValueSchema,
  }),
  z.object({ excludeCurrentItem: z.literal(true) }),
]);

export const filterSchema: z.ZodType<Filter> = z.union([
  z.object({ all: z.array(filterClauseSchema) }),
  z.object({ any: z.array(filterClauseSchema) }),
]);

/**
 * A value substituted into a filter clause at resolution time. The
 * three-arm discriminator avoids the `_id`-named-FieldId collision
 * the single-arm shape (`field: "_id"` sentinel) would have.
 */
export type FilterValue =
  | { kind: "literal"; value: unknown }
  | { kind: "currentItemId" }
  | { kind: "currentItemField"; fieldId: string };

/**
 * One comparison clause inside a `Filter`. `excludeCurrentItem` is a
 * shorthand for "exclude the item whose template is rendering this
 * block" — common on detail pages ("More posts by me").
 */
export type FilterClause =
  | { field: string; op: "equals" | "notEquals"; value: FilterValue }
  | { field: string; op: "in" | "notIn"; values: FilterValue[] }
  | { field: string; op: "isEmpty" | "isNotEmpty" }
  | { field: string; op: "gt" | "gte" | "lt" | "lte"; value: FilterValue }
  | { field: string; op: "contains"; value: FilterValue }
  | { excludeCurrentItem: true };

/**
 * A Collection block's filter expression. `all` means AND across
 * clauses; `any` means OR. Nested groupings aren't supported in v1;
 * the artist composes them by stacking multiple Collection blocks
 * with different filters.
 */
export type Filter =
  | { all: FilterClause[] }
  | { any: FilterClause[] };
