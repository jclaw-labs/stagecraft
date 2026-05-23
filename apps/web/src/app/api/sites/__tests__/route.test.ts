import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, handleCreateSiteMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    integrationAccount: { findMany: vi.fn() },
    site: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    siteJob: { create: vi.fn(), update: vi.fn() },
  },
  handleCreateSiteMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/jobs/create-site", () => ({ handleCreateSite: handleCreateSiteMock }));

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
  prismaMock.siteJob.create.mockReset();
  prismaMock.siteJob.update.mockReset();
  handleCreateSiteMock.mockReset();

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
    status: "running",
  });
  prismaMock.siteJob.update.mockResolvedValue({});
});

describe("POST /api/sites", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(401);
    expect(handleCreateSiteMock).not.toHaveBeenCalled();
  });

  it("400 when name is missing", async () => {
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
    expect(handleCreateSiteMock).not.toHaveBeenCalled();
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
    handleCreateSiteMock.mockResolvedValue({ success: true, data: { deployTarget: "vercel" } });
    prismaMock.site.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "site-1", status: "active" });

    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(201);
    expect(handleCreateSiteMock).toHaveBeenCalledTimes(1);
  });

  it("409 when slug is taken", async () => {
    prismaMock.site.findUnique.mockResolvedValueOnce({ id: "existing" });
    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(409);
  });

  it("201 success: runs handleCreateSite synchronously, marks SiteJob completed, returns final Site", async () => {
    handleCreateSiteMock.mockResolvedValue({
      success: true,
      data: {
        githubUrl: "https://github.com/jclaw/stagecraft-site-sarah-chen",
        netlifyAdminUrl: "https://app.netlify.com/sites/...",
        netlifySiteId: "netlify-1",
      },
    });
    // After handleCreateSite ran, the Site row has been updated with
    // status=active and Netlify metadata. Mock the second findUnique to
    // return that updated row.
    prismaMock.site.findUnique
      .mockResolvedValueOnce(null) // slug-uniqueness check
      .mockResolvedValueOnce({
        id: "site-1",
        status: "active",
        productionUrl: "https://sarah-chen.netlify.app",
        netlifySiteId: "netlify-1",
      });

    const res = await POST(buildRequest({ name: "Sarah Chen" }));

    expect(res.status).toBe(201);
    expect(handleCreateSiteMock).toHaveBeenCalledTimes(1);
    expect(handleCreateSiteMock).toHaveBeenCalledWith({
      job: expect.objectContaining({ id: "job-1", siteId: "site-1" }),
    });

    expect(prismaMock.siteJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "completed",
        completedAt: expect.any(Date),
        errorMessage: null,
      }),
    });

    const body = (await res.json()) as {
      site: { id: string; status: string };
      jobId: string;
      jobResult: { success: boolean };
    };
    expect(body.site.status).toBe("active");
    expect(body.jobId).toBe("job-1");
    expect(body.jobResult.success).toBe(true);
  });

  it("500 failure: marks SiteJob failed with error message, response body includes jobResult.message", async () => {
    handleCreateSiteMock.mockResolvedValue({
      success: false,
      message: "Netlify quota exceeded",
      failureCategory: "netlify_deploy_error",
    });
    prismaMock.site.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "site-1", status: "error" });

    const res = await POST(buildRequest({ name: "Sarah Chen" }));

    expect(res.status).toBe(500);
    expect(prismaMock.siteJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "failed",
        completedAt: expect.any(Date),
        errorMessage: "Netlify quota exceeded",
        failureCategory: "netlify_deploy_error",
      }),
    });

    const body = (await res.json()) as {
      site: { status: string };
      jobResult: { success: boolean; message: string };
    };
    expect(body.site.status).toBe("error");
    expect(body.jobResult.success).toBe(false);
    expect(body.jobResult.message).toBe("Netlify quota exceeded");
  });

  it("returns 400 + installUrl when handleCreateSite reports vercel_github_app_missing", async () => {
    // The /create UI keys off failureCategory + installUrl in the
    // response to render a clickable "Install Vercel's GitHub App"
    // CTA instead of the raw error JSON.
    handleCreateSiteMock.mockResolvedValue({
      success: false,
      message:
        "Vercel can't link this repo until you install Vercel's GitHub App on your GitHub account.",
      failureCategory: "vercel_github_app_missing",
      data: { installUrl: "https://github.com/apps/vercel/installations/new" },
    });

    const res = await POST(buildRequest({ name: "Sarah Chen" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      failureCategory: string;
      installUrl: string;
    };
    expect(body.failureCategory).toBe("vercel_github_app_missing");
    expect(body.installUrl).toBe("https://github.com/apps/vercel/installations/new");

    // Job row still gets recorded as failed for the audit trail, even
    // though the site row itself was rolled back inside handleCreateSite.
    expect(prismaMock.siteJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "failed",
        failureCategory: "vercel_github_app_missing",
      }),
    });
  });
});
