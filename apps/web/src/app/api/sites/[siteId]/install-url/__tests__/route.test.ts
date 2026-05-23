import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { site: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));

import { GET } from "../route";
import { verifyInstallState } from "@/lib/state-signing";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  authMock.mockReset();
  prismaMock.site.findFirst.mockReset();
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
});
