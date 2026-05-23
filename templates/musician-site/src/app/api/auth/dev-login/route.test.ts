import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.MAGIC_LINK_SIGNING_SECRET = "test-secret-do-not-use";
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_EMAILS;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function buildRequest(email: string | null): Request {
  const fd = new FormData();
  if (email !== null) fd.append("email", email);
  return new Request("http://localhost/api/auth/dev-login", {
    method: "POST",
    body: fd,
  });
}

function getSessionCookie(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie);
  return match ? decodeURIComponent(match[1]) : null;
}

describe("POST /api/auth/dev-login", () => {
  it("returns 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("anything@example.com"));
    expect(res.status).toBe(404);
  });

  it("sets a session cookie and redirects to /admin in dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("anyone@example.com"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/admin");

    const token = getSessionCookie(res);
    expect(token).toBeTruthy();
    const session = await verifySessionToken(token!);
    expect(session?.email).toBe("anyone@example.com");
  });

  it("prefers ADMIN_EMAIL over the submitted value when set", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.ADMIN_EMAIL = "Locked@Example.com";
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("other@example.com"));

    const token = getSessionCookie(res);
    const session = await verifySessionToken(token!);
    expect(session?.email).toBe("locked@example.com");
  });

  it("falls back to dev@localhost when nothing is submitted and ADMIN_EMAIL is unset", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(null));

    const token = getSessionCookie(res);
    const session = await verifySessionToken(token!);
    expect(session?.email).toBe("dev@localhost");
  });

  it("uses the submitted email when it's on the ADMIN_EMAILS allowlist", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.ADMIN_EMAILS = "artist@example.com, manager@example.com";
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("manager@example.com"));

    const token = getSessionCookie(res);
    const session = await verifySessionToken(token!);
    expect(session?.email).toBe("manager@example.com");
  });

  it("falls back to the first allowlisted email when the submission isn't allowed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.ADMIN_EMAILS = "artist@example.com, manager@example.com";
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("stranger@example.com"));

    const token = getSessionCookie(res);
    const session = await verifySessionToken(token!);
    expect(session?.email).toBe("artist@example.com");
  });
});
