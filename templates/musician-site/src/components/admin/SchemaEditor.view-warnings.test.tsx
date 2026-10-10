// @vitest-environment jsdom

/**
 * Specialised-view warnings in the schema editor (#352): removing or
 * retyping a field the public card view (tour dates, releases, …) reads
 * asks for confirmation first, and a standing heads-up lists fields the
 * draft already broke.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { removeFieldPrompt, SchemaEditor } from "./SchemaEditor";
import type { CollectionDef, FieldDef } from "@/lib/collections";
import { TOUR_DATES_FIELD_IDS } from "@/lib/collections/field-ids";
import { tourDatesCollectionDef } from "@/lib/collections/seeds";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CITY = { id: TOUR_DATES_FIELD_IDS.city, key: "city" };
const NOTES = { id: TOUR_DATES_FIELD_IDS.notes, key: "notes" };

describe("removeFieldPrompt", () => {
  it("is the plain prompt for a field no view reads", () => {
    expect(removeFieldPrompt(tourDatesCollectionDef, NOTES, false)).toBe('Remove field "notes"?');
  });

  it("keeps the slug-source note for a field no view reads", () => {
    expect(removeFieldPrompt(tourDatesCollectionDef, NOTES, true)).toBe(
      '"notes" is currently used as the slug source. Remove anyway?',
    );
  });

  it("explains what removing a field the view reads does", () => {
    expect(removeFieldPrompt(tourDatesCollectionDef, CITY, false)).toBe(
      'Removing "city" means the city will no longer show on the public tour dates list. Continue?',
    );
  });

  it("is the plain prompt for a field the draft already broke", () => {
    expect(
      removeFieldPrompt(
        draftWithType(TOUR_DATES_FIELD_IDS.city, "url"),
        CITY,
        false,
        tourDatesCollectionDef,
      ),
    ).toBe('Remove field "city"?');
  });

  it("combines the slug-source note with the view impact", () => {
    const prompt = removeFieldPrompt(tourDatesCollectionDef, CITY, true);
    expect(prompt).toMatch(/^"city" is currently used as the slug source\. Removing "city" means/);
    expect(prompt).toMatch(/Continue\?$/);
  });
});

function renderEditor(
  def: CollectionDef = tourDatesCollectionDef,
  savedDef: CollectionDef = tourDatesCollectionDef,
) {
  const onChange = vi.fn();
  render(<SchemaEditor def={def} savedDef={savedDef} onChange={onChange} />);
  return onChange;
}

/** The tour-dates seed with one field's type changed in the (unsaved) draft. */
function draftWithType(fieldId: string, type: "number" | "text" | "url"): CollectionDef {
  return {
    ...tourDatesCollectionDef,
    fields: tourDatesCollectionDef.fields.map((f) =>
      f.id === fieldId ? ({ id: f.id, key: f.key, type, required: false } as FieldDef) : f,
    ),
  };
}

/** The field card whose heading is `key` (the `<strong>` name label). */
function fieldCard(key: string): HTMLElement {
  const heading = screen.getAllByText(key, { selector: "strong" })[0]!;
  return heading.closest("div[style*='surface-raised']") as HTMLElement;
}

