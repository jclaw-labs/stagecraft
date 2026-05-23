import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, vercelMock, netlifyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { site: { findFirst: vi.fn() } },
  vercelMock: { getLatestDeployment: vi.fn() },
  netlifyMock: { getLatestDeploy: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/integrations/vercel", () => vercelMock);
vi.mock("@/lib/integrations/netlify", () => netlifyMock);

import { GET } from "../route";

beforeEach(() => {
  authMock.mockReset();
  prismaMock.site.findFirst.mockReset();
  vercelMock.getLatestDeployment.mockReset();
  netlifyMock.getLatestDeploy.mockReset();
});

function fakeArgs(siteId: string) {
  return { params: Promise.resolve({ siteId }) };
}

describe("GET /api/sites/[siteId]/deploy-status", () => {
  it("401 when unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    expect(res.status).toBe(401);
  });

  it("404 when site not found for this user", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    expect(res.status).toBe(404);
  });

  it("proxies to vercel.getLatestDeployment when deployTarget=vercel", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue({
      deployTarget: "vercel",
      vercelProjectId: "prj_abc",
      vercelTeamId: "team_x",
      netlifySiteId: null,
    });
    vercelMock.getLatestDeployment.mockResolvedValue({
      id: "dpl_1",
      state: "building",
      url: "https://x.vercel.app",
      createdAt: "2026-05-04T00:00:00Z",
    });

    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    const body = (await res.json()) as { deploy: { state: string; id: string } };

    expect(res.status).toBe(200);
    expect(vercelMock.getLatestDeployment).toHaveBeenCalledWith("u1", "prj_abc", "team_x");
    expect(body.deploy.id).toBe("dpl_1");
    expect(body.deploy.state).toBe("building");
  });

  it("proxies to netlify.getLatestDeploy when deployTarget=netlify", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue({
      deployTarget: "netlify",
      netlifySiteId: "ntf_abc",
      vercelProjectId: null,
      vercelTeamId: null,
    });
    netlifyMock.getLatestDeploy.mockResolvedValue({
      id: "dep_1",
      state: "ready",
      url: "https://x.netlify.app",
      errorMessage: null,
      createdAt: "2026-05-04T00:00:00Z",
    });

    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    const body = (await res.json()) as { deploy: { state: string } };

    expect(res.status).toBe(200);
    expect(netlifyMock.getLatestDeploy).toHaveBeenCalledWith("u1", "ntf_abc");
    expect(body.deploy.state).toBe("ready");
  });

  it("returns state=unknown when site has no deploy target id yet", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue({
      deployTarget: "vercel",
      vercelProjectId: null,
      vercelTeamId: null,
      netlifySiteId: null,
    });
    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    const body = (await res.json()) as { deploy: { state: string } };
    expect(body.deploy.state).toBe("unknown");
  });

  it("502 when the upstream provider fails", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue({
      deployTarget: "vercel",
      vercelProjectId: "prj_abc",
      vercelTeamId: null,
      netlifySiteId: null,
    });
    vercelMock.getLatestDeployment.mockRejectedValue(new Error("Vercel 500"));
    const res = await GET(new Request("http://t/x") as never, fakeArgs("s1"));
    expect(res.status).toBe(502);
  });
});
