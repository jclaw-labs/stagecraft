import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, githubRepoClientMock, readSiteVersionMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { site: { findFirst: vi.fn() } },
  githubRepoClientMock: vi.fn(),
  readSiteVersionMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/integrations/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/github")>()),
  githubRepoClient: githubRepoClientMock,
}));
vi.mock("@/lib/site-version", () => ({ readSiteVersion: readSiteVersionMock }));

import { GitHubApiError, GitHubNotConnectedError } from "@/lib/integrations/github";
import { GET } from "../route";

const SITE = { githubRepoOwner: "jclaw", githubRepoName: "stagecraft-site-sarah", githubDefaultBranch: "main" };
const VERSION = { current: "1.2.0", source: "package_json", latest: "1.4.1", updateAvailable: true, pullRequest: null };
const CLIENT = { owner: "jclaw", repo: "stagecraft-site-sarah" };

function call(siteId = "site-1") {
  return GET(new Request(`http://platform.test/api/sites/${siteId}/version`), { params: Promise.resolve({ siteId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  prismaMock.site.findFirst.mockResolvedValue(SITE);
  githubRepoClientMock.mockResolvedValue(CLIENT);
  readSiteVersionMock.mockResolvedValue(VERSION);
});

describe("GET /api/sites/[siteId]/version", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(githubRepoClientMock).not.toHaveBeenCalled();
  });

  it("404 when the site isn't the user's", async () => {
    prismaMock.site.findFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(prismaMock.site.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "site-1", userId: "user-1" } }),
    );
  });

  it("409 when the site has no repo", async () => {
    prismaMock.site.findFirst.mockResolvedValue({ ...SITE, githubRepoName: null });
    expect((await call()).status).toBe(409);
    expect(githubRepoClientMock).not.toHaveBeenCalled();
  });

  it("reads the version from the site's default branch as its owner", async () => {
    prismaMock.site.findFirst.mockResolvedValue({ ...SITE, githubDefaultBranch: "trunk" });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: VERSION });
    expect(githubRepoClientMock).toHaveBeenCalledWith("user-1", "jclaw", "stagecraft-site-sarah");
    expect(readSiteVersionMock).toHaveBeenCalledWith(CLIENT, "trunk");
  });

  it("409 asking to sign in again when GitHub isn't connected", async () => {
    githubRepoClientMock.mockRejectedValue(new GitHubNotConnectedError());
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Sign in with GitHub again");
  });

  it("409 asking to sign in again when GitHub rejects the token", async () => {
    readSiteVersionMock.mockRejectedValue(new GitHubApiError(401, "Bad credentials"));
    expect((await call()).status).toBe(409);
  });

  it("502 when GitHub can't be read", async () => {
    readSiteVersionMock.mockRejectedValue(new GitHubApiError(500, "boom"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error).not.toContain("boom");
  });
});
