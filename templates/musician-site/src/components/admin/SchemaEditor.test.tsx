import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SchemaEditor } from "./SchemaEditor";
import type { CollectionDef } from "@/lib/collections";

function tourDatesDef(): CollectionDef {
  return {
    schemaVersion: 1,
    slug: "tour-dates",
    singularName: "Tour Date",
    pluralName: "Tour Dates",
    isSingleton: false,
    fields: [
      { id: "f_date", key: "date", type: "date", required: true, systemLocked: true },
      { id: "f_venue", key: "venue", type: "text", required: true },
      {
        id: "f_status",
        key: "status",
        type: "select",
        required: true,
        options: [
          { id: "opt_on_sale", value: "on_sale", label: "On sale" },
          { id: "opt_sold_out", value: "sold_out", label: "Sold out" },
        ],
      },
    ],
    slugSourceFieldId: "f_venue",
    detailUrlPrefix: "/tour-dates",
    defaultSort: { mode: "fieldSort", fieldId: "f_date", direction: "asc" },
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
  };
}

describe("<SchemaEditor>", () => {
  it("renders the identity fields, the field list, and routing controls", () => {
    const html = renderToStaticMarkup(
      <SchemaEditor def={tourDatesDef()} onChange={vi.fn()} />,
    );
    // Identity
    expect(html).toContain("Singular name");
    expect(html).toContain("Plural name");
    // Field list — keys + types appear
    expect(html).toContain("date");
    expect(html).toContain("venue");
    expect(html).toContain("status");
    // The systemLocked pill
    expect(html).toContain("system-locked");
    expect(html).toContain("slug source");
    // Routing
    expect(html).toContain("Slug source");
    expect(html).toContain("Detail URL prefix");
    expect(html).toContain("Default sort");
  });

  it("does not render routing section for singletons", () => {
    const def: CollectionDef = { ...tourDatesDef(), isSingleton: true };
    const html = renderToStaticMarkup(<SchemaEditor def={def} onChange={vi.fn()} />);
    expect(html).not.toContain("Detail URL prefix");
    expect(html).not.toContain("Default sort");
  });

  it("renders a blocking issue list when issues are passed", () => {
    const html = renderToStaticMarkup(
      <SchemaEditor
        def={tourDatesDef()}
        onChange={vi.fn()}
        issues={[
          {
            kind: "type-transition-blocked",
            fieldId: "f_venue",
            fieldKey: "venue",
            message: "Cannot change venue from text to image — the conversion is lossy.",
          },
        ]}
      />,
    );
    expect(html).toContain("Blocked");
    expect(html).toContain("lossy");
  });

  it("renders a warning list when warnings are passed", () => {
    const html = renderToStaticMarkup(
      <SchemaEditor
        def={tourDatesDef()}
        onChange={vi.fn()}
        warnings={[
          {
            kind: "field-removed-with-data",
            fieldId: "f_venue",
            fieldKey: "venue",
            message: "“venue” has values on 3 items. Removing it deletes those values.",
          },
        ]}
      />,
    );
    expect(html).toContain("Heads-up");
    expect(html).toContain("3 items");
  });

  it("hides the Remove button for systemLocked fields", () => {
    const html = renderToStaticMarkup(
      <SchemaEditor def={tourDatesDef()} onChange={vi.fn()} />,
    );
    // The "date" field is systemLocked; ensure no Remove button shows up
    // immediately after it. The most direct check: count "Remove"
    // occurrences should equal the number of unlocked fields (venue +
    // status = 2).
    const occurrences = html.match(/>Remove</g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  it("renders the select options editor for a select field", () => {
    const html = renderToStaticMarkup(
      <SchemaEditor def={tourDatesDef()} onChange={vi.fn()} />,
    );
    expect(html).toContain("Options");
    expect(html).toContain('value="on_sale"');
    expect(html).toContain('value="sold_out"');
  });
});
