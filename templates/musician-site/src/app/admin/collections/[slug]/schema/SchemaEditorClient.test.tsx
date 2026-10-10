// @vitest-environment jsdom

/**
 * The client wrapper hands the editor the saved schema, so the
 * specialised-view warnings (#352) judge a type change the way the save
 * API does: against the saved type, not an earlier unsaved retype.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SchemaEditorClient } from "./SchemaEditorClient";
import { tourDatesCollectionDef } from "@/lib/collections/seeds";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function citySelect(): HTMLSelectElement {
  const heading = screen.getAllByText("city", { selector: "strong" })[0]!;
  const card = heading.closest("div[style*='surface-raised']") as HTMLElement;
  return card.querySelector("select")!;
}

describe("<SchemaEditorClient>", () => {
  it("warns on a two-step retype that saves from the saved type", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SchemaEditorClient collectionSlug="tour-dates" initialDef={tourDatesCollectionDef} />);
    // Short text → Number is blocked on save: no prompt.
    fireEvent.change(citySelect(), { target: { value: "number" } });
    expect(confirmSpy).not.toHaveBeenCalled();
    // Then URL: the save checks Short text → URL, which goes through and
    // breaks the tour dates card, so the artist is asked.
    fireEvent.change(citySelect(), { target: { value: "url" } });
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/^Changing "city" to URL means/));
  });
});
