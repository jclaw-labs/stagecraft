import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetDraftChangesClientForTests,
  fetchDraftChangesShared,
} from "./draft-changes-client";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
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

const OK_BODY = {
  ok: true,
  status: {
    count: 2,
    changes: [
      { kind: "item", status: "modified", collectionSlug: "pages", itemSlug: "about", path: "a" },
    ],
    mode: "github",
    truncated: false,
  },
};

describe("fetchDraftChangesShared", () => {
  it("normalizes a successful response into a snapshot", async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
    const result = await fetchDraftChangesShared();
    expect(result).toEqual({
      ok: true,
      status: {
        count: 2,
        changes: OK_BODY.status.changes,
        mode: "github",
        truncated: false,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/draft-changes",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("coalesces concurrent callers into a single request", async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
    const [a, b, c] = await Promise.all([
      fetchDraftChangesShared(),
      fetchDraftChangesShared(),
      fetchDraftChangesShared(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Every caller sees the same resolved value.
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("re-fetches once the previous request has settled (no stale serving)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(OK_BODY));
    await fetchDraftChangesShared();
    await fetchDraftChangesShared();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("defaults a missing changes array to empty", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, status: { count: 0, mode: "github" } }),
    );
    const result = await fetchDraftChangesShared();
    expect(result).toEqual({
      ok: true,
      status: { count: 0, changes: [], mode: "github", truncated: false },
    });
  });

  it("returns { ok: false } on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, error: "boom" }, { status: 500 }));
    expect(await fetchDraftChangesShared()).toEqual({ ok: false });
  });

  it("returns { ok: false } on an { ok: false } body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false, code: "broker-rejected" }, { status: 502 }));
    expect(await fetchDraftChangesShared()).toEqual({ ok: false });
  });

  it("returns { ok: false } when the network throws (never rejects)", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(fetchDraftChangesShared()).resolves.toEqual({ ok: false });
  });

  it("doesn't pin a failed result — a later call retries", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fetchMock.mockResolvedValueOnce(jsonResponse(OK_BODY));
    expect(await fetchDraftChangesShared()).toEqual({ ok: false });
    const second = await fetchDraftChangesShared();
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
