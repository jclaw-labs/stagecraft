import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, fetchDeployStatusMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  fetchDeployStatusMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/deploy-status", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/deploy-status")>(
    "@/lib/deploy-status",
  );
  return { ...actual, fetchDeployStatus: fetchDeployStatusMock };
});

import { GET } from "./route";
import { DeployStatusError } from "@/lib/deploy-status";

beforeEach(() => {
  getSessionMock.mockReset();
  fetchDeployStatusMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/publish-status", () => {
  it("401 when no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the broker's deploy on success", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    fetchDeployStatusMock.mockResolvedValue({
      id: "dpl_1",
      state: "building",
      url: "https://x.vercel.app",
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00Z",
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, deploy: { state: "building" } });
  });

  it("synthesizes state=unknown in dev fallback (no platform configured)", async () => {
    // Editor still mounts in dev; the pill should render rather than 500
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    fetchDeployStatusMock.mockRejectedValue(
      new DeployStatusError("no-platform-configured", "missing env"),
    );
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deploy: { state: "unknown" } });
  });

  it("502 on broker-rejected", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    fetchDeployStatusMock.mockRejectedValue(
      new DeployStatusError("broker-rejected", "502"),
    );
    const res = await GET();
    expect(res.status).toBe(502);
  });

  it("500 on broker-unreachable", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    fetchDeployStatusMock.mockRejectedValue(
      new DeployStatusError("broker-unreachable", "ECONNREFUSED"),
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
