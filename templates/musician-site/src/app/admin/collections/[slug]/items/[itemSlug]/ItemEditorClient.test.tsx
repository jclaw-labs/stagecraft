// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Item } from "@/lib/collections/schema";

// Stub the field editor: the save handler is what's under test. The
// stub's button makes one edit so the save bar's button enables.
vi.mock("@/components/admin/ItemEditor", () => ({
  ItemEditor: ({ item, onChange }: { item: Item; onChange: (next: Item) => void }) => (
    <button
      type="button"
      onClick={() =>
        onChange({ ...item, values: { ...item.values, f_venue: { type: "text", value: "" } } })
      }
    >
      Clear venue
    </button>
  ),
}));

import { tourDateItem, tourDatesDef } from "@/lib/collections/test-fixtures";

import { ItemEditorClient } from "./ItemEditorClient";

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAndSave() {
  render(
    <ItemEditorClient
      def={tourDatesDef()}
      item={tourDateItem("berlin", "2026-11-01", "Lido", "Berlin")}
      referenceOptions={{}}
      collectionSlug="tour-dates"
      itemSlug="berlin"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear venue" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

describe("<ItemEditorClient> save errors", () => {
  it("names each failing field by its key", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        ok: false,
        error: "Validation failed",
        issues: [
          { path: "values.f_venue.value", message: "Required" },
          { path: "values.f_city", message: "Too short" },
        ],
      }),
    );
    renderAndSave();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Validation failed: venue: Required; city: Too short");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/tour-dates/items/berlin",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("falls back to the HTTP status when the body is unreadable", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(502, null));
    renderAndSave();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Save failed (HTTP 502)"),
    );
  });
});
