import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, drainAfterResponseMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    integrationAccount: { findMany: vi.fn() },
    site: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    siteJob: { create: vi.fn(), update: vi.fn() },
  },
  drainAfterResponseMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/jobs/worker", () => ({ drainAfterResponse: drainAfterResponseMock }));

import { POST } from "../route";

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://platform.test/api/sites", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  authMock.mockReset();
  prismaMock.integrationAccount.findMany.mockReset();
  prismaMock.site.findUnique.mockReset();
  prismaMock.site.create.mockReset();
  prismaMock.site.delete.mockReset();
  prismaMock.site.delete.mockResolvedValue({});
  prismaMock.siteJob.create.mockReset();
  prismaMock.siteJob.update.mockReset();
  drainAfterResponseMock.mockReset();

  // Reasonable defaults for the success path
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  prismaMock.integrationAccount.findMany.mockResolvedValue([
    { provider: "github" },
    { provider: "netlify" },
    { provider: "resend" },
  ]);
  prismaMock.site.findUnique.mockResolvedValue(null); // slug not taken
  prismaMock.site.create.mockResolvedValue({ id: "site-1", name: "Sarah Chen" });
  prismaMock.siteJob.create.mockResolvedValue({
    id: "job-1",
    siteId: "site-1",
    userId: "user-1",
    type: "create_site",
    status: "queued",
  });
  prismaMock.siteJob.update.mockResolvedValue({});
});

describe("POST /api/sites", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(401);
    expect(prismaMock.siteJob.create).not.toHaveBeenCalled();
  });

  it("400 when name is missing", async () => {
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
    expect(prismaMock.siteJob.create).not.toHaveBeenCalled();
  });

  it("400 when name is too short", async () => {
    const res = await POST(buildRequest({ name: "x" }));
    expect(res.status).toBe(400);
  });

  it("400 when GitHub is missing", async () => {
    prismaMock.integrationAccount.findMany.mockResolvedValueOnce([
      { provider: "netlify" },
      { provider: "resend" },
    ]);
    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("GitHub must be connected"),
    });
  });

  it("400 when neither Vercel nor Netlify is connected", async () => {
    prismaMock.integrationAccount.findMany.mockResolvedValueOnce([
      { provider: "github" },
      { provider: "resend" },
    ]);
    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("deploy target"),
    });
  });

  it("400 when Resend is missing (required for magic-link sign-in)", async () => {
    prismaMock.integrationAccount.findMany.mockResolvedValueOnce([
      { provider: "github" },
      { provider: "vercel" },
    ]);
    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("Resend"),
    });
  });

  it("201 when GitHub + Vercel + Resend are connected (no Netlify required)", async () => {
    prismaMock.integrationAccount.findMany.mockResolvedValueOnce([
      { provider: "github" },
      { provider: "vercel" },
      { provider: "resend" },
    ]);

    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(201);
    expect(prismaMock.siteJob.create).toHaveBeenCalledTimes(1);
  });

  it("409 when slug is taken", async () => {
    prismaMock.site.findUnique.mockResolvedValueOnce({ id: "existing" });
    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(409);
    expect(prismaMock.site.create).not.toHaveBeenCalled();
    expect(prismaMock.siteJob.create).not.toHaveBeenCalled();
  });

  it("201 success: creates the site in `creating`, queues a create_site job and returns at once", async () => {
    const res = await POST(buildRequest({ name: "Sarah Chen" }));

    expect(res.status).toBe(201);
    expect(prismaMock.site.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1", name: "Sarah Chen", slug: "sarah-chen", status: "creating" }),
    });
    expect(prismaMock.siteJob.create).toHaveBeenCalledWith({
      data: {
        siteId: "site-1",
        userId: "user-1",
        type: "create_site",
        status: "queued",
        requestPayload: { name: "Sarah Chen", slug: "sarah-chen", blueprintType: "solo-artist" },
      },
    });
    // Provisioning runs in the queue, never inside this request.
    expect(prismaMock.siteJob.update).not.toHaveBeenCalled();
    expect(drainAfterResponseMock).toHaveBeenCalledTimes(1);

    const body = (await res.json()) as { site: { id: string }; jobId: string };
    expect(body).toEqual({ site: { id: "site-1", name: "Sarah Chen" }, jobId: "job-1" });
  });

  it("trims the name before validating and storing it", async () => {
    await POST(buildRequest({ name: "  Sarah Chen  " }));
    expect(prismaMock.site.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Sarah Chen", slug: "sarah-chen" }),
    });
  });

  it("500 when enqueueing fails, and drops the site so it isn't stuck in `creating`", async () => {
    prismaMock.siteJob.create.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(buildRequest({ name: "Sarah Chen" }));

    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining("try again") });
    expect(prismaMock.site.delete).toHaveBeenCalledWith({ where: { id: "site-1" } });
    expect(drainAfterResponseMock).not.toHaveBeenCalled();
  });
});
