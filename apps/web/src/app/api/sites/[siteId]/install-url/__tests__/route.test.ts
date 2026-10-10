import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authMock,
  prismaMock,
  findAppInstallationForOwnerMock,
  listInstallationReposMock,
  setNetlifyEnvVarsMock,
  triggerNetlifyBuildMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { site: { findFirst: vi.fn(), update: vi.fn() } },
  findAppInstallationForOwnerMock: vi.fn(),
  listInstallationReposMock: vi.fn(),
  setNetlifyEnvVarsMock: vi.fn(),
  triggerNetlifyBuildMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/github-app-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github-app-token")>()),
  findAppInstallationForOwner: findAppInstallationForOwnerMock,
}));
vi.mock("@/lib/github-app-install", () => ({
  listInstallationRepos: listInstallationReposMock,
}));
vi.mock("@/lib/integrations/netlify", () => ({
  setEnvVars: setNetlifyEnvVarsMock,
  triggerBuild: triggerNetlifyBuildMock,
}));

import { GET } from "../route";
import { verifyInstallState } from "@/lib/state-signing";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  authMock.mockReset();
  prismaMock.site.findFirst.mockReset();
  prismaMock.site.update.mockReset().mockResolvedValue({});
  findAppInstallationForOwnerMock.mockReset();
  listInstallationReposMock.mockReset();
  setNetlifyEnvVarsMock.mockReset().mockResolvedValue(undefined);
  triggerNetlifyBuildMock.mockReset().mockResolvedValue({ buildId: "build-1" });
  process.env = { ...ORIGINAL_ENV };
  process.env.STAGECRAFT_STATE_SIGNING_SECRET = "test-state-secret";
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function fakeParams(siteId: string) {
  return { params: Promise.resolve({ siteId }) };
}

describe("GET /api/sites/[siteId]/install-url", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new Request("http://t/x"), fakeParams("s1"));
    expect(res.status).toBe(401);
  });

  it("404 when site doesn't belong to the signed-in user", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue(null);
    const res = await GET(new Request("http://t/x"), fakeParams("s1"));
    expect(res.status).toBe(404);
  });

  it("returns a signed install URL pointing at the canonical stagecraft-bot install page", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue({ id: "s1" });
    const res = await GET(new Request("http://t/x"), fakeParams("s1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    const parsed = new URL(body.url);
    expect(parsed.host).toBe("github.com");
    expect(parsed.pathname).toBe("/apps/stagecraft-bot/installations/new");
    const state = parsed.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(await verifyInstallState(state!)).toEqual({ siteId: "s1", userId: "u1" });
  });

  it("netlify auto-detect: overwrites the site's existing env vars when re-keying", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    prismaMock.site.findFirst.mockResolvedValue({
      id: "s1",
      githubRepoOwner: "artist",
      githubRepoName: "site",
      githubInstallationId: null,
      deployTarget: "netlify",
      netlifySiteId: "netlify-abc",
    });
    findAppInstallationForOwnerMock.mockResolvedValue(42);
    listInstallationReposMock.mockResolvedValue([{ owner: "artist", name: "site" }]);

    const res = await GET(new Request("http://t/x"), fakeParams("s1"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, provisioned: true });
    // Netlify's bulk POST only creates, so a re-key must replace the keys
    // the site already has.
    expect(setNetlifyEnvVarsMock).toHaveBeenCalledWith(
      "u1",
      "netlify-abc",
      expect.objectContaining({
        STAGECRAFT_SITE_ID: "s1",
        STAGECRAFT_BROKER_SECRET: expect.stringMatching(/^scbs_[0-9a-f]{64}$/),
      }),
      { replace: true },
    );
    expect(triggerNetlifyBuildMock).toHaveBeenCalledWith("u1", "netlify-abc");
  });
});
