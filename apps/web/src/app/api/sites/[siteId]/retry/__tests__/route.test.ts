import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, drainAfterResponseMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    site: { findFirst: vi.fn(), updateMany: vi.fn() },
    siteJob: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
  drainAfterResponseMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/jobs/worker", () => ({ drainAfterResponse: drainAfterResponseMock }));

import { POST } from "../route";

function call(siteId = "site-1") {
  return POST(new Request(`http://platform.test/api/sites/${siteId}/retry`, { method: "POST" }), {
    params: Promise.resolve({ siteId }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  prismaMock.site.findFirst.mockResolvedValue({ id: "site-1", status: "error" });
  prismaMock.siteJob.findFirst.mockResolvedValue({ id: "job-1", status: "failed" });
  prismaMock.site.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.siteJob.updateMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/sites/[siteId]/retry", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(prismaMock.siteJob.updateMany).not.toHaveBeenCalled();
  });

  it("404 when the site isn't the user's", async () => {
    prismaMock.site.findFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(prismaMock.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "site-1", userId: "user-1" } }),
    );
  });

  it("re-queues the failed create_site job with a fresh retry budget, keeping its step progress", async () => {
    const res = await call();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
    expect(prismaMock.siteJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: "site-1", type: "create_site" } }),
    );
    expect(prismaMock.site.updateMany).toHaveBeenCalledWith({
      where: { id: "site-1", status: "error" },
      data: { status: "creating" },
    });
    const [{ where, data }] = prismaMock.siteJob.updateMany.mock.calls[0];
    expect(where).toEqual({ id: "job-1", status: "failed" });
    expect(data).toMatchObject({ status: "queued", retryAttempts: 0, runAt: null, errorMessage: null });
    // resultPayload (where the steps live) is left alone.
    expect(data).not.toHaveProperty("resultPayload");
    expect(drainAfterResponseMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the site isn't in error", { id: "site-1", status: "active" }, { id: "job-1", status: "failed" }],
    ["there's no create_site job", { id: "site-1", status: "error" }, null],
    ["the latest create_site job didn't fail", { id: "site-1", status: "error" }, { id: "job-1", status: "running" }],
  ])("409 when %s", async (_label, site, job) => {
    prismaMock.site.findFirst.mockResolvedValue(site);
    prismaMock.siteJob.findFirst.mockResolvedValue(job);

    expect((await call()).status).toBe(409);
    expect(prismaMock.site.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.siteJob.updateMany).not.toHaveBeenCalled();
  });

  it("409 when a concurrent retry already reopened the site", async () => {
    prismaMock.site.updateMany.mockResolvedValue({ count: 0 });

    expect((await call()).status).toBe(409);
    expect(prismaMock.siteJob.updateMany).not.toHaveBeenCalled();
    expect(drainAfterResponseMock).not.toHaveBeenCalled();
  });

  it("409 and puts the site back in error when the job was re-queued concurrently", async () => {
    prismaMock.siteJob.updateMany.mockResolvedValue({ count: 0 });

    expect((await call()).status).toBe(409);
    expect(prismaMock.site.updateMany).toHaveBeenLastCalledWith({
      where: { id: "site-1", status: "creating" },
      data: { status: "error" },
    });
    expect(drainAfterResponseMock).not.toHaveBeenCalled();
  });
});
