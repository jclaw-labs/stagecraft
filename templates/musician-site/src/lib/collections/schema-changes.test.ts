import { describe, expect, it } from "vitest";

import {
  canTransition,
  countItemsUsingField,
  describeIssue,
  describeWarning,
  itemsUsingField,
  LOSSLESS_TYPE_TRANSITIONS,
  migrateItemValues,
  validateSchemaChange,
} from "./schema-changes";
import type { CollectionDef, Item } from "./schema";
import { FIXTURE_TIMESTAMP, tourDateItem, tourDatesDef } from "./test-fixtures";

function itemValuesUsing(fieldId: string, value = "x"): Item["values"] {
  return { [fieldId]: { type: "text" as const, value } };
}

function emptyItem(slug: string, values: Item["values"] = {}): Item {
  return {
    id: `item_${slug}`,
    slug,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    values,
  };
}

// ---------------------------------------------------------------------------
// canTransition
// ---------------------------------------------------------------------------

describe("canTransition", () => {
  it("returns true for identity transitions", () => {
    expect(canTransition("text", "text")).toBe(true);
    expect(canTransition("number", "number")).toBe(true);
  });

  it("allows the ADR §11 lossless transitions", () => {
    expect(canTransition("text", "longText")).toBe(true);
    expect(canTransition("longText", "text")).toBe(true);
    expect(canTransition("text", "url")).toBe(true);
    expect(canTransition("text", "email")).toBe(true);
    expect(canTransition("text", "color")).toBe(true);
    expect(canTransition("url", "text")).toBe(true);
    expect(canTransition("select", "multiSelect")).toBe(true);
    expect(canTransition("multiSelect", "select")).toBe(true);
  });

  it("blocks lossy transitions", () => {
    expect(canTransition("puckContent", "text")).toBe(false);
    expect(canTransition("image", "text")).toBe(false);
    expect(canTransition("number", "text")).toBe(false);
    expect(canTransition("richText", "text")).toBe(false);
  });

  it("LOSSLESS_TYPE_TRANSITIONS keys cover every FieldType", () => {
    // Compile-time check via type system that the record is exhaustive.
    // Sanity-runtime: the table has 16 entries (one per FieldType).
    expect(Object.keys(LOSSLESS_TYPE_TRANSITIONS).length).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// countItemsUsingField / itemsUsingField
// ---------------------------------------------------------------------------

describe("countItemsUsingField", () => {
  it("counts items with a value present for the field", () => {
    const items = [
      emptyItem("a", itemValuesUsing("f_x")),
      emptyItem("b", itemValuesUsing("f_x")),
      emptyItem("c", {}),
    ];
    expect(countItemsUsingField(items, "f_x")).toBe(2);
    expect(countItemsUsingField(items, "f_missing")).toBe(0);
  });

  it("itemsUsingField returns the matching items", () => {
    const items = [
      emptyItem("a", itemValuesUsing("f_x", "alpha")),
      emptyItem("b", {}),
      emptyItem("c", itemValuesUsing("f_x", "gamma")),
    ];
    expect(itemsUsingField(items, "f_x").map((i) => i.slug)).toEqual(["a", "c"]);
  });
});

// ---------------------------------------------------------------------------
// validateSchemaChange — top-level scenarios
// ---------------------------------------------------------------------------

describe("validateSchemaChange — happy paths", () => {
  it("reports ok=true with no issues for an unchanged def", () => {
    const def = tourDatesDef();
    const items = [tourDateItem("paris-2026", "2026-07-15", "X", "Paris")];
    const report = validateSchemaChange(def, def, items);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("allows adding a new field to a non-empty collection", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: [
        ...oldDef.fields,
        { id: "f_new", key: "newField", type: "text" as const, required: false },
      ],
    };
    const items = [tourDateItem("paris-2026", "2026-07-15", "X", "Paris")];
    const report = validateSchemaChange(oldDef, newDef, items);
    expect(report.ok).toBe(true);
  });

  it("allows reordering fields", () => {
    const oldDef = tourDatesDef();
    const newDef = { ...oldDef, fields: [...oldDef.fields].reverse() };
    const items = [tourDateItem("paris-2026", "2026-07-15", "X", "Paris")];
    expect(validateSchemaChange(oldDef, newDef, items).ok).toBe(true);
  });

  it("allows renaming a field (key changes, id stays)", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_venue" ? { ...f, key: "location" } : f,
      ) as CollectionDef["fields"],
    };
    expect(validateSchemaChange(oldDef, newDef, []).ok).toBe(true);
  });

  it("allows required → optional always", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_venue" && f.type === "text" ? { ...f, required: false } : f,
      ) as CollectionDef["fields"],
    };
    const items = [
      emptyItem("paris-2026", {
        f_date: { type: "date", value: "2026-07-15" },
        f_city: { type: "text", value: "Paris" },
        f_status: { type: "select", value: "on_sale" },
        // f_venue absent — required→optional was supposed to allow this.
      }),
    ];
    expect(validateSchemaChange(oldDef, newDef, items).ok).toBe(true);
  });
});

