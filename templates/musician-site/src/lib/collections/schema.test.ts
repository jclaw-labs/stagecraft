import { describe, expect, it } from "vitest";

import { generateFieldId, generateItemId } from "./id-gen";
import {
  buildFieldValueZodSchema,
  buildItemFileSchema,
  collectionDefSchema,
  collectionNameSchema,
  createCollectionRequestSchema,
  fieldDefSchema,
  fieldValueSchema,
  filterSchema,
  findField,
  isFieldRequired,
  itemFileShellSchema,
  itemSlugSchema,
  ORDER_FILE_NAME,
  orderFileSchema,
  RESERVED_ITEM_SLUGS,
  SINGLETON_ITEM_SLUG,
  SLUG_PATTERN,
  slugSchema,
  type FieldDef,
  type FieldValue,
} from "./schema";
import { FIXTURE_TIMESTAMP, tourDatesDef } from "./test-fixtures";

/** Spread into in-line item-file literals so tests don't repeat them. */
const TS = { createdAt: FIXTURE_TIMESTAMP, updatedAt: FIXTURE_TIMESTAMP };

// ---------------------------------------------------------------------------
// Compile-time exhaustiveness — the tests "pass" by typechecking. Any new
// FieldDef variant that misses a switch arm fails `npm run typecheck`
// here before the runtime suite runs.
// ---------------------------------------------------------------------------

function assertNever(value: never): never {
  throw new Error(`non-exhaustive switch: ${JSON.stringify(value)}`);
}

function describeFieldDef(def: FieldDef): string {
  switch (def.type) {
    case "text":
    case "longText":
    case "richText":
    case "number":
    case "boolean":
    case "select":
    case "multiSelect":
    case "date":
    case "url":
    case "email":
    case "color":
    case "image":
    case "file":
    case "collectionRef":
    case "multiCollectionRef":
    case "puckContent":
      return def.type;
    default:
      return assertNever(def);
  }
}

function describeFieldValue(v: FieldValue): string {
  switch (v.type) {
    case "text":
    case "longText":
    case "richText":
    case "number":
    case "boolean":
    case "select":
    case "multiSelect":
    case "date":
    case "url":
    case "email":
    case "color":
    case "image":
    case "file":
    case "collectionRef":
    case "multiCollectionRef":
    case "puckContent":
      return v.type;
    default:
      return assertNever(v);
  }
}

