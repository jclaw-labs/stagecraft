import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, deleteResourcesMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    site: { findMany: vi.fn(), delete: vi.fn() },
    siteJob: { deleteMany: vi.fn() },
  },
  deleteResourcesMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/site-cleanup", () => ({ deleteSiteResources: deleteResourcesMock }));

import { POST } from "../route";

beforeEach(() => {
  authMock.mockReset();
  prismaMock.site.findMany.mockReset();
  prismaMock.site.delete.mockReset();
  prismaMock.siteJob.deleteMany.mockReset();
  deleteResourcesMock.mockReset().mockResolvedValue([]);
});

describe("POST /api/admin/nuke-my-sites", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(prismaMock.site.findMany).not.toHaveBeenCalled();
  });

  it("401 when session has no email (defensive — auth normally provides one)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: null } });
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("403 for a non-allowlisted user", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "someone-else@example.com" } });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(prismaMock.site.findMany).not.toHaveBeenCalled();
  });

  it("for the allowlisted operator: deletes every Site they own, calling cleanup per row", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "jclaw3456@gmail.com" } });
    prismaMock.site.findMany.mockResolvedValue([
      { id: "s1", name: "S1", slug: "s1", githubRepoOwner: "o", githubRepoName: "s1", netlifySiteId: null, vercelProjectId: "prj_1", vercelTeamId: null },
      { id: "s2", name: "S2", slug: "s2", githubRepoOwner: "o", githubRepoName: "s2", netlifySiteId: "ntl_2", vercelProjectId: null, vercelTeamId: null },
    ]);

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number; sites: Array<{ id: string; errors: string[] }> };
    expect(body.deleted).toBe(2);
    expect(body.sites.map((s) => s.id)).toEqual(["s1", "s2"]);

    expect(deleteResourcesMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.siteJob.deleteMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.site.delete).toHaveBeenCalledTimes(2);

    // Scoped to the operator's own userId — never bulk-delete other users.
    const findArgs = prismaMock.site.findMany.mock.calls[0][0];
    expect(findArgs.where.userId).toBe("u1");
  });

  it("surfaces per-site cleanup errors but still deletes the DB row", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "jclaw3456@gmail.com" } });
    prismaMock.site.findMany.mockResolvedValue([
      { id: "s1", name: "S1", slug: "s1", githubRepoOwner: "o", githubRepoName: "s1", netlifySiteId: null, vercelProjectId: "prj_1", vercelTeamId: null },
    ]);
    deleteResourcesMock.mockResolvedValueOnce(["Vercel: 404 Not Found"]);

    const res = await POST();
    const body = (await res.json()) as { sites: Array<{ errors: string[] }> };
    expect(body.sites[0].errors).toEqual(["Vercel: 404 Not Found"]);
    // DB delete still ran — external errors don't strand the DB row
    expect(prismaMock.site.delete).toHaveBeenCalledTimes(1);
  });

  it("returns an empty report when the operator has no sites (no-op success)", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "jclaw3456@gmail.com" } });
    prismaMock.site.findMany.mockResolvedValue([]);

    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 0, sites: [] });
    expect(deleteResourcesMock).not.toHaveBeenCalled();
  });
});
