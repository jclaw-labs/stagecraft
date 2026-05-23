import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_COOKIE,
  createMagicLinkToken,
  createSessionToken,
} from "@/lib/auth";

import { GET } from "./route";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.MAGIC_LINK_SIGNING_SECRET = "test-secret-do-not-use";
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_EMAILS;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function buildRequest(token: string | null): Request {
  const url =
    token === null
      ? "http://localhost/api/auth/verify"
      : `http://localhost/api/auth/verify?token=${encodeURIComponent(token)}`;
  return new Request(url);
}

function locationPath(res: Response): string {
  return new URL(res.headers.get("location")!, "http://localhost").pathname;
}

function getSessionCookie(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie);
  return match ? decodeURIComponent(match[1]) : null;
}

describe("GET /api/auth/verify", () => {
  it("redirects to ?error=missing when no token is supplied", async () => {
    const res = await GET(buildRequest(null));
    expect(res.headers.get("location")).toContain("/admin/login?error=missing");
    expect(getSessionCookie(res)).toBeNull();
  });

  it("redirects to ?error=invalid for a malformed token", async () => {
    const res = await GET(buildRequest("not-a-jwt"));
    expect(res.headers.get("location")).toContain("/admin/login?error=invalid");
    expect(getSessionCookie(res)).toBeNull();
  });

  it("rejects a session token presented as a magic-link token", async () => {
    const sessionToken = await createSessionToken("artist@example.com");
    const res = await GET(buildRequest(sessionToken));
    expect(res.headers.get("location")).toContain("/admin/login?error=invalid");
    expect(getSessionCookie(res)).toBeNull();
  });

  it("mints a session for a valid link when no allowlist is configured (dev)", async () => {
    const token = await createMagicLinkToken("anyone@example.com");
    const res = await GET(buildRequest(token));
    expect(locationPath(res)).toBe("/admin");
    expect(getSessionCookie(res)).toBeTruthy();
  });

  it("rejects a valid link in production when no allowlist is configured (fail closed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const token = await createMagicLinkToken("anyone@example.com");
    const res = await GET(buildRequest(token));
    expect(res.headers.get("location")).toContain("/admin/login?error=invalid");
    expect(getSessionCookie(res)).toBeNull();
  });

  it("mints a session for a valid link when the email is on the allowlist", async () => {
    process.env.ADMIN_EMAILS = "artist@example.com, manager@example.com";
    const token = await createMagicLinkToken("manager@example.com");
    const res = await GET(buildRequest(token));
    expect(locationPath(res)).toBe("/admin");
    expect(getSessionCookie(res)).toBeTruthy();
  });

  it("rejects a valid link whose email was removed from the allowlist", async () => {
    // Link minted while the editor was allowed; the editor is then
    // removed before they click it.
    const token = await createMagicLinkToken("removed@example.com");
    process.env.ADMIN_EMAILS = "artist@example.com";
    const res = await GET(buildRequest(token));
    expect(res.headers.get("location")).toContain("/admin/login?error=invalid");
    expect(getSessionCookie(res)).toBeNull();
  });
});
