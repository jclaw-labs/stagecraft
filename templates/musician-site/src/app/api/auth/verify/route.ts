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

  // Defense-in-depth (ADR-011): re-check the allowlist at verify time so
  // a link issued to an editor who was since removed can't still mint a
  // session. Skipped when no allowlist is configured (dev "no lockdown") —
  // production issues no links in that state, so this never gates prod.
  const allowlist = getAllowedEditorEmails();
  if (allowlist.length > 0 && !allowlist.includes(result.email.trim().toLowerCase())) {
    return NextResponse.redirect(new URL("/admin/login?error=invalid", request.url));
  }

  const session = await createSessionToken(result.email);
  const response = NextResponse.redirect(new URL("/admin", request.url));
  response.cookies.set(SESSION_COOKIE, session, SESSION_COOKIE_OPTIONS);
  return response;
}