describe("validateSchemaChange — destructive changes", () => {
  it("warns when a field with values is removed", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: oldDef.fields.filter((f) => f.id !== "f_venue"),
    };
    const items = [tourDateItem("paris-2026", "2026-07-15", "La Cigale", "Paris")];
    const report = validateSchemaChange(oldDef, newDef, items);
    expect(report.ok).toBe(true); // warning, not error
    expect(report.warnings).toContainEqual({
      kind: "field-removed-with-data",
      fieldId: "f_venue",
      fieldKey: "venue",
      affectedItemCount: 1,
    });
  });

  it("blocks removal of a systemLocked field", () => {
    const oldDef: CollectionDef = {
      ...tourDatesDef(),
      fields: [
        { id: "f_locked", key: "locked", type: "text", required: true, systemLocked: true },
      ],
    };
    const newDef: CollectionDef = { ...oldDef, fields: [] };
    const report = validateSchemaChange(oldDef, newDef, []);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatchObject({ kind: "system-locked-deleted", fieldId: "f_locked" });
  });

  it("blocks renaming a systemLocked field", () => {
    const oldDef: CollectionDef = {
      ...tourDatesDef(),
      fields: [
        { id: "f_locked", key: "title", type: "text", required: true, systemLocked: true },
      ],
    };
    const newDef: CollectionDef = {
      ...oldDef,
      fields: [
        { id: "f_locked", key: "renamed", type: "text", required: true, systemLocked: true },
      ],
    };
    expect(validateSchemaChange(oldDef, newDef, []).ok).toBe(false);
  });

  it("blocks retype of a systemLocked field even for a lossless transition", () => {
    const oldDef: CollectionDef = {
      ...tourDatesDef(),
      fields: [
        { id: "f_locked", key: "x", type: "text", required: true, systemLocked: true },
      ],
    };
    const newDef: CollectionDef = {
      ...oldDef,
      fields: [
        { id: "f_locked", key: "x", type: "longText", required: true, systemLocked: true },
      ],
    };
    expect(validateSchemaChange(oldDef, newDef, []).ok).toBe(false);
  });

  it("blocks a lossy type transition on a non-systemLocked field", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_venue" ? { ...f, type: "image" as const, required: false } : f,
      ) as CollectionDef["fields"],
    };
    const report = validateSchemaChange(oldDef, newDef, []);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatchObject({ kind: "type-transition-blocked" });
  });

  it("blocks optional → required when items are missing the value", () => {
    const oldDef: CollectionDef = {
      ...tourDatesDef(),
      fields: tourDatesDef().fields.map((f) =>
        f.id === "f_venue" && f.type === "text" ? { ...f, required: false } : f,
      ) as CollectionDef["fields"],
    };
    const newDef: CollectionDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_venue" && f.type === "text" ? { ...f, required: true } : f,
      ) as CollectionDef["fields"],
    };
    const items: Item[] = [
      emptyItem("missing", {}),
      emptyItem("present", {
        f_venue: { type: "text", value: "X" },
      }),
    ];
    const report = validateSchemaChange(oldDef, newDef, items);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatchObject({
      kind: "required-flag-blocked",
      missingItemCount: 1,
    });
  });

  it("allows optional → required when every item has a value", () => {
    const oldDef: CollectionDef = {
      ...tourDatesDef(),
      fields: tourDatesDef().fields.map((f) =>
        f.id === "f_venue" && f.type === "text" ? { ...f, required: false } : f,
      ) as CollectionDef["fields"],
    };
    const newDef: CollectionDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_venue" && f.type === "text" ? { ...f, required: true } : f,
      ) as CollectionDef["fields"],
    };
    // Items must satisfy the full schema (every required field present)
    // — the new whole-item validator catches missing required fields,
    // not just the one being toggled.
    const items: Item[] = [
      tourDateItem("a", "2026-07-15", "A", "Paris"),
      tourDateItem("b", "2026-07-16", "B", "Lyon"),
    ];
    expect(validateSchemaChange(oldDef, newDef, items).ok).toBe(true);
  });

  it("reports duplicate field ids and keys", () => {
    const def: CollectionDef = {
      ...tourDatesDef(),
      fields: [
        { id: "f_x", key: "a", type: "text", required: true },
        { id: "f_x", key: "b", type: "text", required: true },
        { id: "f_y", key: "b", type: "text", required: true },
      ],
    };
    const report = validateSchemaChange(tourDatesDef(), def, []);
    expect(report.issues).toContainEqual({ kind: "duplicate-field-id", fieldId: "f_x" });
    expect(report.issues).toContainEqual({ kind: "duplicate-field-key", fieldKey: "b" });
  });
});

