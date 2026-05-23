/**
 * Round-trip tests for the visual clause builder's state helpers.
 *
 * The visual editor mounts `readFilter(value)` into its render state
 * and emits via `buildFilter(mode, clauses)`. These tests confirm
 * that loop is shape-preserving on every representative filter the
 * artist can author — both via the visual UI and via the raw-JSON
 * escape hatch.
 */

import { describe, expect, it } from "vitest";

import {
  buildFilter,
  CLAUSE_OPS,
  clauseToOp,
  clauseValueShape,
  defaultClause,
  defaultFilterValue,
  filterableFields,
  firstFilterValue,
  isArrayValueClause,
  isFieldBearingClause,
  isSingleValueClause,
  morphClauseToOp,
  readFilter,
  setClauseField,
  setClauseValue,
  setClauseValues,
  type ClauseOp,
} from "./filter-field-state";
import type { FieldDef } from "@/lib/collections";
import type { Filter, FilterClause } from "@/lib/collections/filter-schema";

const FIELDS: FieldDef[] = [
  { id: "f_city", key: "city", type: "text", required: false },
  { id: "f_capacity", key: "capacity", type: "number", required: false },
  {
    id: "f_status",
    key: "status",
    type: "select",
    required: false,
    options: [
      { id: "o_on", value: "on_sale", label: "On sale" },
      { id: "o_off", value: "sold_out", label: "Sold out" },
    ],
  },
];

// ---------------------------------------------------------------------------
// readFilter ↔ buildFilter
// ---------------------------------------------------------------------------

