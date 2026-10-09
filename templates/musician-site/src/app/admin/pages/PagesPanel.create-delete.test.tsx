// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { buildItemFileSchema } from "@/lib/collections";
import { PAGES_FIELD_IDS } from "@/lib/collections/field-ids";
import { pagesCollectionDef } from "@/lib/collections/seeds";
import { __resetDraftChangesClientForTests } from "@/lib/draft-changes-client";
import { type PageSummary } from "@/lib/site-config-types";

import { PagesPanel } from "./PagesPanel";

const SUMMARIES: PageSummary[] = [
  { slug: "home", title: "Home", isSplashPage: false, isHiddenFromNav: false },
];

const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const NO_DRAFT_CHANGES = { ok: true, status: { count: 0, changes: [] } };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // The panel's badges read through the shared draft-changes coalescer;
  // drop its in-flight reference so cases don't bleed.
  __resetDraftChangesClientForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("<PagesPanel> create / delete", () => {
  it("creates through the pages item route with values the route's schema accepts", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse(200, { ok: true, item: { slug: "tour-2026" } })
        : jsonResponse(200, NO_DRAFT_CHANGES),
    );
    render(<PagesPanel initialPages={SUMMARIES} />);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Tour 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Tour 2026, slug tour-2026")).toBeTruthy(),
    );

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[0]).toBe("/api/collections/pages/items");
    const { slug, values } = JSON.parse(post?.[1].body as string);
    expect(slug).toBe("tour-2026");
    expect(values[PAGES_FIELD_IDS.title]).toEqual({ type: "text", value: "Tour 2026" });
    // Validate against the same schema the item route applies, so a
    // payload the route would 400 on fails here.
    const ts = "2026-01-01T00:00:00.000Z";
    const parsed = buildItemFileSchema(pagesCollectionDef.fields).safeParse({
      id: "item_x",
      createdAt: ts,
      updatedAt: ts,
      values,
    });
    expect(parsed.success).toBe(true);
  });

  it("deletes through the pages item route", async () => {
    vi.stubGlobal("confirm", () => true);
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? jsonResponse(200, { ok: true })
        : jsonResponse(200, NO_DRAFT_CHANGES),
    );
    render(<PagesPanel initialPages={SUMMARIES} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete page home" }));
    await waitFor(() => expect(screen.queryByLabelText("Home, slug home")).toBeNull());

    const del = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(del?.[0]).toBe("/api/collections/pages/items/home");
  });
});