describe("describe helpers", () => {
  it("renders human-readable issue messages", () => {
    expect(
      describeIssue({ kind: "system-locked-deleted", fieldId: "x", fieldKey: "title" }),
    ).toContain("title");
    expect(
      describeIssue({
        kind: "type-transition-blocked",
        fieldId: "x",
        fieldKey: "venue",
        from: "image",
        to: "text",
      }),
    ).toContain("lossy");
  });

  it("renders human-readable warning messages", () => {
    expect(
      describeWarning({
        kind: "field-removed-with-data",
        fieldId: "x",
        fieldKey: "venue",
        affectedItemCount: 3,
      }),
    ).toContain("3 items");
  });

  it("renders a message for item-invalid-under-new-schema issues", () => {
    expect(
      describeIssue({
        kind: "item-invalid-under-new-schema",
        itemSlug: "paris-2026",
        path: "f_venue.value",
        message: "String must contain at most 5 character(s)",
      }),
    ).toContain("paris-2026");
  });
});

// ---------------------------------------------------------------------------
// migrateItemValues — pure data rewrite for lossless type transitions
// ---------------------------------------------------------------------------

describe("migrateItemValues", () => {
  it("returns no items when no type changed", () => {
    const def = tourDatesDef();
    const items = [tourDateItem("paris-2026", "2026-07-15", "X", "Paris")];
    expect(migrateItemValues(def, def, items)).toEqual([]);
  });

  it("relabels the value's type discriminator for text → longText", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_venue" && f.type === "text" ? { ...f, type: "longText" as const } : f,
      ) as CollectionDef["fields"],
    };
    const items = [tourDateItem("paris-2026", "2026-07-15", "La Cigale", "Paris")];
    const migrated = migrateItemValues(oldDef, newDef, items);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].values.f_venue).toEqual({ type: "longText", value: "La Cigale" });
  });

  it("wraps the scalar in an array for select → multiSelect", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_status" && f.type === "select"
          ? { ...f, type: "multiSelect" as const, options: f.options }
          : f,
      ) as CollectionDef["fields"],
    };
    const items = [tourDateItem("paris-2026", "2026-07-15", "X", "Paris")];
    const migrated = migrateItemValues(oldDef, newDef, items);
    expect(migrated[0].values.f_status).toEqual({ type: "multiSelect", value: ["on_sale"] });
  });

  it("takes the first array entry for multiSelect → select", () => {
    const oldDef: CollectionDef = {
      ...tourDatesDef(),
      fields: tourDatesDef().fields.map((f) =>
        f.id === "f_status" && f.type === "select"
          ? { ...f, type: "multiSelect" as const, options: f.options }
          : f,
      ) as CollectionDef["fields"],
    };
    const newDef: CollectionDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_status" && f.type === "multiSelect"
          ? { ...f, type: "select" as const, required: true, options: f.options }
          : f,
      ) as CollectionDef["fields"],
    };
    const items: Item[] = [
      {
        id: "item_a",
        slug: "a",
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP,
        values: {
          f_date: { type: "date", value: "2026-07-15" },
          f_venue: { type: "text", value: "X" },
          f_city: { type: "text", value: "Paris" },
          f_status: { type: "multiSelect", value: ["on_sale", "sold_out"] },
        },
      },
    ];
    const migrated = migrateItemValues(oldDef, newDef, items);
    expect(migrated[0].values.f_status).toEqual({ type: "select", value: "on_sale" });
  });

  it("drops the value entirely for multiSelect → select with an empty array", () => {
    const oldDef: CollectionDef = {
      ...tourDatesDef(),
      fields: tourDatesDef().fields.map((f) =>
        f.id === "f_status" && f.type === "select"
          ? { ...f, type: "multiSelect" as const, options: f.options }
          : f,
      ) as CollectionDef["fields"],
    };
    const newDef: CollectionDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_status" && f.type === "multiSelect"
          ? { ...f, type: "select" as const, required: true, options: f.options }
          : f,
      ) as CollectionDef["fields"],
    };
    const items: Item[] = [
      {
        id: "item_a",
        slug: "a",
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP,
        values: {
          f_date: { type: "date", value: "2026-07-15" },
          f_venue: { type: "text", value: "X" },
          f_city: { type: "text", value: "Paris" },
          f_status: { type: "multiSelect", value: [] },
        },
      },
    ];
    const migrated = migrateItemValues(oldDef, newDef, items);
    expect(migrated[0].values.f_status).toBeUndefined();
  });

  it("leaves items alone when the transitioned field has no value", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_venue" && f.type === "text" ? { ...f, type: "longText" as const } : f,
      ) as CollectionDef["fields"],
    };
    const items: Item[] = [
      {
        id: "item_a",
        slug: "a",
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP,
        values: { f_date: { type: "date", value: "2026-07-15" } }, // no f_venue
      },
    ];
    expect(migrateItemValues(oldDef, newDef, items)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateSchemaChange — whole-item validation against the new dynamic Zod
// ---------------------------------------------------------------------------

describe("validateSchemaChange — item validation under the new schema", () => {
  it("blocks removing a select option that an item references", () => {
    const oldDef: CollectionDef = tourDatesDef();
    const newDef: CollectionDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_status" && f.type === "select"
          ? {
              ...f,
              // Drop the `on_sale` option that the test item references.
              options: f.options.filter((opt) => opt.value !== "on_sale"),
            }
          : f,
      ) as CollectionDef["fields"],
    };
    const items = [tourDateItem("paris-2026", "2026-07-15", "X", "Paris")];
    const report = validateSchemaChange(oldDef, newDef, items);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        kind: "item-invalid-under-new-schema",
        itemSlug: "paris-2026",
      }),
    );
  });

  it("blocks tightening text.maxLength when an item exceeds the new bound", () => {
    const oldDef: CollectionDef = tourDatesDef();
    const newDef: CollectionDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_venue" && f.type === "text" ? { ...f, maxLength: 3 } : f,
      ) as CollectionDef["fields"],
    };
    const items = [tourDateItem("paris-2026", "2026-07-15", "La Cigale", "Paris")];
    const report = validateSchemaChange(oldDef, newDef, items);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        kind: "item-invalid-under-new-schema",
        itemSlug: "paris-2026",
      }),
    );
  });

  it("blocks adding a brand-new required field while items exist", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: [
        ...oldDef.fields,
        { id: "f_ticket_url", key: "ticketUrl", type: "url" as const, required: true },
      ],
    };
    const items = [tourDateItem("paris-2026", "2026-07-15", "X", "Paris")];
    const report = validateSchemaChange(oldDef, newDef, items);
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        kind: "item-invalid-under-new-schema",
        itemSlug: "paris-2026",
      }),
    );
  });

  it("accepts adding a brand-new OPTIONAL field while items exist", () => {
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: [
        ...oldDef.fields,
        { id: "f_ticket_url", key: "ticketUrl", type: "url" as const, required: false },
      ],
    };
    const items = [tourDateItem("paris-2026", "2026-07-15", "X", "Paris")];
    expect(validateSchemaChange(oldDef, newDef, items).ok).toBe(true);
  });

  it("accepts a lossless type transition by validating the MIGRATED view", () => {
    // text → longText: existing item has {type: "text"}; the validator
    // would reject if it parsed the raw item, but migrateItemValues
    // rewrites the discriminator first.
    const oldDef = tourDatesDef();
    const newDef = {
      ...oldDef,
      fields: oldDef.fields.map((f) =>
        f.id === "f_venue" && f.type === "text" ? { ...f, type: "longText" as const } : f,
      ) as CollectionDef["fields"],
    };
    const items = [tourDateItem("paris-2026", "2026-07-15", "La Cigale", "Paris")];
    expect(validateSchemaChange(oldDef, newDef, items).ok).toBe(true);
  });
});
