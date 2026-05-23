import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  createSessionToken,
  getAllowedEditorEmails,
  verifyMagicLinkToken,
} from "@/lib/auth";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/admin/login?error=missing", request.url));
  }

  const result = await verifyMagicLinkToken(token);
  if (!result) {
    return NextResponse.redirect(new URL("/admin/login?error=invalid", request.url));
  }

  // Defense-in-depth (ADR-011): re-check the allowlist at verify time so a
  // link issued to an editor who was since removed can't mint a session.
  // An empty allowlist means "no lockdown configured": accept in dev (the
  // request route sends links to anyone there), but fail CLOSED in prod —
  // a misconfigured or fully-decommissioned site must not mint sessions
  // from outstanding links.
  const allowlist = getAllowedEditorEmails();
  const allowed =
    allowlist.length === 0
      ? process.env.NODE_ENV !== "production"
      : allowlist.includes(result.email.trim().toLowerCase());
  if (!allowed) {
    return NextResponse.redirect(new URL("/admin/login?error=invalid", request.url));
  }

  const session = await createSessionToken(result.email);
  const response = NextResponse.redirect(new URL("/admin", request.url));
  response.cookies.set(SESSION_COOKIE, session, SESSION_COOKIE_OPTIONS);
  return response;
}
