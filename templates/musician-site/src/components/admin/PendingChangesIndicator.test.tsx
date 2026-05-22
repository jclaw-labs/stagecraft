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

  it("passes an AbortController signal so unmount cancels the fetch", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, mode: "github" } }),
    );
    render(<PendingChangesIndicator />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts the in-flight fetch on unmount", async () => {
    // Capture the signal the indicator passes so we can observe it
    // flipping to aborted when the component unmounts.
    let capturedSignal: AbortSignal | null = null;
    fetchMock.mockImplementation((_url, init?: RequestInit) => {
      capturedSignal = init?.signal ?? null;
      return new Promise(() => {}); // never resolves
    });
    const { unmount } = render(<PendingChangesIndicator />);
    await waitFor(() => {
      expect(capturedSignal).not.toBeNull();
    });
    expect(capturedSignal!.aborted).toBe(false);
    unmount();
    expect(capturedSignal!.aborted).toBe(true);
  });

  it("doesn't transition out of loading when the fetch throws AbortError", async () => {
    // The unmount path rejects the pending fetch with an AbortError.
    // The indicator should swallow it silently, not hide on it (a fast
    // re-mount during navigation would otherwise see the wrong state).
    fetchMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          const err = new Error("aborted");
          err.name = "AbortError";
          // Reject on the next microtask so the component has time
          // to register the cleanup before we throw.
          queueMicrotask(() => reject(err));
        }),
    );
    const { container } = render(<PendingChangesIndicator />);
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
