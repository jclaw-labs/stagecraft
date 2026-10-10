import { describe, expect, it, vi } from "vitest";

import {
  bindableSchema,
  binding,
  isBindableRef,
  literal,
  resolveBindable,
  resolveBinding,
  resolveRichTextBindable,
  resolveStringBindable,
  toBindableRef,
  STRING_VALUED_FIELD_TYPES,
} from "./binding";
import { FIXTURE_TIMESTAMP } from "../test-fixtures";
import type { CollectionDef, Item } from "../schema";
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
// resolveStringBindable — format (date presets + select label)
// ---------------------------------------------------------------------------

// Minimal def carrying one select field with options — enough for the
// `label` format lookup (formatBoundString only reads `fields[].options`).
const defWithSelect = {
  fields: [
    {
      id: "fld_s",
      key: "category",
      type: "select",
      required: false,
      options: [
        { id: "o1", value: "album", label: "Album" },
        { id: "o2", value: "ep", label: "EP" },
      ],
    },
  ],
} as unknown as CollectionDef;

/** A `binding` with a `format` (the helper export omits it). */
function fmtBinding(fieldId: string, format: "year" | "weekday-day" | "full" | "label") {
  return { kind: "binding" as const, fieldId, format };
}

describe("resolveStringBindable — date formats", () => {
  const item = makeItem({ fld_d: { type: "date", value: "2026-05-10" } });

  it("year → UTC calendar year", () => {
    expect(resolveStringBindable(fmtBinding("fld_d", "year"), item)).toBe("2026");
  });

  it("full → 'May 10, 2026' (UTC, no timezone drift)", () => {
    expect(resolveStringBindable(fmtBinding("fld_d", "full"), item)).toBe("May 10, 2026");
  });

  it("weekday-day → short weekday + month + day", () => {
    // Don't hardcode the weekday (avoid miscomputing it); assert the shape.
    expect(resolveStringBindable(fmtBinding("fld_d", "weekday-day"), item)).toMatch(
      /^\w{3}, \w{3} \d{1,2}$/,
    );
  });

  it("formats a date that carries a time component in UTC (no drift across midnight)", () => {
    // A late-UTC timestamp must still read as its UTC calendar day, not roll
    // forward/back under a local timezone.
    const timed = makeItem({ fld_d: { type: "date", value: "2026-05-10T23:30:00.000Z" } });
    expect(resolveStringBindable(fmtBinding("fld_d", "full"), timed)).toBe("May 10, 2026");
    expect(resolveStringBindable(fmtBinding("fld_d", "year"), timed)).toBe("2026");
  });

  it("leaves the raw value when the date can't be parsed", () => {
    const bad = makeItem({ fld_d: { type: "date", value: "not-a-date" } });
    expect(resolveStringBindable(fmtBinding("fld_d", "year"), bad)).toBe("not-a-date");
  });

  it("ignores a date format on a non-date field (renders raw)", () => {
    const textItem = makeItem({ fld_d: { type: "text", value: "hello" } });
    expect(resolveStringBindable(fmtBinding("fld_d", "year"), textItem)).toBe("hello");
  });
});

