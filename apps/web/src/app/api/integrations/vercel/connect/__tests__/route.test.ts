import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, validateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    integrationAccount: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  validateMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/integrations/vercel", () => ({ validateVercelToken: validateMock }));

import { POST, DELETE } from "../route";

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://platform.test/api/integrations/vercel/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.mockReset();
  prismaMock.integrationAccount.upsert.mockReset();
  prismaMock.integrationAccount.deleteMany.mockReset();
  validateMock.mockReset();

  authMock.mockResolvedValue({ user: { id: "user-1" } });
  prismaMock.integrationAccount.upsert.mockResolvedValue({});
  prismaMock.integrationAccount.deleteMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/integrations/vercel/connect", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(buildRequest({ token: "x" }));
    expect(res.status).toBe(401);
    expect(validateMock).not.toHaveBeenCalled();
    expect(prismaMock.integrationAccount.upsert).not.toHaveBeenCalled();
  });

  it("400 when token is missing", async () => {
    const res = await POST(buildRequest({}));
    expect(res.status).toBe(400);
    expect(validateMock).not.toHaveBeenCalled();
  });

  it("400 when Vercel rejects the token", async () => {
    validateMock.mockRejectedValue(new Error("Vercel API error (401): forbidden"));
    const res = await POST(buildRequest({ token: "bad-token" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Vercel rejected the token");
    expect(prismaMock.integrationAccount.upsert).not.toHaveBeenCalled();
  });

  it("upserts IntegrationAccount on a valid token, returns the username", async () => {
    validateMock.mockResolvedValue({ userId: "vercel-user-1", username: "jclaw" });

    const res = await POST(buildRequest({ token: "vercel_test_token" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; username: string };
    expect(body).toEqual({ ok: true, username: "jclaw" });

    expect(prismaMock.integrationAccount.upsert).toHaveBeenCalledWith({
      where: { userId_provider: { userId: "user-1", provider: "vercel" } },
      update: expect.objectContaining({
        accessToken: "vercel_test_token",
        providerAccountId: "vercel-user-1",
        metadata: { username: "jclaw", teamId: null },
      }),
      create: expect.objectContaining({
        userId: "user-1",
        provider: "vercel",
        providerAccountId: "vercel-user-1",
        accessToken: "vercel_test_token",
        metadata: { username: "jclaw", teamId: null },
      }),
    });
  });

  it("stores teamId in metadata when provided", async () => {
    validateMock.mockResolvedValue({ userId: "u-1", username: "j" });
    await POST(buildRequest({ token: "tok", teamId: "team_xyz" }));

    expect(prismaMock.integrationAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          metadata: { username: "j", teamId: "team_xyz" },
        }),
      }),
    );
  });

  it("trims whitespace from token before validation", async () => {
    validateMock.mockResolvedValue({ userId: "u-1", username: "j" });
    await POST(buildRequest({ token: "  tok-with-spaces  " }));
    expect(validateMock).toHaveBeenCalledWith("tok-with-spaces");
  });
});

describe("DELETE /api/integrations/vercel/connect", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(prismaMock.integrationAccount.deleteMany).not.toHaveBeenCalled();
  });

  it("idempotently deletes the vercel integration row", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(prismaMock.integrationAccount.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", provider: "vercel" },
    });
  });
});
