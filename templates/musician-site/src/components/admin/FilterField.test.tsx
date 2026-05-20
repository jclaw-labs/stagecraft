/**
 * Smoke tests for the visual clause builder. Round-trip semantics
 * live in `filter-field-state.test.ts`; these confirm the React
 * surface mounts with each clause shape without throwing, and that
 * the right controls + value editors render per operator.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FilterField } from "./FilterField";
import type { Filter } from "@/lib/collections/filter-schema";
import type { CollectionDef } from "@/lib/collections";

const SOURCE_DEF: CollectionDef = {
  schemaVersion: 1,
  slug: "tour-dates",
  singularName: "Tour date",
  pluralName: "Tour dates",
  isSingleton: false,
  detailUrlPrefix: "/shows",
  slugSourceFieldId: null,
  defaultSort: null,
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  fields: [
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
    { id: "f_date", key: "date", type: "date", required: false },
    { id: "f_hero", key: "hero", type: "image", required: false },
  ],
};

const CURRENT_ITEM_DEF: CollectionDef = {
  ...SOURCE_DEF,
  slug: "posts",
  singularName: "Post",
  pluralName: "Posts",
  fields: [
    { id: "p_title", key: "title", type: "text", required: true },
    { id: "p_published", key: "publishedAt", type: "date", required: false },
  ],
};

describe("<FilterField> — visual UI", () => {
  it("renders the empty-state hint when value is null", () => {
    const html = renderToStaticMarkup(
      <FilterField
        value={null}
        onChange={vi.fn()}
        sourceDef={SOURCE_DEF}
        currentItemDef={CURRENT_ITEM_DEF}
      />,
    );
    expect(html).toContain("No clauses");
    expect(html).toContain("+ Add clause");
    expect(html).toContain("Raw JSON");
  });

  it("renders a literal-equals clause with the source field options", () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    const html = renderToStaticMarkup(
      <FilterField
        value={filter}
        onChange={vi.fn()}
        sourceDef={SOURCE_DEF}
        currentItemDef={CURRENT_ITEM_DEF}
      />,
    );
    // Source field picker carries the filterable fields, not the
    // resolver-incompatible image field.
    expect(html).toContain("city (text)");
    expect(html).toContain("capacity (number)");
    expect(html).toContain("status (select)");
    expect(html).not.toContain("hero (image)");
    // Operator picker shows "equals" selected.
    expect(html).toMatch(/value="equals" selected/);
    // The literal text input carries the value.
    expect(html).toContain('value="Paris"');
  });

  it("renders a currentItemField clause with the containing-template fields", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_city",
          op: "equals",
          value: { kind: "currentItemField", fieldId: "p_title" },
        },
      ],
    };
    const html = renderToStaticMarkup(
      <FilterField
        value={filter}
        onChange={vi.fn()}
        sourceDef={SOURCE_DEF}
        currentItemDef={CURRENT_ITEM_DEF}
      />,
    );
    expect(html).toContain("From current item field");
    // The containing collection's field key appears in the dropdown.
    expect(html).toContain("title (text)");
    expect(html).toMatch(/value="p_title" selected/);
  });

  it("renders a currentItemId clause as a plain label", () => {
    const filter: Filter = {
      all: [{ field: "f_city", op: "equals", value: { kind: "currentItemId" } }],
    };
    const html = renderToStaticMarkup(
      <FilterField
        value={filter}
        onChange={vi.fn()}
        sourceDef={SOURCE_DEF}
        currentItemDef={CURRENT_ITEM_DEF}
      />,
    );
    expect(html).toContain("current item ID");
  });

  it("renders the AND/OR toggle only when there are 2+ clauses", () => {
    const oneClause: Filter = {
      all: [{ field: "f_city", op: "equals", value: { kind: "literal", value: "" } }],
    };
    const oneHtml = renderToStaticMarkup(
      <FilterField value={oneClause} onChange={vi.fn()} sourceDef={SOURCE_DEF} />,
    );
    expect(oneHtml).not.toContain("Clause join mode");
    expect(oneHtml).not.toContain("all clauses (AND)");

    const twoClauses: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "" } },
        { field: "f_capacity", op: "gt", value: { kind: "literal", value: 100 } },
      ],
    };
    const twoHtml = renderToStaticMarkup(
      <FilterField value={twoClauses} onChange={vi.fn()} sourceDef={SOURCE_DEF} />,
    );
    expect(twoHtml).toContain("all clauses (AND)");
    expect(twoHtml).toContain("any clause (OR)");
  });

  it("preserves `any` (OR) mode in the toggle", () => {
    const filter: Filter = {
      any: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Lyon" } },
      ],
    };
    const html = renderToStaticMarkup(
      <FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />,
    );
    expect(html).toMatch(/value="any" selected/);
  });

  it("renders `isEmpty` clauses without a value editor", () => {
    const filter: Filter = { all: [{ field: "f_city", op: "isEmpty" }] };
    const html = renderToStaticMarkup(
      <FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />,
    );
    expect(html).toMatch(/value="isEmpty" selected/);
    // No value editor — no literal input, no value-source toggle.
    expect(html).not.toContain("Value source");
    expect(html).not.toContain("From current item field");
  });

  it("renders excludeCurrentItem with no field picker and an explanatory hint", () => {
    const filter: Filter = { all: [{ excludeCurrentItem: true }] };
    const html = renderToStaticMarkup(
      <FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />,
    );
    expect(html).toMatch(/value="excludeCurrentItem" selected/);
    expect(html).toContain("(no field)");
    expect(html).toContain("Hides the item");
  });

  it("renders `in` clauses with one value editor per value + an add button", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_status",
          op: "in",
          values: [
            { kind: "literal", value: "on_sale" },
            { kind: "literal", value: "sold_out" },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />,
    );
    expect(html).toContain("+ Add value");
    // Two value rows surface both select values pre-selected.
    expect(html).toMatch(/value="on_sale" selected/);
    expect(html).toMatch(/value="sold_out" selected/);
  });

  it("hides the `From current item field` option when no current item is available", () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    // No currentItemDef → no host current item fields. The option
    // must not appear, because the resolver can't dereference an
    // empty fieldId.
    const html = renderToStaticMarkup(
      <FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />,
    );
    expect(html).not.toContain("From current item field");
  });

  it("keeps the `From current item field` option visible if the existing value already uses it (so it stays editable)", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_city",
          op: "equals",
          value: { kind: "currentItemField", fieldId: "p_title" },
        },
      ],
    };
    // No currentItemDef passed in — but the value already references
    // a currentItemField. Hiding the option entirely would silently
    // strip the value's editable label; keep the option visible so the
    // dropdown's current selection still renders.
    const html = renderToStaticMarkup(
      <FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />,
    );
    expect(html).toContain("From current item field");
  });

  it("renders the raw JSON pane initialised with the serialised filter", () => {
    const filter: Filter = {
      all: [{ field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } }],
    };
    const html = renderToStaticMarkup(
      <FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />,
    );
    // The textarea's `value` mirrors the JSON pretty-printed.
    expect(html).toContain("&quot;field&quot;: &quot;f_city&quot;");
  });
});