describe("resolveStringBindable — select label format", () => {
  const item = makeItem({ fld_s: { type: "select", value: "album" } });

  it("maps the select value to its option label when the def is supplied", () => {
    expect(resolveStringBindable(fmtBinding("fld_s", "label"), item, defWithSelect)).toBe("Album");
  });

  it("falls back to the raw value without a def (label lookup needs options)", () => {
    expect(resolveStringBindable(fmtBinding("fld_s", "label"), item)).toBe("album");
  });

  it("falls back to the raw value when no option matches", () => {
    const unknown = makeItem({ fld_s: { type: "select", value: "single" } });
    expect(resolveStringBindable(fmtBinding("fld_s", "label"), unknown, defWithSelect)).toBe(
      "single",
    );
  });

  it("ignores a label format on a non-select field (renders raw)", () => {
    const dateItem = makeItem({ fld_s: { type: "date", value: "2026-05-10" } });
    expect(resolveStringBindable(fmtBinding("fld_s", "label"), dateItem, defWithSelect)).toBe(
      "2026-05-10",
    );
  });

  it("returns the raw empty string when the select value is blank", () => {
    const blank = makeItem({ fld_s: { type: "select", value: "" } });
    expect(resolveStringBindable(fmtBinding("fld_s", "label"), blank, defWithSelect)).toBe("");
  });

  it("a binding with no format still returns the raw value", () => {
    expect(resolveStringBindable(binding("fld_s"), item, defWithSelect)).toBe("album");
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

  it("accepts a binding with a valid format", () => {
    expect(textBindable.parse({ kind: "binding", fieldId: "fld_v", format: "year" })).toEqual({
      kind: "binding",
      fieldId: "fld_v",
      format: "year",
    });
  });

  it("rejects a binding with an unknown format", () => {
    expect(
      textBindable.safeParse({ kind: "binding", fieldId: "fld_v", format: "bogus" }).success,
    ).toBe(false);
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

  it("accepts a plain literal — the page form (#349)", () => {
    expect(textBindable.parse("Hello")).toBe("Hello");
    expect(textBindable.safeParse(42).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBindableRef / toBindableRef
// ---------------------------------------------------------------------------

describe("isBindableRef", () => {
  it("recognises both object arms", () => {
    expect(isBindableRef({ kind: "literal", value: "x" })).toBe(true);
    expect(isBindableRef({ kind: "literal", value: undefined })).toBe(true);
    expect(isBindableRef({ kind: "binding", fieldId: "f_x" })).toBe(true);
  });

  it("treats plain literals as literals", () => {
    for (const value of ["text", "", 0, null, undefined, { type: "doc", content: [] }, ["a"]]) {
      expect(isBindableRef(value)).toBe(false);
    }
  });

  it("rejects malformed refs", () => {
    expect(isBindableRef({ kind: "literal" })).toBe(false);
    expect(isBindableRef({ kind: "binding" })).toBe(false);
    expect(isBindableRef({ kind: "binding", fieldId: 1 })).toBe(false);
    expect(isBindableRef({ kind: "other", value: "x" })).toBe(false);
  });
});

describe("toBindableRef", () => {
  it("wraps a plain literal", () => {
    expect(toBindableRef("Hi")).toEqual({ kind: "literal", value: "Hi" });
  });

  it("returns an object ref by identity", () => {
    const ref = binding<string>("f_x");
    expect(toBindableRef(ref)).toBe(ref);
  });
});

// ---------------------------------------------------------------------------
// resolveRichTextBindable
// ---------------------------------------------------------------------------

describe("resolveRichTextBindable", () => {
  const doc = { type: "doc" as const, content: [{ type: "paragraph" }] };
  const item = makeItem({
    f_body: { type: "richText", value: doc },
    f_bio: { type: "longText", value: "A bio." },
    f_count: { type: "number", value: 3 },
  });

  it("returns a literal as-is, wrapped or plain", () => {
    expect(resolveRichTextBindable("Plain", item)).toBe("Plain");
    expect(resolveRichTextBindable(literal("Wrapped"), item)).toBe("Wrapped");
  });

  it("resolves a richText binding to its Tiptap doc", () => {
    expect(resolveRichTextBindable(binding("f_body"), item)).toBe(doc);
  });

  it("resolves a string-valued binding to its text", () => {
    expect(resolveRichTextBindable(binding("f_bio"), item)).toBe("A bio.");
  });

  it("returns undefined for a missing or non-string field", () => {
    expect(resolveRichTextBindable(binding("f_missing"), item)).toBeUndefined();
    expect(resolveRichTextBindable(binding("f_count"), item)).toBeUndefined();
  });
});
