/**
 * Interaction tests for FilterField — driving the visual clause
 * builder via user-event in jsdom. Catches regressions the
 * `renderToStaticMarkup` smoke tests can't see (event handlers,
 * the morph-on-operator-change wiring, stable per-clause keys
 * across removals).
 *
 * Lives in its own file because vitest's default `environment` is
 * `"node"`; this file opts into jsdom via the directive below so
 * we don't pay the jsdom startup cost on every other test file.
 */
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FilterField } from "./FilterField";
import type { Filter } from "@/lib/collections/filter-schema";
import type { CollectionDef } from "@/lib/collections";
import { TOUR_DATES_FIELD_IDS } from "@/lib/collections/field-ids";

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
  ],
};

const CURRENT_ITEM_DEF: CollectionDef = {
  ...SOURCE_DEF,
  slug: "posts",
  singularName: "Post",
  pluralName: "Posts",
  fields: [
    { id: "p_title", key: "title", type: "text", required: true },
  ],
};

// ---------------------------------------------------------------------------
// Add / remove / change clauses
// ---------------------------------------------------------------------------

describe("FilterField — clause add/remove", () => {
  it("clicking '+ Add clause' emits a default clause", async () => {
    const onChange = vi.fn();
    render(<FilterField value={null} onChange={onChange} sourceDef={SOURCE_DEF} />);

    await userEvent.click(screen.getByRole("button", { name: "+ Add clause" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "" } },
      ],
    });
  });

  it("clicking '×' removes that clause", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
        { field: "f_capacity", op: "gt", value: { kind: "literal", value: 100 } },
      ],
    };
    const onChange = vi.fn();
    render(<FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    const removeButtons = screen.getAllByRole("button", { name: "Remove clause" });
    await userEvent.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledWith({
      all: [
        { field: "f_capacity", op: "gt", value: { kind: "literal", value: 100 } },
      ],
    });
  });

  it("removing the only clause emits null (no empty `all`)", async () => {
    const filter: Filter = {
      all: [{ field: "f_city", op: "equals", value: { kind: "literal", value: "" } }],
    };
    const onChange = vi.fn();
    render(<FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove clause" }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// Operator morphing — wiring between the picker and morphClauseToOp
// ---------------------------------------------------------------------------

describe("FilterField — operator change wiring", () => {
  it("changing the operator from `equals` to `in` morphs the value into an array", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    const onChange = vi.fn();
    render(<FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    await userEvent.selectOptions(screen.getByLabelText("Operator"), "in");

    expect(onChange).toHaveBeenCalledWith({
      all: [
        {
          field: "f_city",
          op: "in",
          values: [{ kind: "literal", value: "Paris" }],
        },
      ],
    });
  });

  it("changing to `excludeCurrentItem` drops the field and value", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    const onChange = vi.fn();
    render(<FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    await userEvent.selectOptions(screen.getByLabelText("Operator"), "excludeCurrentItem");

    expect(onChange).toHaveBeenCalledWith({
      all: [{ excludeCurrentItem: true }],
    });
  });

  it("changing to `isEmpty` drops the value but keeps the field", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    const onChange = vi.fn();
    render(<FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    await userEvent.selectOptions(screen.getByLabelText("Operator"), "isEmpty");

    expect(onChange).toHaveBeenCalledWith({
      all: [{ field: "f_city", op: "isEmpty" }],
    });
  });
});

// ---------------------------------------------------------------------------
// Field / value editing
// ---------------------------------------------------------------------------

describe("FilterField — field + value editing", () => {
  it("typing in the literal text input emits the new value", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "" } },
      ],
    };
    const onChange = vi.fn();
    render(<FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    await userEvent.type(screen.getByLabelText("Literal value"), "P");

    expect(onChange).toHaveBeenLastCalledWith({
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "P" } },
      ],
    });
  });

  it("changing the field on a clause preserves the operator and value", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    const onChange = vi.fn();
    render(<FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    await userEvent.selectOptions(screen.getByLabelText("Field"), "f_capacity");

    expect(onChange).toHaveBeenCalledWith({
      all: [
        { field: "f_capacity", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    });
  });

  it("a `select` field renders the option dropdown and emits option values", async () => {
    const filter: Filter = {
      all: [
        { field: "f_status", op: "equals", value: { kind: "literal", value: "" } },
      ],
    };
    const onChange = vi.fn();
    render(<FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    await userEvent.selectOptions(screen.getByLabelText("Literal option"), "on_sale");

    expect(onChange).toHaveBeenCalledWith({
      all: [
        { field: "f_status", op: "equals", value: { kind: "literal", value: "on_sale" } },
      ],
    });
  });

  it("toggling FilterValue from literal to currentItemId emits the new shape", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    const onChange = vi.fn();
    render(
      <FilterField
        value={filter}
        onChange={onChange}
        sourceDef={SOURCE_DEF}
        currentItemDef={CURRENT_ITEM_DEF}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Value source"), "currentItemId");

    expect(onChange).toHaveBeenCalledWith({
      all: [
        { field: "f_city", op: "equals", value: { kind: "currentItemId" } },
      ],
    });
  });

  it("toggling to currentItemField defaults the fieldId to the first current item field", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    const onChange = vi.fn();
    render(
      <FilterField
        value={filter}
        onChange={onChange}
        sourceDef={SOURCE_DEF}
        currentItemDef={CURRENT_ITEM_DEF}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Value source"), "currentItemField");

    expect(onChange).toHaveBeenCalledWith({
      all: [
        { field: "f_city", op: "equals", value: { kind: "currentItemField", fieldId: "p_title" } },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Clauses the page ignores
// ---------------------------------------------------------------------------

describe("FilterField — clauses the page ignores", () => {
  function fieldSelect(): HTMLSelectElement {
    return screen.getByLabelText("Field") as HTMLSelectElement;
  }
  function selectedText(select: HTMLSelectElement): string | undefined {
    return select.selectedOptions[0]?.textContent ?? undefined;
  }

  it("shows a removed field as 'removed field (ignored)' instead of the first field", () => {
    const filter: Filter = {
      all: [{ field: "f_gone", op: "equals", value: { kind: "literal", value: "Paris" } }],
    };
    render(<FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />);

    expect(fieldSelect().value).toBe("f_gone");
    expect(selectedText(fieldSelect())).toBe("removed field (ignored)");
    expect(screen.getByText(/so the page ignores this clause/)).toBeTruthy();
  });

  it("says the whole filter is ignored in an `any` group", () => {
    const filter: Filter = {
      any: [
        { field: "f_gone", op: "isEmpty" },
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    };
    render(<FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />);

    expect(screen.getByText(/so the page ignores this whole filter/)).toBeTruthy();
    // Only the clause on the removed field carries the note.
    expect(screen.getAllByText(/no longer exists/)).toHaveLength(1);
  });

  it("shows the re-added same-name field a default block's declared id now reads", () => {
    const reAdded: CollectionDef = {
      ...SOURCE_DEF,
      fields: [...SOURCE_DEF.fields, { id: "fld_new_venue", key: "venue", type: "text", required: false }],
    };
    const filter: Filter = {
      all: [
        {
          field: TOUR_DATES_FIELD_IDS.venue,
          op: "equals",
          value: { kind: "literal", value: "Lido" },
        },
      ],
    };
    render(<FilterField value={filter} onChange={vi.fn()} sourceDef={reAdded} />);

    expect(fieldSelect().value).toBe("fld_new_venue");
    expect(screen.queryByText("removed field (ignored)")).toBeNull();
    expect(screen.queryByText(/no longer exists/)).toBeNull();
  });

  it("picking a field replaces the removed one, and the option goes away", async () => {
    const filter: Filter = {
      all: [{ field: "f_gone", op: "isNotEmpty" }],
    };
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />,
    );

    await userEvent.selectOptions(fieldSelect(), "f_city");
    const next = { all: [{ field: "f_city", op: "isNotEmpty" }] } satisfies Filter;
    expect(onChange).toHaveBeenCalledWith(next);

    rerender(<FilterField value={next} onChange={onChange} sourceDef={SOURCE_DEF} />);
    expect(screen.queryByText("removed field (ignored)")).toBeNull();
    expect(screen.queryByText(/no longer exists/)).toBeNull();
  });

  it("marks a current-item field the surrounding collection no longer has", () => {
    const filter: Filter = {
      all: [
        {
          field: "f_city",
          op: "equals",
          value: { kind: "currentItemField", fieldId: "p_gone" },
        },
      ],
    };
    render(
      <FilterField
        value={filter}
        onChange={vi.fn()}
        sourceDef={SOURCE_DEF}
        currentItemDef={CURRENT_ITEM_DEF}
      />,
    );

    const select = screen.getByLabelText("Current item field") as HTMLSelectElement;
    expect(select.value).toBe("p_gone");
    expect(selectedText(select)).toBe("removed field (ignored)");
    expect(fieldSelect().value).toBe("f_city");
    expect(screen.getByText(/so the page ignores this clause/)).toBeTruthy();
  });

  it("shows the re-added same-name field a declared current-item id now reads", () => {
    // A tour-dates detail template listing other tour dates, where the
    // artist deleted the seed's `city` and added a new "city".
    const currentItemDef: CollectionDef = {
      ...SOURCE_DEF,
      fields: [
        { id: TOUR_DATES_FIELD_IDS.date, key: "date", type: "date", required: true },
        { id: "fld_new_city", key: "city", type: "text", required: false },
        { id: "fld_venue", key: "venue", type: "text", required: false },
      ],
    };
    const filter: Filter = {
      all: [
        {
          field: "f_city",
          op: "equals",
          value: { kind: "currentItemField", fieldId: TOUR_DATES_FIELD_IDS.city },
        },
      ],
    };
    render(
      <FilterField
        value={filter}
        onChange={vi.fn()}
        sourceDef={SOURCE_DEF}
        currentItemDef={currentItemDef}
      />,
    );

    const select = screen.getByLabelText("Current item field") as HTMLSelectElement;
    expect(select.value).toBe("fld_new_city");
    expect(selectedText(select)).toBe("city (text)");
    expect(screen.queryByText("removed field (ignored)")).toBeNull();
    expect(screen.queryByText(/so the page ignores/)).toBeNull();
  });

  it("shows an empty field id as 'no field (ignored)' once the collection has fields", () => {
    const filter: Filter = {
      all: [{ field: "", op: "equals", value: { kind: "literal", value: "Paris" } }],
    };
    render(<FilterField value={filter} onChange={vi.fn()} sourceDef={SOURCE_DEF} />);

    expect(fieldSelect().value).toBe("");
    expect(selectedText(fieldSelect())).toBe("no field (ignored)");
    expect(screen.queryByText("(no filterable fields)")).toBeNull();
    expect(screen.getByText(/isn't set or no longer exists, so the page ignores this clause/)).toBeTruthy();
  });

  it("keeps '(no filterable fields)' for an empty field id on a collection with none", () => {
    const noFilterable: CollectionDef = {
      ...SOURCE_DEF,
      fields: [{ id: "f_pic", key: "pic", type: "image", required: false }],
    };
    const filter: Filter = { all: [{ field: "", op: "isNotEmpty" }] };
    render(<FilterField value={filter} onChange={vi.fn()} sourceDef={noFilterable} />);

    expect(selectedText(fieldSelect())).toBe("(no filterable fields)");
    expect(screen.queryByText("no field (ignored)")).toBeNull();
    expect(screen.getByText(/so the page ignores this clause/)).toBeTruthy();
  });

  it("shows an empty current-item field id as 'no field (ignored)', not as a removed field", () => {
    const filter: Filter = {
      all: [{ field: "f_city", op: "equals", value: { kind: "currentItemField", fieldId: "" } }],
    };
    render(
      <FilterField
        value={filter}
        onChange={vi.fn()}
        sourceDef={SOURCE_DEF}
        currentItemDef={CURRENT_ITEM_DEF}
      />,
    );

    const select = screen.getByLabelText("Current item field") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(selectedText(select)).toBe("no field (ignored)");
    expect(screen.queryByText("removed field (ignored)")).toBeNull();
    expect(screen.queryByText(/removed/)).toBeNull();
    expect(screen.getByText(/isn't set or no longer exists, so the page ignores this clause/)).toBeTruthy();
  });

  it("points the row's field pickers at the note while it shows", () => {
    const gone = { kind: "currentItemField", fieldId: "p_gone" } as const;
    const filter: Filter = {
      all: [
        { field: "f_city", op: "in", values: [gone, gone] },
        { field: "f_city", op: "equals", value: { kind: "currentItemField", fieldId: "p_title" } },
      ],
    };
    render(
      <FilterField
        value={filter}
        onChange={vi.fn()}
        sourceDef={SOURCE_DEF}
        currentItemDef={CURRENT_ITEM_DEF}
      />,
    );

    const [ignoredField, liveField] = screen.getAllByLabelText("Field");
    const currentItemSelects = screen.getAllByLabelText("Current item field");
    expect(currentItemSelects).toHaveLength(3);
    const noteId = ignoredField!.getAttribute("aria-describedby");
    expect(noteId).toBeTruthy();
    expect(document.getElementById(noteId!)?.textContent).toMatch(/so the page ignores this clause/);
    // Both `in` values' pickers point at the same note.
    expect(currentItemSelects[0]!.getAttribute("aria-describedby")).toBe(noteId);
    expect(currentItemSelects[1]!.getAttribute("aria-describedby")).toBe(noteId);
    // The live row has no note, so nothing to point at.
    expect(liveField!.hasAttribute("aria-describedby")).toBe(false);
    expect(currentItemSelects[2]!.hasAttribute("aria-describedby")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mode toggle (AND/OR)
// ---------------------------------------------------------------------------

describe("FilterField — mode toggle", () => {
  it("switching from AND to OR rewrites the filter shape", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Lyon" } },
      ],
    };
    const onChange = vi.fn();
    render(<FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    await userEvent.selectOptions(screen.getByLabelText("Clause join mode"), "any");

    expect(onChange).toHaveBeenCalledWith({
      any: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Lyon" } },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Stable per-clause keys — the deep-review follow-up that needs this
// environment to verify
// ---------------------------------------------------------------------------

describe("FilterField — stable clause keys", () => {
  it("removing the first clause doesn't remount the second clause's text input", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Lyon" } },
      ],
    };
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />,
    );

    // Capture the second clause's literal input element before removal.
    const literalInputsBefore = screen.getAllByLabelText("Literal value");
    const secondInputBefore = literalInputsBefore[1];
    expect(secondInputBefore).toBeDefined();

    // Remove the first clause; FilterField calls onChange with the new
    // filter, simulating Puck's controlled-component round-trip.
    await userEvent.click(screen.getAllByRole("button", { name: "Remove clause" })[0]);
    const nextFilter = onChange.mock.calls.at(-1)?.[0] as Filter;

    rerender(<FilterField value={nextFilter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    // The surviving clause's input must be the same DOM node (stable
    // key). If keys were index-based, the input would have remounted
    // and the reference would no longer match.
    const literalInputsAfter = screen.getAllByLabelText("Literal value");
    expect(literalInputsAfter).toHaveLength(1);
    expect(literalInputsAfter[0]).toBe(secondInputBefore);
    // And it should still hold the second clause's original value.
    expect((literalInputsAfter[0] as HTMLInputElement).value).toBe("Lyon");
  });

  it("editing a clause's content keeps the input element stable", async () => {
    const filter: Filter = {
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "P" } },
      ],
    };
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterField value={filter} onChange={onChange} sourceDef={SOURCE_DEF} />,
    );
    const inputBefore = screen.getByLabelText("Literal value");

    await userEvent.type(inputBefore, "aris");
    const nextFilter = onChange.mock.calls.at(-1)?.[0] as Filter;
    rerender(<FilterField value={nextFilter} onChange={onChange} sourceDef={SOURCE_DEF} />);

    expect(screen.getByLabelText("Literal value")).toBe(inputBefore);
  });
});

// ---------------------------------------------------------------------------
// Raw JSON escape hatch
// ---------------------------------------------------------------------------

describe("FilterField — raw JSON pane", () => {
  it("editing the raw JSON pane to valid JSON emits the parsed filter", async () => {
    const onChange = vi.fn();
    render(<FilterField value={null} onChange={onChange} sourceDef={SOURCE_DEF} />);

    // The textarea is inside the <details>; jsdom doesn't auto-open
    // details when querying inside, but the textarea is in the DOM
    // either way and accessible by label.
    const textarea = screen.getByLabelText("Filter JSON");
    await userEvent.clear(textarea);
    await userEvent.paste(
      '{"all":[{"field":"f_city","op":"equals","value":{"kind":"literal","value":"Paris"}}]}',
    );

    expect(onChange).toHaveBeenLastCalledWith({
      all: [
        { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
      ],
    });
  });

  it("editing the raw JSON pane to invalid JSON shows an error and does not emit further", async () => {
    const onChange = vi.fn();
    render(
      <FilterField
        value={{
          all: [
            { field: "f_city", op: "equals", value: { kind: "literal", value: "Paris" } },
          ],
        }}
        onChange={onChange}
        sourceDef={SOURCE_DEF}
      />,
    );

    const textarea = screen.getByLabelText("Filter JSON");
    // Focus + type over the existing JSON with a deliberately invalid
    // payload. Don't clear first — `userEvent.clear` would emit null
    // (clearing the pane means "no filter") and we want to assert the
    // INVALID JSON didn't emit. Direct overtype keeps the call count
    // pinned to just the keystrokes that happened during paste.
    textarea.focus();
    (textarea as HTMLTextAreaElement).select();
    onChange.mockClear();
    await userEvent.paste("{ not valid json");

    expect(onChange).not.toHaveBeenCalled();
    // The alert lives inside the <details>, which jsdom keeps in the
    // DOM even when collapsed. Match with `hidden: true` so RTL's
    // visibility filter doesn't skip it.
    expect(screen.getByRole("alert", { hidden: true })).toBeDefined();
  });

  it("editing the raw JSON pane to valid JSON that fails schema validation shows an error", async () => {
    const onChange = vi.fn();
    render(<FilterField value={null} onChange={onChange} sourceDef={SOURCE_DEF} />);

    const textarea = screen.getByLabelText("Filter JSON");
    // Valid JSON but not a Filter shape — schema validation rejects.
    // user-event v14's `paste(text)` operates on the focused element;
    // focus the textarea first instead of passing it as an arg.
    textarea.focus();
    await userEvent.paste('{"nonsense":42}');

    expect(onChange).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert", { hidden: true });
    expect(within(alert).queryByText(/./)).toBeTruthy();
  });
});
