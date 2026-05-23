import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@stagecraft/db";

import { auth } from "@/lib/auth";
import { validateResendToken } from "@/lib/integrations/resend";
import { verifyVerificationToken } from "@/lib/resend-verification";

/**
 * Step 2 of the Resend connect flow. Step 1 (POST /verify-send) sent a
 * one-time code to the artist's claimed Resend account email via the
 * sandbox sender, and returned a signed verificationToken. Here we:
 *
 *   1. Re-validate the API key (defense — request body is client-controlled).
 *   2. Verify the JWT + match the user-entered code against what we
 *      embedded at /verify-send.
 *   3. Persist the IntegrationAccount AND set User.email to the
 *      verified address (single source of truth — used as ADMIN_EMAIL
 *      on every site the artist creates).
 *
 * No sender field — every send (verification code AND artist-site
 * magic-links) uses the Resend sandbox. Per-site custom-domain sender
 * is a future per-site setting.
 */
const connectSchema = z.object({
  token: z.string().trim().min(1, "API key is required"),
  verificationToken: z.string().min(1, "Verification token is required"),
  code: z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { token, verificationToken, code } = parsed.data;

  try {
    await validateResendToken(token);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json(
      { error: `Resend rejected the API key: ${message}` },
      { status: 400 },
    );
  }

  const verification = await verifyVerificationToken(verificationToken);
  if (!verification) {
    return NextResponse.json(
      {
        error:
          "Verification link expired or invalid — request a new code.",
      },
      { status: 400 },
    );
  }
  if (verification.userId !== session.user.id) {
    return NextResponse.json(
      { error: "Verification token belongs to a different user." },
      { status: 403 },
    );
  }
  if (verification.code !== code) {
    return NextResponse.json(
      { error: "Code didn't match — check the email and try again." },
      { status: 400 },
    );
  }

  const adminEmail = verification.adminEmail;

  await prisma.$transaction([
    prisma.integrationAccount.upsert({
      where: {
        userId_provider: { userId: session.user.id, provider: "resend" },
      },
      update: {
        accessToken: token,
        providerAccountId: adminEmail,
        metadata: {},
        updatedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        provider: "resend",
        providerAccountId: adminEmail,
        accessToken: token,
        metadata: {},
      },
    }),
    prisma.user.update({
      where: { id: session.user.id },
      data: { email: adminEmail },
    }),
  ]);

  return NextResponse.json({ ok: true, adminEmail });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.integrationAccount.deleteMany({
    where: { userId: session.user.id, provider: "resend" },
  });

  return NextResponse.json({ ok: true });
}
