import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "#lib/auth.js";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
