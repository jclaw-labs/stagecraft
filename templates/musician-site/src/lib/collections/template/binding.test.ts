import { describe, expect, it, vi } from "vitest";

import {
  bindableSchema,
  binding,
  literal,
  resolveBindable,
  resolveBinding,
  resolveStringBindable,
  STRING_VALUED_FIELD_TYPES,
} from "./binding";
import { FIXTURE_TIMESTAMP } from "../test-fixtures";
import type { Item } from "../schema";
import { z } from "zod";

function makeItem(values: Item["values"]): Item {
  return {
    id: "item_test",
    slug: "test",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    values,
  };
}

// ---------------------------------------------------------------------------
// resolveBindable
// ---------------------------------------------------------------------------

describe("resolveBindable — literal arm", () => {
  it("returns the literal value untouched", () => {
    expect(resolveBindable(literal("Hello"), makeItem({}), "text")).toBe("Hello");
    expect(resolveBindable(literal(42), makeItem({}), "number")).toBe(42);
    expect(resolveBindable(literal(true), makeItem({}), "boolean")).toBe(true);
  });

  it("doesn't look at the item or expectedType for literals", () => {
    // A literal string with expectedType="number" still resolves to the
    // literal string. Literals aren't subject to the type-mismatch
    // check (the editor enforces that the literal value matches the
    // expected type at authoring time).
    expect(resolveBindable(literal("not-a-number"), makeItem({}), "text")).toBe("not-a-number");
  });
});

describe("resolveBindable — binding arm", () => {
  it("returns the matching field's value", () => {
    const item = makeItem({ fld_v: { type: "text", value: "Paris" } });
    expect(resolveBindable(binding<string>("fld_v"), item, "text")).toBe("Paris");
  });

  it("returns undefined when the field is missing from the item", () => {
    const item = makeItem({});
    expect(resolveBindable(binding<string>("fld_nope"), item, "text")).toBeUndefined();
  });

  it("returns undefined when the field's type doesn't match the expected type", () => {
    const item = makeItem({ fld_v: { type: "number", value: 5 } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveBindable(binding<string>("fld_v"), item, "text")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("resolves the various FieldValue kinds", () => {
    const item = makeItem({
      fld_t: { type: "text", value: "Hi" },
      fld_n: { type: "number", value: 7 },
      fld_b: { type: "boolean", value: true },
      fld_d: { type: "date", value: "2026-07-15" },
      fld_u: { type: "url", value: "https://example.com" },
      fld_ms: { type: "multiSelect", value: ["a", "b"] },
    });
    expect(resolveBindable(binding<string>("fld_t"), item, "text")).toBe("Hi");
    expect(resolveBindable(binding<number>("fld_n"), item, "number")).toBe(7);
    expect(resolveBindable(binding<boolean>("fld_b"), item, "boolean")).toBe(true);
    expect(resolveBindable(binding<string>("fld_d"), item, "date")).toBe("2026-07-15");
    expect(resolveBindable(binding<string>("fld_u"), item, "url")).toBe("https://example.com");
    expect(resolveBindable(binding<string[]>("fld_ms"), item, "multiSelect")).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// resolveBinding (fieldId only, no literal arm)
// ---------------------------------------------------------------------------

describe("resolveBinding", () => {
  it("resolves a fieldId directly", () => {
    const item = makeItem({ fld_v: { type: "text", value: "Hello" } });
    expect(resolveBinding("fld_v", item, "text")).toBe("Hello");
  });

  it("returns undefined for a missing field", () => {
    expect(resolveBinding("fld_nope", makeItem({}), "text")).toBeUndefined();
  });

  it("returns undefined for a type mismatch (and warns)", () => {
    const item = makeItem({ fld_v: { type: "image", value: { id: "x", alt: "y" } as never } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveBinding("fld_v", item, "text")).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// resolveStringBindable — accepts any string-valued FieldValue kind
// ---------------------------------------------------------------------------

describe("resolveStringBindable", () => {
  it("returns the literal value untouched", () => {
    expect(resolveStringBindable(literal("Hello"), makeItem({}))).toBe("Hello");
  });

  it("accepts every string-valued field kind", () => {
    const item = makeItem({
      fld_t: { type: "text", value: "t" },
      fld_lt: { type: "longText", value: "lt" },
      fld_d: { type: "date", value: "2026-07-15" },
      fld_u: { type: "url", value: "https://x.com" },
      fld_e: { type: "email", value: "a@b.com" },
      fld_c: { type: "color", value: "#abcdef" },
      fld_s: { type: "select", value: "on_sale" },
    });
    expect(resolveStringBindable(binding("fld_t"), item)).toBe("t");
    expect(resolveStringBindable(binding("fld_lt"), item)).toBe("lt");
    expect(resolveStringBindable(binding("fld_d"), item)).toBe("2026-07-15");
    expect(resolveStringBindable(binding("fld_u"), item)).toBe("https://x.com");
    expect(resolveStringBindable(binding("fld_e"), item)).toBe("a@b.com");
    expect(resolveStringBindable(binding("fld_c"), item)).toBe("#abcdef");
    expect(resolveStringBindable(binding("fld_s"), item)).toBe("on_sale");
  });

  it("returns undefined for non-string-valued field kinds", () => {
    const item = makeItem({ fld_n: { type: "number", value: 5 } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveStringBindable(binding("fld_n"), item)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns undefined for a missing field", () => {
    expect(resolveStringBindable(binding("fld_missing"), makeItem({}))).toBeUndefined();
  });

  it("STRING_VALUED_FIELD_TYPES export lists the seven accepted kinds", () => {
    expect(STRING_VALUED_FIELD_TYPES.slice().sort()).toEqual(
      ["color", "date", "email", "longText", "select", "text", "url"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// bindableSchema (Zod)
// ---------------------------------------------------------------------------

describe("bindableSchema", () => {
  const textBindable = bindableSchema(z.string());

  it("accepts a literal", () => {
    expect(textBindable.parse({ kind: "literal", value: "Hello" })).toEqual({
      kind: "literal",
      value: "Hello",
    });
  });

  it("accepts a binding", () => {
    expect(textBindable.parse({ kind: "binding", fieldId: "fld_v" })).toEqual({
      kind: "binding",
      fieldId: "fld_v",
    });
  });

  it("rejects a missing kind discriminator", () => {
    expect(textBindable.safeParse({ value: "Hello" }).success).toBe(false);
  });

  it("rejects a literal whose value doesn't match the inner schema", () => {
    expect(textBindable.safeParse({ kind: "literal", value: 42 }).success).toBe(false);
  });

  it("rejects a binding with an empty fieldId", () => {
    expect(textBindable.safeParse({ kind: "binding", fieldId: "" }).success).toBe(false);
  });
});
