// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { type PageSummary } from "@/lib/site-config-types";

import { PagesPanel } from "./PagesPanel";

const SUMMARIES: PageSummary[] = [
  { slug: "home", title: "Home", isSplashPage: false, isHiddenFromNav: false },
  { slug: "about", title: "About", isSplashPage: false, isHiddenFromNav: true },
];

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function draftChangesResponse(
  changes: Array<{ kind: string; collectionSlug?: string; itemSlug?: string }>,
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, status: { count: changes.length, changes } }),
  };
}

describe("<PagesPanel> pending-changes badges", () => {
  it("badges only the rows whose slug has a pending pages-collection change", async () => {
    fetchMock.mockResolvedValue(
      draftChangesResponse([
        {
          kind: "item",
          collectionSlug: "pages",
          itemSlug: "about",
        },
      ]),
    );
    render(<PagesPanel initialPages={SUMMARIES} />);
    await waitFor(() => {
      expect(screen.getAllByText("Unpublished")).toHaveLength(1);
    });
    // The badge sits in the "about" row, not "home".
    const aboutRow = screen.getByLabelText("About, slug about");
    expect(aboutRow.textContent).toContain("Unpublished");
    const homeRow = screen.getByLabelText("Home, slug home");
    expect(homeRow.textContent).not.toContain("Unpublished");
  });

  it("ignores changes from other collections even when the slug matches", async () => {
    // A `photos/about` change must not badge the `pages/about` row.
    fetchMock.mockResolvedValue(
      draftChangesResponse([
        { kind: "item", collectionSlug: "photos", itemSlug: "about" },
      ]),
    );
    render(<PagesPanel initialPages={SUMMARIES} />);
    // Give the effect a tick to settle, then assert nothing got badged.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Unpublished")).toBeNull();
  });

  it("shows no badges when the draft-changes fetch fails (degrades silently)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false }) });
    render(<PagesPanel initialPages={SUMMARIES} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Unpublished")).toBeNull();
  });

  it("shows no badges when the network throws", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<PagesPanel initialPages={SUMMARIES} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Unpublished")).toBeNull();
  });
});
