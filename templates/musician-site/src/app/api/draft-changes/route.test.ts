import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, getDraftChangesMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getDraftChangesMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/draft-changes", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/draft-changes")>(
    "@/lib/draft-changes",
  );
  return { ...actual, getDraftChanges: getDraftChangesMock };
});

import { GET } from "./route";
import { DraftChangesError } from "@/lib/draft-changes";

beforeEach(() => {
  getSessionMock.mockReset();
  getDraftChangesMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/draft-changes", () => {
  it("401 when no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getDraftChangesMock).not.toHaveBeenCalled();
  });

  it("returns the underlying status (count + changes) on success", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    const changes = [
      {
        kind: "item" as const,
        status: "modified" as const,
        collectionSlug: "pages",
        itemSlug: "home",
        path: "src/content/collections/pages/items/home.json",
      },
    ];
    getDraftChangesMock.mockResolvedValue({
      count: 1,
      changes,
      mode: "github",
      truncated: false,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: { count: 1, changes, mode: "github", truncated: false },
    });
  });

  it("returns mode=local in dev fallback (no platform configured)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftChangesMock.mockResolvedValue({
      count: 0,
      changes: [],
      mode: "local",
      truncated: false,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: { mode: "local", count: 0, changes: [] },
    });
  });

  it("sets cache-control: no-store so saves don't get masked by a cached response", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftChangesMock.mockResolvedValue({
      count: 0,
      changes: [],
      mode: "github",
      truncated: false,
    });
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("502 on broker-rejected (permanent config error)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftChangesMock.mockRejectedValue(
      new DraftChangesError("broker-rejected", "unknown site"),
    );
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, code: "broker-rejected" });
  });

  it("500 on broker-unreachable", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftChangesMock.mockRejectedValue(
      new DraftChangesError("broker-unreachable", "ECONNREFUSED"),
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("500 on github-failed", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftChangesMock.mockRejectedValue(
      new DraftChangesError("github-failed", "boom"),
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
