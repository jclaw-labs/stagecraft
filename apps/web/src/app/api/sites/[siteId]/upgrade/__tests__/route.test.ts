import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, enqueueMock, drainAfterResponseMock, readTemplateFilesMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    site: { findFirst: vi.fn() },
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

const SHELL_BUNDLE = [
  { path: "package.json", content: JSON.stringify({ dependencies: { "@jclaw-labs/musician-site": "1.4.0" } }) },
];

const LIVE_SITE = {
  id: "site-1",
  userId: "user-1",
  name: "Sarah",
  status: "active",
  githubRepoOwner: "jclaw",
  githubRepoName: "stagecraft-site-sarah",
};

function call(siteId = "site-1") {
  return POST(new Request(`http://platform.test/api/sites/${siteId}/upgrade`, { method: "POST" }), {
    params: Promise.resolve({ siteId }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  prismaMock.site.findFirst.mockResolvedValue(LIVE_SITE);
  prismaMock.siteJob.findFirst.mockResolvedValue(null);
  enqueueMock.mockResolvedValue({ id: "job-9" });
  readTemplateFilesMock.mockResolvedValue(SHELL_BUNDLE);
});

describe("POST /api/sites/[siteId]/upgrade", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("404 when the site isn't the user's", async () => {
    prismaMock.site.findFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(prismaMock.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "site-1", userId: "user-1" } }),
    );
  });

  it("queues an upgrade_site job as the site's owner and starts the worker", async () => {
    const res = await call();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-9", packageVersion: "1.4.0" });
    expect(prismaMock.siteJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: "site-1", type: "upgrade_site", status: { in: ["queued", "running"] } } }),
    );
    expect(enqueueMock).toHaveBeenCalledWith({ siteId: "site-1", userId: "user-1", type: "upgrade_site" });
    expect(drainAfterResponseMock).toHaveBeenCalledTimes(1);
  });

  it("409 when no release is on npm's latest yet", async () => {
    readTemplateFilesMock.mockResolvedValue([{ path: "package.json", content: JSON.stringify({ dependencies: { next: "^15.5.27" } }) }]);
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "There's no new release to upgrade to yet" });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an upgrade is already running", LIVE_SITE, { id: "job-1" }, "An upgrade for this site is already running"],
    ["the site isn't live", { ...LIVE_SITE, status: "archived" }, null, "Only a live site can be upgraded"],
    ["the site has no repo", { ...LIVE_SITE, githubRepoName: null }, null, "This site has no GitHub repository to upgrade"],
  ])("409 when %s", async (_label, site, inFlight, error) => {
    prismaMock.site.findFirst.mockResolvedValue(site);
    prismaMock.siteJob.findFirst.mockResolvedValue(inFlight);

    const res = await call();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(drainAfterResponseMock).not.toHaveBeenCalled();
  });
});
