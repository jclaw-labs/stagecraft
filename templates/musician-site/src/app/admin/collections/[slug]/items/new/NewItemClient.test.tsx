// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

// Stub the field editor: the save handler is what's under test.
vi.mock("@/components/admin/ItemEditor", () => ({ ItemEditor: () => null }));

import type { Item } from "@/lib/collections/schema";
import { tourDatesDef } from "@/lib/collections/test-fixtures";

import { NewItemClient } from "./NewItemClient";

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const DRAFT: Item = {
  id: "item_new",
  slug: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  values: {},
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  pushMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAndSave() {
  render(
    <NewItemClient
      def={tourDatesDef()}
      draft={DRAFT}
      referenceOptions={{}}
      collectionSlug="tour-dates"
    />,
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "berlin" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

describe("<NewItemClient> save errors", () => {
  it("names each failing field by its key", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        ok: false,
        error: "Validation failed",
        issues: [
          { path: "values.f_date", message: "Required" },
          { path: "values.f_venue", message: "Required" },
        ],
      }),
    );
    renderAndSave();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Validation failed: date: Required; venue: Required");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/tour-dates/items",
      expect.objectContaining({ method: "POST" }),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows the route's error when there are no issues", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        ok: false,
        error: 'An item with slug "berlin" already exists in collection "tour-dates"',
      }),
    );
    renderAndSave();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      'An item with slug "berlin" already exists in collection "tour-dates"',
    );
  });
});