describe("type model", () => {
  it("FieldDef and FieldValue switch exhaustively", () => {
    expect(describeFieldDef({ id: "f", key: "t", type: "text", required: true })).toBe("text");
    expect(describeFieldValue({ type: "text", value: "Hi" })).toBe("text");
  });

  it("exports reserved filenames as constants (not magic strings)", () => {
    expect(SINGLETON_ITEM_SLUG).toBe("_singleton");
    expect(ORDER_FILE_NAME).toBe("_order");
    expect(RESERVED_ITEM_SLUGS).toContain("_singleton");
    expect(RESERVED_ITEM_SLUGS).toContain("_order");
  });

  it("SLUG_PATTERN matches kebab-case identifiers but not reserved names", () => {
    expect(SLUG_PATTERN.test("paris-2026")).toBe(true);
    expect(SLUG_PATTERN.test("_singleton")).toBe(false);
    expect(SLUG_PATTERN.test("_order")).toBe(false);
    expect(SLUG_PATTERN.test("Bad-Slug")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Slug schemas
// ---------------------------------------------------------------------------

describe("slugSchema", () => {
  it("accepts kebab-case slugs", () => {
    expect(slugSchema.parse("tour-dates")).toBe("tour-dates");
    expect(slugSchema.parse("home")).toBe("home");
    expect(slugSchema.parse("page-2")).toBe("page-2");
  });

  it.each(["_singleton", "_order", "Tour-Dates", "tour dates", "-tour", "", "/"])(
    "rejects %s",
    (bad) => {
      expect(slugSchema.safeParse(bad).success).toBe(false);
    },
  );
});

describe("itemSlugSchema", () => {
  it("accepts regular slugs and the singleton sentinel", () => {
    expect(itemSlugSchema.parse("paris-2026")).toBe("paris-2026");
    expect(itemSlugSchema.parse("_singleton")).toBe("_singleton");
  });

  it("rejects _order (only valid as a filename, not an item slug)", () => {
    expect(itemSlugSchema.safeParse("_order").success).toBe(false);
  });
});

describe("collectionNameSchema", () => {
  it("trims and accepts an ordinary name", () => {
    expect(collectionNameSchema.parse("  Press quotes  ")).toBe("Press quotes");
  });

  it("rejects a blank or whitespace-only name", () => {
    expect(collectionNameSchema.safeParse("").success).toBe(false);
    expect(collectionNameSchema.safeParse("   ").success).toBe(false);
  });

  it("rejects a name over 80 characters", () => {
    expect(collectionNameSchema.safeParse("x".repeat(80)).success).toBe(true);
    expect(collectionNameSchema.safeParse("x".repeat(81)).success).toBe(false);
  });

  it.each(["a\nb", "a\rb", "line1\r\nline2"])(
    "rejects names with line breaks (commit-injection guard): %j",
    (bad) => {
      expect(collectionNameSchema.safeParse(bad).success).toBe(false);
    },
  );
});

describe("createCollectionRequestSchema", () => {
  it("parses a well-formed body and defaults isSingleton to absent", () => {
    const parsed = createCollectionRequestSchema.parse({
      pluralName: "Press quotes",
      singularName: "Press quote",
    });
    expect(parsed).toEqual({ pluralName: "Press quotes", singularName: "Press quote" });
  });

  it("accepts an explicit isSingleton boolean", () => {
    expect(
      createCollectionRequestSchema.parse({
        pluralName: "Booking info",
        singularName: "Booking info",
        isSingleton: true,
      }).isSingleton,
    ).toBe(true);
  });

  it("rejects a non-boolean isSingleton and missing names", () => {
    expect(
      createCollectionRequestSchema.safeParse({
        pluralName: "A",
        singularName: "B",
        isSingleton: "yes",
      }).success,
    ).toBe(false);
    expect(createCollectionRequestSchema.safeParse({ pluralName: "A" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FieldDef
// ---------------------------------------------------------------------------

describe("fieldDefSchema", () => {
  it("parses every field type in the v1 palette", () => {
    const cases: FieldDef[] = [
      { id: "f1", key: "title", type: "text", required: true, maxLength: 100 },
      { id: "f2", key: "body", type: "longText", required: false },
      { id: "f3", key: "bio", type: "richText", required: false },
      { id: "f4", key: "price", type: "number", required: true, min: 0 },
      { id: "f5", key: "isPublic", type: "boolean", default: true },
      {
        id: "f6",
        key: "status",
        type: "select",
        required: true,
        options: [
          { id: "o1", value: "on_sale", label: "On sale" },
          { id: "o2", value: "sold_out", label: "Sold out" },
        ],
      },
      {
        id: "f7",
        key: "tags",
        type: "multiSelect",
        options: [{ id: "o3", value: "rock", label: "Rock" }],
      },
      { id: "f8", key: "date", type: "date", required: true, includeTime: false },
      { id: "f9", key: "url", type: "url", required: false },
      { id: "f10", key: "email", type: "email", required: false },
      { id: "f11", key: "accent", type: "color", required: false },
      { id: "f12", key: "cover", type: "image", required: true },
      {
        id: "f13",
        key: "attachment",
        type: "file",
        required: false,
        mimeFilter: ["audio/*", "application/pdf"],
      },
      {
        id: "f14",
        key: "relatedRelease",
        type: "collectionRef",
        required: false,
        targetCollection: "releases",
      },
      {
        id: "f15",
        key: "tracks",
        type: "multiCollectionRef",
        targetCollection: "tracks",
        minItems: 1,
        maxItems: 20,
      },
      { id: "f16", key: "body", type: "puckContent" },
    ];
    for (const def of cases) {
      expect(fieldDefSchema.parse(def)).toEqual(def);
    }
  });

  it("rejects unknown field types", () => {
    expect(
      fieldDefSchema.safeParse({ id: "f", key: "x", type: "made-up", required: true }).success,
    ).toBe(false);
  });

  it("rejects select with zero options", () => {
    expect(
      fieldDefSchema.safeParse({
        id: "f",
        key: "x",
        type: "select",
        required: true,
        options: [],
      }).success,
    ).toBe(false);
  });
});

describe("isFieldRequired", () => {
  it("treats boolean and multi-value types as optional regardless of caller intent", () => {
    expect(isFieldRequired({ id: "f", key: "b", type: "boolean" })).toBe(false);
    expect(isFieldRequired({ id: "f", key: "m", type: "multiSelect", options: [] })).toBe(false);
    expect(
      isFieldRequired({
        id: "f",
        key: "tracks",
        type: "multiCollectionRef",
        targetCollection: "tracks",
      }),
    ).toBe(false);
  });

  it("treats puckContent as optional (artist may leave a body empty)", () => {
    expect(isFieldRequired({ id: "f", key: "body", type: "puckContent" })).toBe(false);
  });

  it("respects the required flag for other types", () => {
    expect(isFieldRequired({ id: "f", key: "t", type: "text", required: true })).toBe(true);
    expect(isFieldRequired({ id: "f", key: "t", type: "text", required: false })).toBe(false);
  });
});

describe("systemLocked", () => {
  it("parses on any field variant", () => {
    expect(
      fieldDefSchema.parse({
        id: "f_title",
        key: "title",
        systemLocked: true,
        type: "text",
        required: true,
      }),
    ).toMatchObject({ systemLocked: true });
  });

  it("defaults to absent / undefined (artist-managed)", () => {
    const parsed = fieldDefSchema.parse({
      id: "f",
      key: "x",
      type: "text",
      required: false,
    });
    expect("systemLocked" in parsed && parsed.systemLocked).toBeFalsy();
  });
});

describe("itemFileShellSchema", () => {
  it("accepts the wrapper envelope with any FieldValue inside", () => {
    expect(
      itemFileShellSchema.parse({
        id: "item_x",
        ...TS,
        values: {
          f_a: { type: "text", value: "hi" },
          f_b: { type: "number", value: 5 },
        },
      }),
    ).toBeDefined();
  });

  it("rejects a payload missing the id", () => {
    expect(itemFileShellSchema.safeParse({ ...TS, values: {} }).success).toBe(false);
  });

  it("rejects a payload missing timestamps", () => {
    expect(itemFileShellSchema.safeParse({ id: "x", values: {} }).success).toBe(false);
  });

  it("rejects timestamps that don't parse as ISO 8601", () => {
    expect(
      itemFileShellSchema.safeParse({
        id: "x",
        createdAt: "not-a-date",
        updatedAt: FIXTURE_TIMESTAMP,
        values: {},
      }).success,
    ).toBe(false);
  });

  it("rejects a payload whose values contain a non-FieldValue shape", () => {
    expect(
      itemFileShellSchema.safeParse({
        id: "x",
        ...TS,
        values: { f_a: "not wrapped in a FieldValue discriminator" },
      }).success,
    ).toBe(false);
  });

  it("rejects a CollectionDef pasted in by mistake", () => {
    expect(
      itemFileShellSchema.safeParse({
        slug: "tour-dates",
        fields: [],
        // ...
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FieldValue
// ---------------------------------------------------------------------------

describe("fieldValueSchema (static union)", () => {
  it("accepts the basic value shape for every kind without field-level constraints", () => {
    const examples: FieldValue[] = [
      { type: "text", value: "Hi" },
      { type: "longText", value: "Body" },
      { type: "richText", value: { type: "doc", content: [] } },
      { type: "number", value: 1 },
      { type: "boolean", value: true },
      { type: "select", value: "a" },
      { type: "multiSelect", value: ["a", "b"] },
      { type: "date", value: "2026-07-15" },
      { type: "url", value: "https://example.com" },
      { type: "email", value: "a@b.com" },
      { type: "color", value: "#ff8800" },
    ];
    for (const example of examples) {
      expect(fieldValueSchema.parse(example)).toEqual(example);
    }
  });
});

describe("buildFieldValueZodSchema (per-field constraints)", () => {
  it("text enforces maxLength when set", () => {
    const schema = buildFieldValueZodSchema({ id: "f", key: "t", type: "text", required: true, maxLength: 5 });
    expect(schema.parse({ type: "text", value: "ok" })).toBeDefined();
    expect(schema.safeParse({ type: "text", value: "too long" }).success).toBe(false);
  });

  it("number enforces min/max when set", () => {
    const schema = buildFieldValueZodSchema({
      id: "f",
      key: "n",
      type: "number",
      required: true,
      min: 0,
      max: 10,
    });
    expect(schema.parse({ type: "number", value: 5 })).toBeDefined();
    expect(schema.safeParse({ type: "number", value: 20 }).success).toBe(false);
  });

  it("date without time accepts YYYY-MM-DD only", () => {
    const schema = buildFieldValueZodSchema({
      id: "f",
      key: "d",
      type: "date",
      required: true,
      includeTime: false,
    });
    expect(schema.parse({ type: "date", value: "2026-07-15" })).toBeDefined();
    expect(schema.safeParse({ type: "date", value: "2026-07-15T12:00" }).success).toBe(false);
  });

  it("date with time accepts ISO 8601 datetime", () => {
    const schema = buildFieldValueZodSchema({
      id: "f",
      key: "d",
      type: "date",
      required: true,
      includeTime: true,
    });
    expect(schema.parse({ type: "date", value: "2026-07-15T20:00:00Z" })).toBeDefined();
    expect(schema.safeParse({ type: "date", value: "2026-07-15" }).success).toBe(false);
  });

  it("url validates as URL", () => {
    const schema = buildFieldValueZodSchema({ id: "f", key: "u", type: "url", required: true });
    expect(schema.parse({ type: "url", value: "https://example.com" })).toBeDefined();
    expect(schema.safeParse({ type: "url", value: "not a url" }).success).toBe(false);
  });

  it("email validates as email", () => {
    const schema = buildFieldValueZodSchema({ id: "f", key: "e", type: "email", required: true });
    expect(schema.parse({ type: "email", value: "x@y.com" })).toBeDefined();
    expect(schema.safeParse({ type: "email", value: "not-email" }).success).toBe(false);
  });

  it("color validates as 6-digit hex", () => {
    const schema = buildFieldValueZodSchema({ id: "f", key: "c", type: "color", required: true });
    expect(schema.parse({ type: "color", value: "#ff8800" })).toBeDefined();
    expect(schema.safeParse({ type: "color", value: "ff8800" }).success).toBe(false);
    expect(schema.safeParse({ type: "color", value: "#fff" }).success).toBe(false);
  });

  it("select restricts to declared option values", () => {
    const schema = buildFieldValueZodSchema({
      id: "f",
      key: "s",
      type: "select",
      required: true,
      options: [
        { id: "o1", value: "a", label: "A" },
        { id: "o2", value: "b", label: "B" },
      ],
    });
    expect(schema.parse({ type: "select", value: "a" })).toBeDefined();
    expect(schema.safeParse({ type: "select", value: "c" }).success).toBe(false);
  });

  it("multiSelect restricts every value to declared options", () => {
    const schema = buildFieldValueZodSchema({
      id: "f",
      key: "m",
      type: "multiSelect",
      options: [
        { id: "o1", value: "x", label: "X" },
        { id: "o2", value: "y", label: "Y" },
      ],
    });
    expect(schema.parse({ type: "multiSelect", value: ["x", "y"] })).toBeDefined();
    expect(schema.safeParse({ type: "multiSelect", value: ["x", "z"] }).success).toBe(false);
  });

  it("collectionRef stores just an itemId (target comes from FieldDef)", () => {
    const schema = buildFieldValueZodSchema({
      id: "f",
      key: "r",
      type: "collectionRef",
      required: true,
      targetCollection: "releases",
    });
    expect(
      schema.parse({ type: "collectionRef", value: { itemId: "rel_abc" } }),
    ).toBeDefined();
  });

  it("multiCollectionRef stores an array of itemIds (target comes from FieldDef)", () => {
    const schema = buildFieldValueZodSchema({
      id: "f",
      key: "tracks",
      type: "multiCollectionRef",
      targetCollection: "tracks",
    });
    expect(
      schema.parse({ type: "multiCollectionRef", value: ["tr_1", "tr_2", "tr_3"] }),
    ).toBeDefined();
  });

  it("multiCollectionRef enforces minItems / maxItems when set", () => {
    const schema = buildFieldValueZodSchema({
      id: "f",
      key: "tracks",
      type: "multiCollectionRef",
      targetCollection: "tracks",
      minItems: 2,
      maxItems: 4,
    });
    expect(schema.parse({ type: "multiCollectionRef", value: ["a", "b"] })).toBeDefined();
    expect(schema.parse({ type: "multiCollectionRef", value: ["a", "b", "c", "d"] })).toBeDefined();
    expect(schema.safeParse({ type: "multiCollectionRef", value: ["a"] }).success).toBe(false);
    expect(
      schema.safeParse({ type: "multiCollectionRef", value: ["a", "b", "c", "d", "e"] }).success,
    ).toBe(false);
  });

  it("file applies mime filter when provided", () => {
    const schema = buildFieldValueZodSchema({
      id: "f",
      key: "a",
      type: "file",
      required: true,
      mimeFilter: ["audio/*"],
    });
    expect(
      schema.parse({
        type: "file",
        value: { src: "/files/x.mp3", mimeType: "audio/mpeg", originalName: "x.mp3", sizeBytes: 1 },
      }),
    ).toBeDefined();
    expect(
      schema.safeParse({
        type: "file",
        value: {
          src: "/files/x.pdf",
          mimeType: "application/pdf",
          originalName: "x.pdf",
          sizeBytes: 1,
        },
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CollectionDef
// ---------------------------------------------------------------------------

describe("collectionDefSchema", () => {
  const baseDef = {
    schemaVersion: 1 as const,
    slug: "tour-dates",
    singularName: "tour date",
    pluralName: "tour dates",
    fields: [
      { id: "f_date", key: "date", type: "date", required: true },
      { id: "f_venue", key: "venue", type: "text", required: true },
    ],
    slugSourceFieldId: "f_venue",
    detailUrlPrefix: "/shows",
    defaultSort: { mode: "fieldSort", fieldId: "f_date", direction: "asc" },
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: false,
  } as const;

  it("parses a valid def", () => {
    expect(collectionDefSchema.parse(baseDef).slug).toBe("tour-dates");
  });

  it("rejects duplicate field ids", () => {
    expect(
      collectionDefSchema.safeParse({
        ...baseDef,
        fields: [
          { id: "dup", key: "a", type: "text", required: true },
          { id: "dup", key: "b", type: "text", required: true },
        ],
        slugSourceFieldId: null,
        defaultSort: null,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate field keys", () => {
    expect(
      collectionDefSchema.safeParse({
        ...baseDef,
        fields: [
          { id: "a", key: "samekey", type: "text", required: true },
          { id: "b", key: "samekey", type: "text", required: true },
        ],
        slugSourceFieldId: null,
        defaultSort: null,
      }).success,
    ).toBe(false);
  });

  it("rejects slugSourceFieldId that doesn't exist on the schema", () => {
    expect(
      collectionDefSchema.safeParse({ ...baseDef, slugSourceFieldId: "nope" }).success,
    ).toBe(false);
  });

  it("rejects defaultSort referencing an unknown field", () => {
    expect(
      collectionDefSchema.safeParse({
        ...baseDef,
        defaultSort: { mode: "fieldSort", fieldId: "nope", direction: "asc" },
      }).success,
    ).toBe(false);
  });

  it("rejects detailUrlPrefix not starting with /", () => {
    expect(
      collectionDefSchema.safeParse({ ...baseDef, detailUrlPrefix: "shows" }).success,
    ).toBe(false);
  });

  it("accepts detailUrlPrefix = null (no detail pages)", () => {
    expect(collectionDefSchema.parse({ ...baseDef, detailUrlPrefix: null }).detailUrlPrefix).toBe(
      null,
    );
  });

  it("accepts a manual-sort def", () => {
    expect(
      collectionDefSchema.parse({ ...baseDef, defaultSort: { mode: "manual" as const } })
        .defaultSort,
    ).toEqual({ mode: "manual" });
  });

  it("accepts itemTemplate as a minimal Puck Data shape", () => {
    expect(
      collectionDefSchema.parse({ ...baseDef, itemTemplate: { content: [], root: { props: {} } } })
        .itemTemplate,
    ).toEqual({ content: [], root: { props: {} } });
  });
});

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

describe("buildItemFileSchema", () => {
  const fields: FieldDef[] = [
    { id: "f_title", key: "title", type: "text", required: true, maxLength: 50 },
    { id: "f_subtitle", key: "subtitle", type: "text", required: false },
    { id: "f_count", key: "count", type: "number", required: true, min: 0, max: 100 },
  ];

  it("validates the full on-disk shape", () => {
    expect(
      buildItemFileSchema([{ id: "f_t", key: "title", type: "text", required: true }]).parse({
        id: "item_123",
        ...TS,
        values: { f_t: { type: "text", value: "Hello" } },
      }),
    ).toBeDefined();
  });

  it("rejects an item without an id", () => {
    expect(buildItemFileSchema([]).safeParse({ ...TS, values: {} }).success).toBe(false);
  });

  it("rejects an item without timestamps", () => {
    expect(buildItemFileSchema([]).safeParse({ id: "x", values: {} }).success).toBe(false);
  });

  it("rejects when a required field is missing", () => {
    const schema = buildItemFileSchema(fields);
    expect(
      schema.safeParse({
        id: "x",
        ...TS,
        values: { f_count: { type: "number", value: 5 } },
      }).success,
    ).toBe(false);
  });

  it("accepts an optional field being absent", () => {
    const schema = buildItemFileSchema(fields);
    const parsed = schema.parse({
      id: "x",
      ...TS,
      values: {
        f_title: { type: "text", value: "Hello" },
        f_count: { type: "number", value: 5 },
      },
    });
    expect(parsed.values).not.toHaveProperty("f_subtitle");
  });

  it("enforces field-level constraints (maxLength, min/max)", () => {
    const schema = buildItemFileSchema(fields);
    expect(
      schema.safeParse({
        id: "x",
        ...TS,
        values: {
          f_title: { type: "text", value: "x".repeat(60) },
          f_count: { type: "number", value: 5 },
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        id: "x",
        ...TS,
        values: {
          f_title: { type: "text", value: "ok" },
          f_count: { type: "number", value: 1000 },
        },
      }).success,
    ).toBe(false);
  });

  it("strips unknown field ids (a deleted field still in the file)", () => {
    const schema = buildItemFileSchema(fields);
    const parsed = schema.parse({
      id: "x",
      ...TS,
      values: {
        f_title: { type: "text", value: "Hello" },
        f_count: { type: "number", value: 5 },
        f_deleted: { type: "text", value: "stale" },
      },
    });
    expect(parsed.values).not.toHaveProperty("f_deleted");
  });
});

// ---------------------------------------------------------------------------
// _order.json
// ---------------------------------------------------------------------------

describe("orderFileSchema", () => {
  it("accepts an array of slugs", () => {
    expect(orderFileSchema.parse(["a", "b", "c-2"])).toEqual(["a", "b", "c-2"]);
  });

  it("rejects entries that aren't valid slugs", () => {
    expect(orderFileSchema.safeParse(["valid", "NOT-VALID"]).success).toBe(false);
  });

  it("accepts an empty array", () => {
    expect(orderFileSchema.parse([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findField
// ---------------------------------------------------------------------------

describe("findField", () => {
  it("returns the matching field by id, or undefined", () => {
    const def = tourDatesDef();
    expect(findField(def, "f_venue")?.key).toBe("venue");
    expect(findField(def, "nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ID generators
// ---------------------------------------------------------------------------

describe("ID generators", () => {
  it("generateFieldId returns a fld_-prefixed string", () => {
    const id = generateFieldId();
    expect(id).toMatch(/^fld_/);
    expect(id.length).toBeGreaterThan("fld_".length);
  });

  it("generateItemId returns an item_-prefixed string", () => {
    const id = generateItemId();
    expect(id).toMatch(/^item_/);
    expect(id.length).toBeGreaterThan("item_".length);
  });

  it("returns a different id each call", () => {
    expect(generateFieldId()).not.toBe(generateFieldId());
    expect(generateItemId()).not.toBe(generateItemId());
  });
});

describe("filterSchema (ADR §5.1)", () => {
  it("accepts an `all`-of-clauses filter with literal values", () => {
    const filter = {
      all: [
        {
          field: "fld_status",
          op: "in" as const,
          values: [{ kind: "literal" as const, value: "on_sale" }],
        },
      ],
    };
    expect(() => filterSchema.parse(filter)).not.toThrow();
  });

  it("accepts an `any`-of-clauses filter", () => {
    const filter = {
      any: [
        { field: "fld_status", op: "equals" as const, value: { kind: "literal" as const, value: "on_sale" } },
        { field: "fld_status", op: "equals" as const, value: { kind: "literal" as const, value: "free" } },
      ],
    };
    expect(() => filterSchema.parse(filter)).not.toThrow();
  });

  it("accepts a currentItem-shaped value", () => {
    const filter = {
      all: [
        {
          field: "fld_tour",
          op: "equals" as const,
          value: { kind: "currentItemField" as const, fieldId: "fld_tour" },
        },
      ],
    };
    expect(() => filterSchema.parse(filter)).not.toThrow();
  });

  it("accepts the excludeCurrentItem shorthand", () => {
    const filter = { all: [{ excludeCurrentItem: true as const }] };
    expect(() => filterSchema.parse(filter)).not.toThrow();
  });

  it("accepts the `today` relative-date value (e.g. an upcoming window)", () => {
    const filter = {
      all: [{ field: "fld_tour_date", op: "gte" as const, value: { kind: "today" as const } }],
    };
    expect(() => filterSchema.parse(filter)).not.toThrow();
  });

  it("accepts every comparison operator", () => {
    const ops = ["equals", "notEquals", "gt", "gte", "lt", "lte", "contains"] as const;
    for (const op of ops) {
      const filter = {
        all: [{ field: "fld_x", op, value: { kind: "literal" as const, value: 1 } }],
      };
      expect(() => filterSchema.parse(filter), `op=${op}`).not.toThrow();
    }
  });

  it("accepts the in/notIn array-valued operators", () => {
    for (const op of ["in", "notIn"] as const) {
      const filter = {
        all: [
          {
            field: "fld_x",
            op,
            values: [{ kind: "literal" as const, value: "a" }],
          },
        ],
      };
      expect(() => filterSchema.parse(filter), `op=${op}`).not.toThrow();
    }
  });

  it("accepts the isEmpty / isNotEmpty operators (no value)", () => {
    for (const op of ["isEmpty", "isNotEmpty"] as const) {
      const filter = { all: [{ field: "fld_x", op }] };
      expect(() => filterSchema.parse(filter), `op=${op}`).not.toThrow();
    }
  });

  it("rejects an unknown FilterValue kind", () => {
    const filter = {
      all: [
        {
          field: "fld_x",
          op: "equals",
          value: { kind: "magic", value: 1 },
        },
      ],
    };
    expect(() => filterSchema.parse(filter)).toThrow();
  });

  it("rejects an unknown operator", () => {
    const filter = {
      all: [
        { field: "fld_x", op: "soundsLike", value: { kind: "literal", value: "x" } },
      ],
    };
    expect(() => filterSchema.parse(filter)).toThrow();
  });
});
