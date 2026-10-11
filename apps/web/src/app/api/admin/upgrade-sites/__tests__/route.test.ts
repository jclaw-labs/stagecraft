import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, enqueueMock, drainAfterResponseMock, readTemplateFilesMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    site: { findMany: vi.fn() },
    siteJob: { findFirst: vi.fn() },
  },
  enqueueMock: vi.fn(),
  drainAfterResponseMock: vi.fn(),
  readTemplateFilesMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@stagecraft/queue", () => ({ enqueue: enqueueMock }));
vi.mock("@/lib/jobs/worker", () => ({ drainAfterResponse: drainAfterResponseMock }));
vi.mock("@/lib/template-reader", () => ({ readTemplateFiles: readTemplateFilesMock }));

import { POST } from "../route";

const ADMIN = { user: { id: "admin-1", email: "jclaw3456@gmail.com" } };

const site = (id: string, userId: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId,
  name: `Site ${id}`,
  status: "active",
  githubRepoOwner: "owner",
  githubRepoName: `repo-${id}`,
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue(ADMIN);
  readTemplateFilesMock.mockResolvedValue([
    { path: "package.json", content: JSON.stringify({ dependencies: { "@jclaw-labs/musician-site": "1.4.0" } }) },
  ]);
  prismaMock.site.findMany.mockResolvedValue([site("a", "user-a"), site("b", "user-b"), site("c", "user-c", { githubRepoName: null })]);
  prismaMock.siteJob.findFirst.mockImplementation(async ({ where }) => (where.siteId === "b" ? { id: "running" } : null));
  enqueueMock.mockImplementation(async ({ siteId }) => ({ id: `job-${siteId}` }));
});

describe("POST /api/admin/upgrade-sites", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
  });

  it("403 for a signed-in user who isn't a platform admin", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "artist@example.com" } });
    expect((await POST()).status).toBe(403);
    expect(prismaMock.site.findMany).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("409 when no release is on npm's latest yet", async () => {
    readTemplateFilesMock.mockResolvedValue([]);
    expect((await POST()).status).toBe(409);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("queues every live site as its own owner, skipping ones already upgrading or without a repo", async () => {
    const res = await POST();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      packageVersion: "1.4.0",
      queued: [{ id: "a", name: "Site a", jobId: "job-a" }],
      skipped: [
        { id: "b", name: "Site b", reason: "in_flight" },
        { id: "c", name: "Site c", reason: "no_repo" },
      ],
    });
    // Every user's live sites, not just the admin's.
    expect(prismaMock.site.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "active" } }));
    expect(enqueueMock).toHaveBeenCalledWith({ siteId: "a", userId: "user-a", type: "upgrade_site" });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(drainAfterResponseMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't start the worker when nothing was queued", async () => {
    prismaMock.site.findMany.mockResolvedValue([]);
    const res = await POST();
    expect(await res.json()).toMatchObject({ queued: [], skipped: [] });
    expect(drainAfterResponseMock).not.toHaveBeenCalled();
  });
});