describe("readFilter / buildFilter", () => {
  it("null collapses to empty AND state", () => {
    expect(readFilter(null)).toEqual({ mode: "all", clauses: [] });
  });

  it("undefined collapses to empty AND state", () => {
    expect(readFilter(undefined)).toEqual({ mode: "all", clauses: [] });
  });

  it("buildFilter of empty clauses returns null", () => {
    expect(buildFilter("all", [])).toBeNull();
    expect(buildFilter("any", [])).toBeNull();
  });

  it("round-trips a literal-equals filter", () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    const { mode, clauses } = readFilter(filter);
    expect(buildFilter(mode, clauses)).toEqual(filter);
  });

  it("round-trips a currentItemField-equals filter", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_artist",
          op: "equals",
          value: { kind: "currentItemField", fieldId: "f_id" },
        },
      ],
    };
    const { mode, clauses } = readFilter(filter);
    expect(buildFilter(mode, clauses)).toEqual(filter);
  });

  it("round-trips a currentItemId-equals filter", () => {
    const filter: Filter = {
      all: [{ field: "f_parent", op: "equals", value: { kind: "currentItemId" } }],
    };
    const { mode, clauses } = readFilter(filter);
    expect(buildFilter(mode, clauses)).toEqual(filter);
  });

  it("round-trips multiple ANDed clauses preserving order", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_status",
          op: "equals",
          value: { kind: "literal", value: "on_sale" },
        },
        {
          field: "f_capacity",
          op: "gte",
          value: { kind: "literal", value: 100 },
        },
        { excludeCurrentItem: true },
      ],
    };
    const { mode, clauses } = readFilter(filter);
    expect(mode).toBe("all");
    expect(clauses).toHaveLength(3);
    expect(buildFilter(mode, clauses)).toEqual(filter);
  });

  it("round-trips an `any` (OR) filter — mode is preserved", () => {
    const filter: Filter = {
      any: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Lyon" } },
      ],
    };
    const { mode, clauses } = readFilter(filter);
    expect(mode).toBe("any");
    expect(buildFilter(mode, clauses)).toEqual(filter);
  });

  it("round-trips an `in` clause with multiple FilterValues", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_status",
          op: "in",
          values: [
            { kind: "literal", value: "on_sale" },
            { kind: "literal", value: "free" },
          ],
        },
      ],
    };
    const { mode, clauses } = readFilter(filter);
    expect(buildFilter(mode, clauses)).toEqual(filter);
  });

  it("round-trips a value-less `isEmpty` clause", () => {
    const filter: Filter = {
      all: [{ field: "f_city", op: "isEmpty" }],
    };
    const { mode, clauses } = readFilter(filter);
    expect(buildFilter(mode, clauses)).toEqual(filter);
  });

  it("round-trips a `contains` clause", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_city",
          op: "contains",
          value: { kind: "literal", value: "par" },
        },
      ],
    };
    const { mode, clauses } = readFilter(filter);
    expect(buildFilter(mode, clauses)).toEqual(filter);
  });

  it("readFilter returns a fresh clause array — mutating it doesn't reach the source filter", () => {
    const filter: Filter = {
      all: [{ field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } }],
    };
    const state = readFilter(filter);
    state.clauses.push({ excludeCurrentItem: true });
    expect(filter.all).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// clauseToOp / clauseValueShape
// ---------------------------------------------------------------------------

describe("isFieldBearingClause / isSingleValueClause / isArrayValueClause", () => {
  const fieldBearing: FilterClause = {
    field: "f_city",
    op: "equals",
    value: { kind: "literal", value: "Paris" },
  };
  const arrayBearing: FilterClause = { field: "f_status", op: "in", values: [] };
  const emptyOp: FilterClause = { field: "f_city", op: "isEmpty" };
  const exclude: FilterClause = { excludeCurrentItem: true };

  it("isFieldBearingClause: true for every shape except excludeCurrentItem", () => {
    expect(isFieldBearingClause(fieldBearing)).toBe(true);
    expect(isFieldBearingClause(arrayBearing)).toBe(true);
    expect(isFieldBearingClause(emptyOp)).toBe(true);
    expect(isFieldBearingClause(exclude)).toBe(false);
  });

  it("isSingleValueClause: true only for single-value arms", () => {
    expect(isSingleValueClause(fieldBearing)).toBe(true);
    expect(isSingleValueClause(arrayBearing)).toBe(false);
    expect(isSingleValueClause(emptyOp)).toBe(false);
    expect(isSingleValueClause(exclude)).toBe(false);
  });

  it("isArrayValueClause: true only for in/notIn", () => {
    expect(isArrayValueClause(fieldBearing)).toBe(false);
    expect(isArrayValueClause(arrayBearing)).toBe(true);
    expect(isArrayValueClause(emptyOp)).toBe(false);
    expect(isArrayValueClause(exclude)).toBe(false);
  });
});

describe("clauseToOp", () => {
  it("returns the op for value-bearing clauses", () => {
    const c: FilterClause = {
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "Paris" },
    };
    expect(clauseToOp(c)).toBe("equals");
  });

  it("returns the op for `in`-shape clauses", () => {
    const c: FilterClause = { field: "f_status", op: "in", values: [] };
    expect(clauseToOp(c)).toBe("in");
  });

  it("returns the op for value-less clauses", () => {
    const c: FilterClause = { field: "f_city", op: "isEmpty" };
    expect(clauseToOp(c)).toBe("isEmpty");
  });

  it("returns `excludeCurrentItem` for the field-less clause", () => {
    const c: FilterClause = { excludeCurrentItem: true };
    expect(clauseToOp(c)).toBe("excludeCurrentItem");
  });
});

describe("clauseValueShape", () => {
  it("maps single-value ops to 'single'", () => {
    const ops: ClauseOp[] = ["equals", "notEquals", "gt", "gte", "lt", "lte", "contains"];
    for (const op of ops) expect(clauseValueShape(op)).toBe("single");
  });

  it("maps array-value ops to 'array'", () => {
    const ops: ClauseOp[] = ["in", "notIn"];
    for (const op of ops) expect(clauseValueShape(op)).toBe("array");
  });

  it("maps value-less ops to 'none'", () => {
    expect(clauseValueShape("isEmpty")).toBe("none");
    expect(clauseValueShape("isNotEmpty")).toBe("none");
  });

  it("maps excludeCurrentItem to its own shape", () => {
    expect(clauseValueShape("excludeCurrentItem")).toBe("excludeCurrent");
  });
});

// ---------------------------------------------------------------------------
// CLAUSE_OPS exhaustiveness — guard against silently forgetting to add a
// picker entry when a new operator is added to the union.
// ---------------------------------------------------------------------------

