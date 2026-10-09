import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { drainMock } = vi.hoisted(() => ({ drainMock: vi.fn() }));

vi.mock("@/lib/jobs/worker", () => ({ getWorker: () => ({ drain: drainMock }) }));

import { POST } from "../route";

function buildRequest(bearer?: string) {
  return new Request("http://platform.test/api/cron/jobs", {
    method: "POST",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

beforeEach(() => {
  drainMock.mockReset();
  vi.stubEnv("CRON_SECRET", "s3cret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/cron/jobs", () => {
  it("drains the queue and reports how many jobs ran", async () => {
    drainMock.mockResolvedValueOnce(2);

    const res = await POST(buildRequest("s3cret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 2 });
    expect(drainMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 without a bearer token", async () => {
    const res = await POST(buildRequest());

    expect(res.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong secret", async () => {
    const res = await POST(buildRequest("nope"));

    expect(res.status).toBe(401);
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("returns 503 when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const res = await POST(buildRequest("s3cret"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "cron-not-configured" });
    expect(drainMock).not.toHaveBeenCalled();
  });

  it("propagates a drain failure as an error", async () => {
    drainMock.mockRejectedValueOnce(new Error("boom"));

    await expect(POST(buildRequest("s3cret"))).rejects.toThrow("boom");
  });
});
