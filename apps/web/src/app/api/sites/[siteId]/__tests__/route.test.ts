import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, setRepoArchivedMock, vercelDeleteMock, netlifyDeleteMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    site: { findFirst: vi.fn(), delete: vi.fn() },
    siteJob: { deleteMany: vi.fn() },
  },
  setRepoArchivedMock: vi.fn(),
  vercelDeleteMock: vi.fn(),
  netlifyDeleteMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
// DELETE runs the real `deleteSiteResources`; only the provider calls are
// mocked, so these tests cover the repo archive end to end.
vi.mock("@/lib/integrations/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/github")>();
  return { GitHubApiError: actual.GitHubApiError, setRepoArchived: setRepoArchivedMock };
});
vi.mock("@/lib/integrations/vercel", () => ({ deleteProject: vercelDeleteMock }));
vi.mock("@/lib/integrations/netlify", () => ({ deleteSite: netlifyDeleteMock }));

import { GitHubApiError } from "@/lib/integrations/github";
import { DELETE, GET } from "../route";

beforeEach(() => {
  authMock.mockReset();
  prismaMock.site.findFirst.mockReset();
});

function fakeArgs(siteId: string) {
  return { params: Promise.resolve({ siteId }) };
}

describe("GET /api/sites/[siteId] response shape", () => {
  it("redacts brokerSecretHash from the response", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue({
      id: "s1",
      userId: "u1",
      name: "Test",
      brokerSecretHash: "supersecrethash",
      githubInstallationId: 100,
      githubAppSuspended: false,
      jobs: [],
    });
    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { site: Record<string, unknown> };
    expect(body.site).not.toHaveProperty("brokerSecretHash");
    expect(body.site.id).toBe("s1");
    // Non-secret install state still flows through
    expect(body.site.githubInstallationId).toBe(100);
    expect(body.site.githubAppSuspended).toBe(false);
  });

  it("narrows jobs left over from the retired AI-edit flow", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue({
      id: "s1",
      userId: "u1",
      brokerSecretHash: null,
      jobs: [
        { id: "j2", type: "edit_site", status: "awaiting_review", failureCategory: "ai_error", errorMessage: "old" },
        { id: "j1", type: "create_site", status: "completed", failureCategory: null, errorMessage: null },
      ],
    });
    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { site: { jobs: unknown[] } };
    expect(body.site.jobs).toEqual([
      { id: "j2", type: null, status: null, failureCategory: "unknown", errorMessage: "old" },
      { id: "j1", type: "create_site", status: "completed", failureCategory: null, errorMessage: null },
    ]);
  });

  it("404 when no site matches the user", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    expect(res.status).toBe(404);
  });

  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/sites/[siteId]", () => {
  beforeEach(() => {
    prismaMock.site.delete.mockReset().mockResolvedValue({});
    prismaMock.siteJob.deleteMany.mockReset().mockResolvedValue({ count: 0 });
    setRepoArchivedMock.mockReset().mockResolvedValue(undefined);
    vercelDeleteMock.mockReset().mockResolvedValue(undefined);
    netlifyDeleteMock.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const SITE_ROW = {
    id: "s1",
    userId: "u1",
    githubRepoOwner: "jclaw",
    githubRepoName: "my-site",
    netlifySiteId: null,
    vercelProjectId: "prj_1",
    vercelTeamId: null,
  };

  it("deletes the host project, archives the repo, then deletes the site row", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(SITE_ROW);

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, errors: [] });
    expect(vercelDeleteMock).toHaveBeenCalledWith("u1", "prj_1", undefined);
    expect(setRepoArchivedMock).toHaveBeenCalledWith("u1", "jclaw", "my-site", true);
    expect(prismaMock.siteJob.deleteMany).toHaveBeenCalledWith({ where: { siteId: "s1" } });
    expect(prismaMock.site.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("still deletes the row and reports the error when archiving the repo fails", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(SITE_ROW);
    setRepoArchivedMock.mockRejectedValue(new GitHubApiError(403, '{"message":"Must have admin rights"}'));

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deleted: true,
      errors: [
        'GitHub: could not archive jclaw/my-site: GitHub API error (403): {"message":"Must have admin rights"}',
      ],
    });
    expect(vercelDeleteMock).toHaveBeenCalled();
    expect(prismaMock.siteJob.deleteMany).toHaveBeenCalledWith({ where: { siteId: "s1" } });
    expect(prismaMock.site.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("still deletes the row when the host cleanup fails", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(SITE_ROW);
    vercelDeleteMock.mockRejectedValue(new Error("boom"));

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, errors: ["Vercel: boom"] });
    // The archive still runs after the host cleanup failed.
    expect(setRepoArchivedMock).toHaveBeenCalledWith("u1", "jclaw", "my-site", true);
    expect(prismaMock.site.delete).toHaveBeenCalled();
  });

  it("does not try to archive when the site has no repo", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue({ ...SITE_ROW, githubRepoOwner: null, githubRepoName: null });

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, errors: [] });
    expect(setRepoArchivedMock).not.toHaveBeenCalled();
    expect(prismaMock.site.delete).toHaveBeenCalled();
  });

  it("404 when no site matches the user", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(null);

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(404);
    expect(setRepoArchivedMock).not.toHaveBeenCalled();
    expect(vercelDeleteMock).not.toHaveBeenCalled();
    expect(prismaMock.site.delete).not.toHaveBeenCalled();
  });

  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(401);
    expect(setRepoArchivedMock).not.toHaveBeenCalled();
    expect(prismaMock.site.delete).not.toHaveBeenCalled();
  });
});
