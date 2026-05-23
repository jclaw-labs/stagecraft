/**
 * Drift guard for the cross-cutting field-type classification sets.
 *
 * The whole point of consolidating `SLUG_SOURCE_COMPATIBLE_TYPES` and
 * `SORTABLE_FIELD_TYPES` into one module was that hand-maintained
 * copies in the editor / block builder / Zod superRefine had drifted
 * (the editor's local copy used to omit `date` and `number`, which
 * the Zod accepted — the dropdown silently hid valid options). These
 * tests freeze the contract so the next contributor adding a new
 * FieldType is forced to classify it explicitly.
 */

import { describe, expect, it } from "vitest";

import {
  SLUG_SOURCE_COMPATIBLE_TYPES,
  SORTABLE_FIELD_TYPES,
} from "./field-classification";
import {
  collectionDefSchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  type CollectionDef,
  type FieldDef,
  type FieldType,
} from "./schema";

/**
 * Every FieldType variant. TypeScript will complain if a new variant
 * is added to the Zod union and not added here (the helper below uses
 * the array exhaustively).
 */
const ALL_FIELD_TYPES: ReadonlyArray<FieldType> = [
  "text",
  "longText",
  "richText",
  "number",
  "boolean",
  "select",
  "multiSelect",
  "date",
  "url",
  "email",
  "color",
  "image",
  "file",
  "collectionRef",
  "multiCollectionRef",
  "puckContent",
];

/**
 * Build a minimal-but-valid FieldDef of the given type. Type-specific
 * required sub-fields (`options`, `targetCollection`, etc.) get
 * placeholder values that satisfy the schema.
 */
function minimalField(type: FieldType): FieldDef {
  const base = { id: "f_x", key: "x" } as const;
  switch (type) {
    case "text":
    case "longText":
    case "richText":
    case "url":
    case "email":
    case "color":
    case "image":
    case "date":
    case "number":
      return { ...base, type, required: false };
    case "file":
      return { ...base, type, required: false };
    case "boolean":
      return { ...base, type };
    case "select":
      return {
        ...base,
        type,
        required: false,
        options: [{ id: "o1", value: "a", label: "A" }],
      };
    case "multiSelect":
      return {
        ...base,
        type,
        options: [{ id: "o1", value: "a", label: "A" }],
      };
    case "collectionRef":
      return { ...base, type, required: false, targetCollection: "tour-dates" };
    case "multiCollectionRef":
      return { ...base, type, targetCollection: "tour-dates" };
    case "puckContent":
      return { ...base, type };
  }
}

function defWithField(field: FieldDef): CollectionDef {
  return {
    schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
    slug: "x",
    singularName: "x",
    pluralName: "xs",
    fields: [field],
    slugSourceFieldId: null,
    detailUrlPrefix: null,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: false,
  };
}

describe("SLUG_SOURCE_COMPATIBLE_TYPES", () => {
  // The schema's superRefine consults SLUG_SOURCE_COMPATIBLE_TYPES
  // directly — exporting the set from this module means a drift test
  // could be tautological. We re-derive the truth by parsing a def
  // that points slugSourceFieldId at a field of each type and check
  // success vs the set. If a future refactor decouples the schema
  // from this set (e.g., by inlining the literal again), this test
  // catches the divergence.
  it.each(ALL_FIELD_TYPES)(
    "%s: schema accepts as slugSourceFieldId iff in the set",
    (type) => {
      const def = {
        ...defWithField(minimalField(type)),
        slugSourceFieldId: "f_x",
      };
      const result = collectionDefSchema.safeParse(def);
      expect(result.success).toBe(SLUG_SOURCE_COMPATIBLE_TYPES.has(type));
    },
  );

  it("matches the expected classification", () => {
    // Freeze the current set. If a new FieldType is added or an
    // existing one is reclassified, this test forces an explicit
    // decision (update the set + update this expectation).
    expect([...SLUG_SOURCE_COMPATIBLE_TYPES].sort()).toEqual(
      ["date", "email", "longText", "number", "select", "text", "url"].sort(),
    );
  });
});

describe("SORTABLE_FIELD_TYPES", () => {
  it("matches the expected classification", () => {
    // SORTABLE_FIELD_TYPES is consulted by the SchemaEditor's
    // default-sort picker and the Collection block's sort-field
    // dropdown. No runtime Zod check uses it (the schema validates
    // only that `defaultSort.fieldId` exists, not that the field
    // type is sortable), so a freeze test is the right guard.
    expect([...SORTABLE_FIELD_TYPES].sort()).toEqual(
      [
        "boolean",
        "color",
        "date",
        "email",
        "longText",
        "number",
        "select",
        "text",
        "url",
      ].sort(),
    );
  });

  it("every classified type is a valid FieldType", () => {
    // Defensive: catches a typo in the set (e.g. "datee") that the
    // ReadonlySet<FieldType> type would already flag at build, but
    // the runtime assertion is cheap.
    for (const t of SORTABLE_FIELD_TYPES) {
      expect(ALL_FIELD_TYPES).toContain(t);
    }
  });
});
