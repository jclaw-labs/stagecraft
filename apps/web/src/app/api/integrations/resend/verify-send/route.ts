import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  RESEND_SANDBOX_FROM,
  ResendRecipientNotAllowedError,
  sendResendEmail,
  validateResendToken,
} from "@/lib/integrations/resend";
import {
  generateVerificationCode,
  signVerificationToken,
} from "@/lib/resend-verification";

/**
 * Step 1 of the Resend connect flow: send a one-time verification code
 * to the artist's claimed Resend account email, using `onboarding@resend.dev`
 * (Resend's sandbox sender). Sandbox only delivers to the email
 * registered with the Resend account — so successful delivery is also
 * proof that the address the artist typed IS their Resend account
 * email. Doubles as identity verification + reachability proof.
 *
 * Returns a signed verification token containing the code (HS256, 10
 * min TTL); client echoes it back at /connect along with what the user
 * typed.
 */
const sendSchema = z.object({
  token: z.string().trim().min(1, "API key is required"),
  adminEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email must be a valid email"),
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

  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { token, adminEmail } = parsed.data;

  try {
    await validateResendToken(token);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json(
      { error: `Resend rejected the API key: ${message}` },
      { status: 400 },
    );
  }

  const code = generateVerificationCode();

  try {
    await sendResendEmail({
      apiKey: token,
      from: RESEND_SANDBOX_FROM,
      to: adminEmail,
      subject: "Stagecraft: confirm your email",
      text:
        `Your Stagecraft verification code is: ${code}\n\n` +
        "Enter this in the Stagecraft Connect Resend form to finish wiring up your account.\n\n" +
        "If you didn't initiate this, you can ignore this email — the code expires in 10 minutes.",
    });
  } catch (cause) {
    if (cause instanceof ResendRecipientNotAllowedError) {
      return NextResponse.json(
        {
          error:
            `${adminEmail} isn't the email you used to sign up for Resend. Check your Resend account at resend.com — your sign-up email is the only address Stagecraft can deliver to right now.`,
          code: "recipient-not-allowed",
        },
        { status: 400 },
      );
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json(
      { error: `Couldn't send the verification email: ${message}` },
      { status: 502 },
    );
  }

  const verificationToken = await signVerificationToken({
    adminEmail,
    code,
    userId: session.user.id,
  });

  return NextResponse.json({ ok: true, verificationToken, sentTo: adminEmail });
}
