// @vitest-environment jsdom

/**
 * The client wrapper hands the editor the saved schema, so the
 * specialised-view warnings (#352) judge a type change the way the save
 * API does: against the saved type, not an earlier unsaved retype.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SchemaEditorClient } from "./SchemaEditorClient";
import type { CollectionDef } from "@/lib/collections";
import { TOUR_DATES_FIELD_IDS } from "@/lib/collections/field-ids";
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

  it("checks against the newly saved type after a save", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SchemaEditorClient collectionSlug="tour-dates" initialDef={tourDatesCollectionDef} />);
    // Short text → Long text keeps the card, so no prompt; then save it.
    fireEvent.change(citySelect(), { target: { value: "longText" } });
    const savedDef: CollectionDef = {
      ...tourDatesCollectionDef,
      fields: tourDatesCollectionDef.fields.map((f) =>
        f.id === TOUR_DATES_FIELD_IDS.city ? { id: f.id, key: f.key, type: "longText", required: true } : f,
      ),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, def: savedDef }), { status: 200 }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save/i }));
    });
    await waitFor(() => expect(screen.queryByText(/unsaved changes/i)).toBeNull());
    // Long text → URL is blocked on save, so no prompt, even though the
    // pre-save type (Short text → URL) would have been allowed.
    fireEvent.change(citySelect(), { target: { value: "url" } });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Heads-up")).toBeNull();
  });
});
