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
import type { CollectionDef } from "@/lib/collections";
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

  it("explains the default-card fallback for a field the view requires", () => {
    expect(removeFieldPrompt(tourDatesCollectionDef, CITY, false)).toMatch(
      /^Removing "city" means the public tour dates list will switch to the plain default card/,
    );
  });

  it("combines the slug-source note with the view impact", () => {
    const prompt = removeFieldPrompt(tourDatesCollectionDef, CITY, true);
    expect(prompt).toMatch(/^"city" is currently used as the slug source\. Removing "city" means/);
    expect(prompt).toMatch(/Continue\?$/);
  });
});

function renderEditor(def: CollectionDef = tourDatesCollectionDef) {
  const onChange = vi.fn();
  render(<SchemaEditor def={def} onChange={onChange} />);
  return onChange;
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
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("plain default card"));
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

  it("shows a standing heads-up for a field the draft already broke", () => {
    renderEditor({
      ...tourDatesCollectionDef,
      fields: tourDatesCollectionDef.fields.filter((f) => f.id !== TOUR_DATES_FIELD_IDS.city),
    });
    expect(
      screen.getByText(/The city field was removed, so the public tour dates list falls back/),
    ).toBeTruthy();
  });

  it("shows no heads-up when the schema satisfies the view", () => {
    renderEditor();
    expect(screen.queryByText(/falls back to the plain default card/)).toBeNull();
    expect(screen.queryByText("Heads-up")).toBeNull();
  });
});
