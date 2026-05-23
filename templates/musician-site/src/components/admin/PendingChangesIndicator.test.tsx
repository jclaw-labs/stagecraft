// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { __resetDraftChangesClientForTests } from "@/lib/draft-changes-client";

import { PendingChangesIndicator } from "./PendingChangesIndicator";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // The indicator reads through the shared draft-changes coalescer,
  // which keeps a module-level in-flight reference; drop it so a
  // pending-forever mock in one case can't bleed into the next.
  __resetDraftChangesClientForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init?: { status?: number }) {
  return {
    ok: (init?.status ?? 200) < 400,
    status: init?.status ?? 200,
    json: async () => body,
  };
}

describe("PendingChangesIndicator", () => {
  it("renders nothing on initial mount (before the fetch resolves)", () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // pending forever
    const { container } = render(<PendingChangesIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the plural count when count > 1", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 3, mode: "github" } }),
    );
    render(<PendingChangesIndicator />);
    await waitFor(() => {
      expect(screen.getByText("3 unpublished changes")).toBeTruthy();
    });
  });

  it("uses the singular noun when count === 1", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 1, mode: "github" } }),
    );
    render(<PendingChangesIndicator />);
    await waitFor(() => {
      expect(screen.getByText("1 unpublished change")).toBeTruthy();
    });
  });

  it("renders '300+ unpublished changes' when the diff is truncated", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: { count: 300, mode: "github", truncated: true },
      }),
    );
    render(<PendingChangesIndicator />);
    await waitFor(() => {
      expect(screen.getByText("300+ unpublished changes")).toBeTruthy();
    });
  });

  it("shows 'All published' when count === 0 on github", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, mode: "github" } }),
    );
    render(<PendingChangesIndicator />);
    await waitFor(() => {
      expect(screen.getByText("All published")).toBeTruthy();
    });
  });

  it("renders nothing in dev / local mode (no draft branch concept)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, mode: "local" } }),
    );
    const { container } = render(<PendingChangesIndicator />);
    // Wait a tick for the effect's microtasks to settle. There's
    // nothing to assert as present; assert the indicator stays empty.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
  });

  it("passes cache: no-store so a save → navigate doesn't get a stale response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, mode: "github" } }),
    );
    render(<PendingChangesIndicator />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/draft-changes",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
  });

  it("folds simultaneous consumers into one request (shared fetch)", async () => {
    // Two consumers mounting in the same render pass — the indicator
    // plus, on the real Pages screen, the panel's badges — must share a
    // single compare call rather than each firing their own.
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 2, mode: "github" } }),
    );
    render(
      <>
        <PendingChangesIndicator />
        <PendingChangesIndicator />
      </>,
    );
    await waitFor(() => {
      expect(screen.getAllByText("2 unpublished changes")).toHaveLength(2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hides silently on a server error (don't surface load failures in chrome)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "boom" }, { status: 500 }));
    const { container } = render(<PendingChangesIndicator />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
  });

  it("hides silently on a network throw", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { container } = render(<PendingChangesIndicator />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
  });
});
