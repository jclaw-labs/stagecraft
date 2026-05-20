import { NextResponse } from "next/server";
import { z } from "zod";

import { readSiteConfig } from "@/lib/content";
import { sendContactEmail } from "@/lib/email";

import { clientIp, isRateLimited } from "./rate-limit";

/**
 * Public contact-form endpoint — port of the legacy template's
 * `src/pages/api/contact.ts`. No auth: anonymous visitors submit the
 * form. The artist's address comes from `site.json#contactEmail` and
 * is never returned to the client; replies route back to the
 * submitter via Resend's `replyTo`.
 *
 * Spam controls: an empty-input honeypot (`website`) silently accepts
 * the submission so the bot doesn't learn the trap, and an in-memory
 * IP rate limit caps a single client to 3 messages per minute. The
 * in-memory limiter is per-instance; under serverless scale-out it
 * degrades to "best effort," same as the legacy template.
 */

const MAX_FIELD_BYTES = 5000;

const submissionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().max(200).default(""),
  message: z.string().trim().min(1).max(MAX_FIELD_BYTES),
});

function err(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  if (isRateLimited(clientIp(request))) {
    return err(429, "Too many requests. Please try again in a minute.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return err(400, "Invalid form data.");
  }

  // Honeypot: a hidden field bots tend to autofill. Silently accept so
  // the bot can't tell its submission was dropped.
  const honeypot = (formData.get("website") ?? "").toString();
  if (honeypot.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const parsed = submissionSchema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    subject: formData.get("subject") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) {
    return err(400, "Name, a valid email, and a message are required.");
  }

  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV === "production") {
    return err(503, "Contact form is not configured.");
  }

  const site = await readSiteConfig();
  const submission = parsed.data;
  const subjectLine = submission.subject.length > 0
    ? `[Contact] ${submission.subject}`
    : "[Contact] New message";

  try {
    await sendContactEmail({
      to: site.contactEmail,
      replyTo: submission.email,
      fromName: submission.name,
      subject: subjectLine,
      body: submission.message,
      siteName: site.artistName,
    });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    console.error("[contact] Failed to send email:", cause);
    return err(500, "Failed to send message. Please try again later.");
  }
}
