import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSessionToken, SESSION_COOKIE } from "#lib/auth.js";

import { ADMIN_ROUTES } from "./admin/router.js";
import { API_ROUTES } from "./api/router.js";
import { config, isPublicPath, middleware } from "./middleware.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, MAGIC_LINK_SIGNING_SECRET: "test-secret-do-not-use-in-prod" };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function request(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(pathname, "https://site.test"), {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

/** `NextResponse.next()` marks the response with this header. */
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("isPublicPath", () => {
  it.each(["/admin/login", "/api/auth/request", "/api/auth/verify", "/api/auth/logout", "/api/contact"])(
    "%s is public",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(true);
    },
  );

  it.each(["/admin", "/admin/pages", "/admin/loginx", "/api/authx", "/api/publish-draft", "/api/contacts"])(
    "%s is gated",
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(false);
    },
  );

  // For an admin page the public list is the only gate, so pin the set.
  it("leaves exactly sign-in and the contact form public", () => {
    const urls = [
      ...ADMIN_ROUTES.map((r) => `/admin/${r.pattern}`.replace(/\/$/, "")),
      ...API_ROUTES.map((r) => `/api/${r.pattern}`),
    ].map((url) => url.replace(/:(\w+)/g, "$1"));
    expect(urls.filter(isPublicPath).sort()).toEqual([
      "/admin/login",
      "/api/auth/dev-login",
      "/api/auth/logout",
      "/api/auth/request",
      "/api/auth/verify",
      "/api/contact",
    ]);
  });
});

describe("middleware", () => {
  it("matches all of /admin and /api", () => {
    expect(config.matcher).toEqual(["/admin/:path*", "/api/:path*"]);
  });

  it("lets public paths through without a session", async () => {
    expect(passedThrough(await middleware(request("/admin/login")))).toBe(true);
    expect(passedThrough(await middleware(request("/api/contact")))).toBe(true);
    expect(passedThrough(await middleware(request("/api/auth/verify")))).toBe(true);
  });

  it("redirects a gated admin page to sign-in without a session", async () => {
    const res = await middleware(request("/admin/pages"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://site.test/admin/login");
  });

  it("answers a gated API path with a 401 without a session", async () => {
    for (const pathname of ["/api/publish-draft", "/api/collections/shows/items", "/api/not-an-endpoint"]) {
      const res = await middleware(request(pathname));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        ok: false,
        code: "unauthorized",
        error: "Your session has expired. Sign in again.",
      });
    }
  });

  it("rejects a forged session cookie", async () => {
    expect((await middleware(request("/api/publish-draft", "forged"))).status).toBe(401);
  });

  it("lets gated paths through with a valid session", async () => {
    const token = await createSessionToken("artist@example.com");
    expect(passedThrough(await middleware(request("/admin/pages", token)))).toBe(true);
    expect(passedThrough(await middleware(request("/api/publish-draft", token)))).toBe(true);
  });
});
