import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "#lib/auth.js";
import type { PublishError } from "#lib/publish-types.js";

/**
 * Paths under `/admin` and `/api` that don't need a session (ADR-016 §1):
 * the sign-in page, the sign-in endpoints (including logout, which must
 * clear an expired cookie), and the public contact form. A prefix covers
 * the path itself and everything below it. Everything else the matcher
 * reaches is gated, so a new protected page or endpoint is gated without
 * a change here or in the artist-repo shell.
 */
export const PUBLIC_PATHS = ["/admin/login", "/api/auth", "/api/contact"] as const;

/** Whether `pathname` is one of `PUBLIC_PATHS` or below one. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      // The handlers' own error envelope, so a client that shows
      // `error` tells the artist what to do rather than "unauthorized".
      const body: PublishError = { ok: false, code: "unauthorized", error: "Sign in to continue." };
      return NextResponse.json(body, { status: 401 });
    }
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// A literal: Next.js reads the matcher statically.
export const config = {
  matcher: ["/admin/:path*", "/api/:path*"],
};
