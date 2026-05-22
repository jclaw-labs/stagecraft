// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { PendingChangesIndicator } from "./PendingChangesIndicator";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
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

  it("shows 'Unpublished changes' when hasPending=true", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { hasPending: true, mode: "github" } }),
    );
    render(<PendingChangesIndicator />);
    await waitFor(() => {
      expect(screen.getByText("Unpublished changes")).toBeTruthy();
    });
  });

  it("shows 'All published' when hasPending=false on github", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { hasPending: false, mode: "github" } }),
    );
    render(<PendingChangesIndicator />);
    await waitFor(() => {
      expect(screen.getByText("All published")).toBeTruthy();
    });
  });

  it("renders nothing in dev / local mode (no draft branch concept)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { hasPending: false, mode: "local" } }),
    );
    const { container } = render(<PendingChangesIndicator />);
    // Wait a tick for the effect's microtasks to settle. There's
    // nothing to assert as present; assert the indicator stays empty.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.firstChild).toBeNull();
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
