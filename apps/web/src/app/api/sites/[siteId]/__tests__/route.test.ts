import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, deleteResourcesMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    site: { findFirst: vi.fn(), delete: vi.fn() },
    siteJob: { deleteMany: vi.fn() },
  },
  deleteResourcesMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/integrations/github", () => ({
  setRepoArchived: vi.fn(),
}));
vi.mock("@/lib/site-cleanup", () => ({ deleteSiteResources: deleteResourcesMock }));

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
    deleteResourcesMock.mockReset().mockResolvedValue([]);
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

  it("deletes the site row and runs external cleanup (which keeps the repo)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(SITE_ROW);

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, errors: [] });
    expect(deleteResourcesMock).toHaveBeenCalledWith("u1", SITE_ROW);
    expect(prismaMock.siteJob.deleteMany).toHaveBeenCalledWith({ where: { siteId: "s1" } });
    expect(prismaMock.site.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
  });

  it("still deletes the row when external cleanup reports errors", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(SITE_ROW);
    deleteResourcesMock.mockResolvedValue(["Vercel: boom"]);

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, errors: ["Vercel: boom"] });
    expect(prismaMock.site.delete).toHaveBeenCalled();
  });

  it("404 when no site matches the user", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(null);

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(404);
    expect(deleteResourcesMock).not.toHaveBeenCalled();
    expect(prismaMock.site.delete).not.toHaveBeenCalled();
  });

  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);

    const res = await DELETE(new Request("http://t/x") as never, fakeArgs("s1"));

    expect(res.status).toBe(401);
    expect(deleteResourcesMock).not.toHaveBeenCalled();
  });
});
