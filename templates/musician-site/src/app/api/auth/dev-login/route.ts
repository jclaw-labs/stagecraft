import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  createSessionToken,
  getAllowedEditorEmails,
} from "@/lib/auth";

/**
 * Dev-only escape hatch: POST email, get a session cookie back
 * without the magic-link round-trip. 404 in production.
 *
 * Surfaces as a button on /admin/login when NODE_ENV !== "production"
 * so a fresh clone can sign into /admin without configuring any env
 * vars or clicking through a magic-link URL in the dev console.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const formData = await request.formData();
  const submitted = String(formData.get("email") ?? "").trim().toLowerCase();
  const allowlist = getAllowedEditorEmails();
  // Pick which editor to sign in as:
  // - the submitted email if it's on the allowlist (lets a dev choose an
  //   editor on a multi-editor site),
  // - else the first allowlisted email (preserves the single-editor
  //   "session matches the configured editor" contract),
  // - else the submitted value, falling back to a sentinel so a clone
  //   with no env vars and an empty form still gets a usable session.
  const email = allowlist.includes(submitted)
    ? submitted
    : allowlist[0] ?? (submitted || "dev@localhost");

  if (submitted && allowlist.length > 0 && !allowlist.includes(submitted)) {
    console.warn(
      `[auth] dev-login: "${submitted}" is not on the editor allowlist; ` +
        `signing in as "${email}" instead.`,
    );
  }

  const session = await createSessionToken(email);
  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set(SESSION_COOKIE, session, SESSION_COOKIE_OPTIONS);
  return response;
}