describe("<SchemaEditor> specialised-view warnings", () => {
  it("asks before removing a field the view needs, and does nothing on cancel", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onChange = renderEditor();
    const card = fieldCard("city");
    fireEvent.click(card.querySelector("button")!);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("will no longer show"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes the field once the artist confirms", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onChange = renderEditor();
    fireEvent.click(fieldCard("city").querySelector("button")!);
    const next = onChange.mock.calls[0]![0] as CollectionDef;
    expect(next.fields.some((f) => f.id === TOUR_DATES_FIELD_IDS.city)).toBe(false);
  });

  it("asks before retyping a field to a type the view can't render", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onChange = renderEditor();
    const typeSelect = fieldCard("city").querySelector("select")!;
    fireEvent.change(typeSelect, { target: { value: "url" } });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^Changing "city" to URL means/),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("doesn't ask for a retype the save API blocks, and shows no heads-up for it", () => {
    // text → number is rejected on save (`type-transition-blocked`), so the
    // public view can never see it; the save error is the artist's message.
    const confirmSpy = vi.spyOn(window, "confirm");
    const onChange = renderEditor();
    fireEvent.change(fieldCard("city").querySelector("select")!, {
      target: { value: "number" },
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    cleanup();
    renderEditor(onChange.mock.calls[0]![0] as CollectionDef);
    expect(screen.queryByText("Heads-up")).toBeNull();
  });

  it("judges a two-step retype against the saved type", () => {
    // city saved as Short text, already Number in the draft: picking URL
    // next saves (text → URL), so the artist is asked.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor(draftWithType(TOUR_DATES_FIELD_IDS.city, "number"));
    fireEvent.change(fieldCard("city").querySelector("select")!, { target: { value: "url" } });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/^Changing "city" to URL means/));
    cleanup();
    confirmSpy.mockClear();
    // ticketUrl saved as URL, already Short text in the draft: Email next
    // is blocked on save (URL → Email), so no prompt and no heads-up.
    const onChange = renderEditor(draftWithType(TOUR_DATES_FIELD_IDS.ticketUrl, "text"));
    fireEvent.change(fieldCard("ticketUrl").querySelector("select")!, {
      target: { value: "email" },
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    cleanup();
    renderEditor(onChange.mock.calls[0]![0] as CollectionDef);
    expect(screen.queryByText("Heads-up")).toBeNull();
  });

  it("doesn't ask for a retype the view still renders", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onChange = renderEditor();
    fireEvent.change(fieldCard("city").querySelector("select")!, {
      target: { value: "longText" },
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask when retyping a field no view reads", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const onChange = renderEditor();
    fireEvent.change(fieldCard("notes").querySelector("select")!, {
      target: { value: "text" },
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask again when retyping a field the draft already broke", () => {
    // city is URL in the draft (saved as Short text), so the heads-up
    // already says the city doesn't show; Email next changes nothing.
    const confirmSpy = vi.spyOn(window, "confirm");
    const onChange = renderEditor(draftWithType(TOUR_DATES_FIELD_IDS.city, "url"));
    fireEvent.change(fieldCard("city").querySelector("select")!, { target: { value: "email" } });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shows a standing heads-up for a field the draft already broke", () => {
    renderEditor({
      ...tourDatesCollectionDef,
      fields: tourDatesCollectionDef.fields.filter((f) => f.id !== TOUR_DATES_FIELD_IDS.city),
    });
    expect(
      screen.getByText(
        "The city field was removed, so the city doesn't show on the public tour dates list.",
      ),
    ).toBeTruthy();
  });

  it("warns in the heads-up that existing values can block an unsaved retype", () => {
    renderEditor(draftWithType(TOUR_DATES_FIELD_IDS.city, "url"));
    expect(
      screen.getByText(/The save only goes through if every existing city is a valid URL value\.$/),
    ).toBeTruthy();
  });

  it("lists server warnings and view problems in one heads-up", () => {
    render(
      <SchemaEditor
        def={draftWithType(TOUR_DATES_FIELD_IDS.city, "url")}
        savedDef={tourDatesCollectionDef}
        onChange={vi.fn()}
        warnings={[{ kind: "server-warning", message: "A warning from the last save." }]}
      />,
    );
    expect(screen.getAllByText("Heads-up")).toHaveLength(1);
    const box = screen.getByRole("status");
    expect(box.textContent).toContain("A warning from the last save.");
    expect(box.textContent).toContain("The city field is now URL");
  });

  it("shows no heads-up when the schema satisfies the view", () => {
    renderEditor();
    expect(screen.queryByText(/falls back to the plain default card/)).toBeNull();
    expect(screen.queryByText("Heads-up")).toBeNull();
  });
});
