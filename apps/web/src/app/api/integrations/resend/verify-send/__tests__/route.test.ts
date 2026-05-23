import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, validateMock, sendMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  validateMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/integrations/resend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/integrations/resend")>(
    "@/lib/integrations/resend",
  );
  return {
    ...actual,
    validateResendToken: validateMock,
    sendResendEmail: sendMock,
  };
});

import { POST } from "../route";
import { ResendRecipientNotAllowedError } from "@/lib/integrations/resend";
import { verifyVerificationToken } from "@/lib/resend-verification";

const ORIGINAL_ENV = { ...process.env };

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://platform.test/api/integrations/resend/verify-send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.mockReset();
  validateMock.mockReset();
  sendMock.mockReset();

  process.env = {
    ...ORIGINAL_ENV,
    STAGECRAFT_STATE_SIGNING_SECRET: "test-secret-please-do-not-use-in-prod",
  };
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  validateMock.mockResolvedValue({ restricted: false, domains: [] });
  sendMock.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("POST /api/integrations/resend/verify-send", () => {
  it("401 when not signed in", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(buildRequest({ token: "re_x", adminEmail: "a@x.com" }));
    expect(res.status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("400 when adminEmail isn't a valid email", async () => {
    const res = await POST(buildRequest({ token: "re_x", adminEmail: "not-email" }));
    expect(res.status).toBe(400);
  });

  it("400 when Resend rejects the API key (validateResendToken throws)", async () => {
    validateMock.mockRejectedValue(new Error("Resend API error (401): unauthorized"));
    const res = await POST(buildRequest({ token: "re_bad", adminEmail: "a@x.com" }));
    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("502 when Resend send fails generically", async () => {
    sendMock.mockRejectedValue(new Error("Resend send failed (500): server error"));
    const res = await POST(buildRequest({ token: "re_good", adminEmail: "a@x.com" }));
    expect(res.status).toBe(502);
  });

  it("400 + recipient-not-allowed code when sandbox 403s on a non-account email", async () => {
    sendMock.mockRejectedValue(new ResendRecipientNotAllowedError("a@x.com"));
    const res = await POST(buildRequest({ token: "re_good", adminEmail: "a@x.com" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("recipient-not-allowed");
    expect(body.error).toContain("isn't the email you used to sign up for Resend");
  });

  it("200 + sends a 6-digit code via Resend sandbox + returns a verifiable token", async () => {
    let capturedArgs: { from?: string; to?: string; subject?: string; text?: string } = {};
    sendMock.mockImplementation(async (args: { from: string; to: string; subject: string; text: string }) => {
      capturedArgs = args;
    });

    const res = await POST(
      buildRequest({ token: "re_good", adminEmail: "Artist@Example.COM" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; verificationToken: string; sentTo: string };
    expect(body.ok).toBe(true);
    expect(body.sentTo).toBe("artist@example.com"); // normalized

    // Always sends from the sandbox; never from a custom domain.
    expect(capturedArgs.from).toBe("onboarding@resend.dev");
    expect(capturedArgs.to).toBe("artist@example.com");

    // Code from email body matches the JWT payload
    const codeMatch = capturedArgs.text!.match(/(\d{6})/);
    expect(codeMatch).not.toBeNull();
    const decoded = await verifyVerificationToken(body.verificationToken);
    expect(decoded).not.toBeNull();
    expect(decoded!.adminEmail).toBe("artist@example.com");
    expect(decoded!.code).toBe(codeMatch![1]);
    expect(decoded!.userId).toBe("user-1");
  });
});