describe("CLAUSE_OPS picker", () => {
  it("lists every ClauseOp exactly once", () => {
    // The union of every value `clauseValueShape` handles — derived
    // from the function's switch arms via TypeScript exhaustiveness.
    const everyOp: ClauseOp[] = [
      "equals",
      "notEquals",
      "in",
      "notIn",
      "isEmpty",
      "isNotEmpty",
      "gt",
      "gte",
      "lt",
      "lte",
      "contains",
      "excludeCurrentItem",
    ];
    const pickerOps = CLAUSE_OPS.map((o) => o.value);
    expect(pickerOps.slice().sort()).toEqual(everyOp.slice().sort());
    expect(new Set(pickerOps).size).toBe(pickerOps.length);
  });
});

// ---------------------------------------------------------------------------
// morphClauseToOp — operator changes preserve the artist's input
// ---------------------------------------------------------------------------

describe("morphClauseToOp", () => {
  it("equals → in carries the value into the array", () => {
    const c: FilterClause = {
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "Paris" },
    };
    const next = morphClauseToOp(c, "in", FIELDS);
    expect(next).toEqual({
      field: "f_city",
      op: "in",
      values: [{ kind: "literal", value: "Paris" }],
    });
  });

  it("in → equals picks the first value", () => {
    const c: FilterClause = {
      field: "f_status",
      op: "in",
      values: [
        { kind: "literal", value: "on_sale" },
        { kind: "literal", value: "sold_out" },
      ],
    };
    const next = morphClauseToOp(c, "equals", FIELDS);
    expect(next).toEqual({
      field: "f_status",
      op: "equals",
      value: { kind: "literal", value: "on_sale" },
    });
  });

  it("equals → isEmpty drops the value", () => {
    const c: FilterClause = {
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "Paris" },
    };
    expect(morphClauseToOp(c, "isEmpty", FIELDS)).toEqual({
      field: "f_city",
      op: "isEmpty",
    });
  });

  it("isEmpty → equals creates a fresh empty literal", () => {
    const c: FilterClause = { field: "f_city", op: "isEmpty" };
    expect(morphClauseToOp(c, "equals", FIELDS)).toEqual({
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "" },
    });
  });

  it("equals → excludeCurrentItem discards field and value", () => {
    const c: FilterClause = {
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "Paris" },
    };
    expect(morphClauseToOp(c, "excludeCurrentItem", FIELDS)).toEqual({
      excludeCurrentItem: true,
    });
  });

  it("excludeCurrentItem → equals defaults to the first field with a fresh literal", () => {
    const c: FilterClause = { excludeCurrentItem: true };
    expect(morphClauseToOp(c, "equals", FIELDS)).toEqual({
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "" },
    });
  });

  it("excludeCurrentItem → equals uses '' when there are no fields", () => {
    const c: FilterClause = { excludeCurrentItem: true };
    expect(morphClauseToOp(c, "equals", [])).toEqual({
      field: "",
      op: "equals",
      value: { kind: "literal", value: "" },
    });
  });

  it("preserves currentItemField FilterValues across operator changes", () => {
    const c: FilterClause = {
      field: "f_city",
      op: "equals",
      value: { kind: "currentItemField", fieldId: "f_id" },
    };
    expect(morphClauseToOp(c, "in", FIELDS)).toEqual({
      field: "f_city",
      op: "in",
      values: [{ kind: "currentItemField", fieldId: "f_id" }],
    });
  });

  it("preserves currentItemId FilterValues across operator changes", () => {
    const c: FilterClause = {
      field: "f_parent",
      op: "equals",
      value: { kind: "currentItemId" },
    };
    expect(morphClauseToOp(c, "notEquals", FIELDS)).toEqual({
      field: "f_parent",
      op: "notEquals",
      value: { kind: "currentItemId" },
    });
  });

  it("returns a value-bearing FilterValue on every value-bearing op (no leakage of value-less shapes)", () => {
    // Sanity check the spec's "value-bearing operators only on
    // value-bearing FilterValue arms" rule: every value-bearing
    // morph result MUST carry a FilterValue, never undefined.
    const valueOps: ClauseOp[] = [
      "equals", "notEquals", "gt", "gte", "lt", "lte", "contains",
    ];
    for (const op of valueOps) {
      const morphed = morphClauseToOp({ excludeCurrentItem: true }, op, FIELDS);
      expect("value" in morphed && morphed.value).toBeDefined();
    }
    const arrayOps: ClauseOp[] = ["in", "notIn"];
    for (const op of arrayOps) {
      const morphed = morphClauseToOp({ excludeCurrentItem: true }, op, FIELDS);
      expect("values" in morphed && Array.isArray(morphed.values) && morphed.values.length).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Setter helpers + defaults
// ---------------------------------------------------------------------------

describe("clause setters", () => {
  it("setClauseField updates a value-bearing clause", () => {
    const c: FilterClause = {
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "Paris" },
    };
    expect(setClauseField(c, "f_status")).toEqual({
      field: "f_status",
      op: "equals",
      value: { kind: "literal", value: "Paris" },
    });
  });

  it("setClauseField is a no-op on excludeCurrentItem", () => {
    const c: FilterClause = { excludeCurrentItem: true };
    expect(setClauseField(c, "f_anything")).toEqual(c);
  });

  it("setClauseValue updates the value on single-value clauses", () => {
    const c: FilterClause = {
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "Paris" },
    };
    expect(setClauseValue(c, { kind: "literal", value: "Lyon" })).toEqual({
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "Lyon" },
    });
  });

  it("setClauseValues updates the array on `in` clauses", () => {
    const c: FilterClause = { field: "f_status", op: "in", values: [] };
    expect(
      setClauseValues(c, [
        { kind: "literal", value: "a" },
        { kind: "literal", value: "b" },
      ]),
    ).toEqual({
      field: "f_status",
      op: "in",
      values: [
        { kind: "literal", value: "a" },
        { kind: "literal", value: "b" },
      ],
    });
  });
});

