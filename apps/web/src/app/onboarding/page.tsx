import { redirect } from "next/navigation";

import { prisma } from "@stagecraft/db";

import { auth } from "@/lib/auth";
import { ConnectResend } from "../settings/ConnectResend";

/**
 * First-time setup gate. New Stagecraft users are routed here right
 * after GitHub OAuth; the only thing they can do is connect Resend.
 *
 * Why required: Resend connect doubles as the "verify your email"
 * step. The verification code the artist receives proves the address
 * they entered actually receives mail — that becomes both their
 * platform email-of-record (User.email) and the ADMIN_EMAIL on every
 * site they create. Without it, magic-link sign-in on artist sites
 * would silently fail (the most common reason: Resend's sandbox
 * sender only delivers to the Resend account email).
 */
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const resend = await prisma.integrationAccount.findUnique({
    where: {
      userId_provider: { userId: session.user.id, provider: "resend" },
    },
  });
  if (resend) redirect("/dashboard");

  return (
    <main style={{ maxWidth: "var(--max-width-wide)", margin: "var(--space-10) auto", fontFamily: "var(--font-body)", color: "var(--color-text)" }}>
      <h1>Welcome to Stagecraft</h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
        One quick setup step. Stagecraft uses your own Resend account to send
        magic-link sign-in emails (and contact-form submissions) on the
        musician sites you create — we never send mail on your behalf, and
        your sites&rsquo; subscribers&rsquo; addresses never reach our servers.
      </p>
      <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
        Don&rsquo;t have a Resend account?{" "}
        <a href="https://resend.com/signup" target="_blank" rel="noopener noreferrer">
          Sign up here
        </a>{" "}
        — free tier covers everything you&rsquo;ll need.
      </p>

      <section style={{ marginTop: "var(--space-6)", border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" }}>
        <h2 style={{ marginTop: 0 }}>Connect Resend</h2>
        <ConnectResend successRedirect="/dashboard" />
      </section>
    </main>
  );
}
