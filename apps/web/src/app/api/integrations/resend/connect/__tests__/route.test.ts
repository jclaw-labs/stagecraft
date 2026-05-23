import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, validateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    integrationAccount: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(async (queries: unknown[]) => Promise.all(queries)),
  },
  validateMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/integrations/resend", () => ({ validateResendToken: validateMock }));

import { POST, DELETE } from "../route";
import { signVerificationToken } from "@/lib/resend-verification";

const ORIGINAL_ENV = { ...process.env };

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://platform.test/api/integrations/resend/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.mockReset();
  prismaMock.integrationAccount.upsert.mockReset();
  prismaMock.integrationAccount.deleteMany.mockReset();
  prismaMock.user.update.mockReset();
  validateMock.mockReset();

  process.env = {
    ...ORIGINAL_ENV,
    STAGECRAFT_STATE_SIGNING_SECRET: "test-secret-please-do-not-use-in-prod",
  };
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  prismaMock.integrationAccount.upsert.mockResolvedValue({});
  prismaMock.integrationAccount.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.user.update.mockResolvedValue({ id: "user-1", email: "x@x.com" });
  validateMock.mockResolvedValue({ restricted: false, domains: [] });
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function makeVerificationToken(overrides: { adminEmail?: string; code?: string; userId?: string } = {}) {
  return signVerificationToken({
    adminEmail: overrides.adminEmail ?? "artist@example.com",
    code: overrides.code ?? "123456",
    userId: overrides.userId ?? "user-1",
  });
}

describe("POST /api/integrations/resend/connect", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const verificationToken = await makeVerificationToken();
    const res = await POST(
      buildRequest({ token: "re_x", verificationToken, code: "123456" }),
    );
    expect(res.status).toBe(401);
    expect(validateMock).not.toHaveBeenCalled();
  });

  it("400 when verificationToken is missing", async () => {
    const res = await POST(buildRequest({ token: "re_x", code: "123456" }));
    expect(res.status).toBe(400);
  });

  it("400 when code isn't 6 digits", async () => {
    const verificationToken = await makeVerificationToken();
    const res = await POST(
      buildRequest({ token: "re_x", verificationToken, code: "12abc" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when Resend rejects the API key", async () => {
    validateMock.mockRejectedValue(new Error("Resend API error (401): unauthorized"));
    const verificationToken = await makeVerificationToken();
    const res = await POST(
      buildRequest({ token: "re_bad", verificationToken, code: "123456" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when verificationToken is invalid / expired", async () => {
    const res = await POST(
      buildRequest({ token: "re_good", verificationToken: "obvious-garbage", code: "123456" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("expired or invalid"),
    });
  });

  it("403 when verification token belongs to a different user", async () => {
    const verificationToken = await makeVerificationToken({ userId: "other-user" });
    const res = await POST(
      buildRequest({ token: "re_good", verificationToken, code: "123456" }),
    );
    expect(res.status).toBe(403);
  });

  it("400 when user-entered code doesn't match the one we sent", async () => {
    const verificationToken = await makeVerificationToken({ code: "123456" });
    const res = await POST(
      buildRequest({ token: "re_good", verificationToken, code: "999999" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining("Code didn't match"),
    });
  });

  it("200 + persists IntegrationAccount AND writes verified email to User.email", async () => {
    const verificationToken = await makeVerificationToken({
      adminEmail: "artist@example.com",
      code: "424242",
    });
    const res = await POST(
      buildRequest({ token: "re_good", verificationToken, code: "424242" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; adminEmail: string };
    expect(body).toEqual({ ok: true, adminEmail: "artist@example.com" });
    expect(prismaMock.integrationAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          accessToken: "re_good",
          providerAccountId: "artist@example.com",
          metadata: {},
        }),
      }),
    );
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { email: "artist@example.com" },
    });
  });
});

describe("DELETE /api/integrations/resend/connect", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("200 + deletes the resend integration row", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(prismaMock.integrationAccount.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", provider: "resend" },
    });
  });
});
