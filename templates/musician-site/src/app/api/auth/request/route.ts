import { NextResponse } from "next/server";

import { createMagicLinkToken, getAllowedEditorEmails } from "@/lib/auth";
import { sendMagicLink } from "@/lib/email";

const isDev = process.env.NODE_ENV !== "production";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  const sentRedirect = NextResponse.redirect(new URL("/admin/login?sent=1", request.url), 303);

  const allowlist = getAllowedEditorEmails();
  if (allowlist.length === 0) {
    if (!isDev) {
      // Production: silently no-op to avoid signalling that the site
      // is misconfigured.
      return sentRedirect;
    }
    console.warn(
      "[auth] No editor allowlist set — dev fallback: sending magic link to " +
        `"${email}". Set ADMIN_EMAILS in .env.local to lock the admin down ` +
        "to specific editors.",
    );
  } else if (!allowlist.includes(email)) {
    if (isDev) {
      console.warn(
        `[auth] Email "${email}" is not on the editor allowlist. ` +
          "No magic link sent. (Production silently accepts any email to prevent enumeration.)",
      );
    }
    return sentRedirect;
  }

  const token = await createMagicLinkToken(email);
  const origin = new URL(request.url).origin;
  const url = `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`;
  await sendMagicLink(email, url);

  return sentRedirect;
}
