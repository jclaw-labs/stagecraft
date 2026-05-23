/**
 * POST /api/auth/logout — clears the session cookie and redirects to
 * the login page. POST-only by design (a GET logout would be a CSRF
 * foot-gun: any external `<img src>` could log everyone out). The
 * route doesn't read the session — logging out is unconditional.
 */

import { describe, expect, it } from "vitest";

import { POST } from "./route";
import { SESSION_COOKIE } from "@/lib/auth";

function postReq() {
  return new Request("https://example.com/api/auth/logout", { method: "POST" });
}

describe("POST /api/auth/logout", () => {
  it("redirects to /admin/login with a 303 (See Other)", async () => {
    const res = await POST(postReq());
    // 303 forces the follow-up request to GET regardless of this POST.
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://example.com/admin/login");
  });

  it("clears the session cookie", async () => {
    const res = await POST(postReq());
    // Cookie deletion surfaces as a Set-Cookie that expires the cookie
    // (Max-Age=0). NextResponse exposes it on the cookies API too.
    const cleared = res.cookies.get(SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(SESSION_COOKIE);
    expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires=/);
  });
});