describe("defaultClause / defaultFilterValue", () => {
  it("defaultFilterValue returns an empty literal", () => {
    expect(defaultFilterValue()).toEqual({ kind: "literal", value: "" });
  });

  it("defaultClause uses the first field's id", () => {
    expect(defaultClause(FIELDS)).toEqual({
      field: "f_city",
      op: "equals",
      value: { kind: "literal", value: "" },
    });
  });

  it("defaultClause falls back to '' when no fields are filterable", () => {
    expect(defaultClause([])).toEqual({
      field: "",
      op: "equals",
      value: { kind: "literal", value: "" },
    });
  });
});

// ---------------------------------------------------------------------------
// filterableFields excludes the resolver-incompatible types
// ---------------------------------------------------------------------------

describe("filterableFields", () => {
  it("drops image / file / richText / puckContent fields", () => {
    const fields: FieldDef[] = [
      { id: "f_title", key: "title", type: "text", required: true },
      { id: "f_hero", key: "hero", type: "image", required: false },
      { id: "f_body", key: "body", type: "richText", required: false },
      { id: "f_audio", key: "audio", type: "file", required: false },
      { id: "f_puck", key: "puck", type: "puckContent" },
      { id: "f_count", key: "count", type: "number", required: false },
    ];
    expect(filterableFields(fields).map((f) => f.id)).toEqual(["f_title", "f_count"]);
  });
});

// ---------------------------------------------------------------------------
// firstFilterValue
// ---------------------------------------------------------------------------

describe("firstFilterValue", () => {
  it("returns undefined for excludeCurrentItem", () => {
    expect(firstFilterValue({ excludeCurrentItem: true })).toBeUndefined();
  });

  it("returns undefined for isEmpty / isNotEmpty", () => {
    expect(firstFilterValue({ field: "f_city", op: "isEmpty" })).toBeUndefined();
  });

  it("returns the value for single-value clauses", () => {
    const v = { kind: "literal" as const, value: "Paris" };
    expect(
      firstFilterValue({ field: "f_city", op: "equals", value: v }),
    ).toEqual(v);
  });

  it("returns the first entry of `values` on in/notIn", () => {
    const v0 = { kind: "literal" as const, value: "a" };
    const v1 = { kind: "literal" as const, value: "b" };
    expect(
      firstFilterValue({ field: "f_status", op: "in", values: [v0, v1] }),
    ).toEqual(v0);
  });
});
