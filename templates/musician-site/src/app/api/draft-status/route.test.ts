import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, getDraftStatusMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getDraftStatusMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/draft-status", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/draft-status")>(
    "@/lib/draft-status",
  );
  return { ...actual, getDraftStatus: getDraftStatusMock };
});

import { GET } from "./route";
import { DraftStatusError } from "@/lib/draft-status";

beforeEach(() => {
  getSessionMock.mockReset();
  getDraftStatusMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/draft-status", () => {
  it("401 when no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getDraftStatusMock).not.toHaveBeenCalled();
  });

  it("returns the underlying status on success", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftStatusMock.mockResolvedValue({ hasPending: true, mode: "github" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      status: { hasPending: true, mode: "github" },
    });
  });

  it("returns mode=local in dev fallback (no platform configured)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftStatusMock.mockResolvedValue({ hasPending: false, mode: "local" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: { mode: "local" },
    });
  });

  it("502 on broker-rejected (permanent config error)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftStatusMock.mockRejectedValue(
      new DraftStatusError("broker-rejected", "unknown site"),
    );
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, code: "broker-rejected" });
  });

  it("500 on broker-unreachable", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftStatusMock.mockRejectedValue(
      new DraftStatusError("broker-unreachable", "ECONNREFUSED"),
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("500 on github-failed", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    getDraftStatusMock.mockRejectedValue(
      new DraftStatusError("github-failed", "boom"),
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
