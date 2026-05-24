import { redirect } from "next/navigation";

import { prisma } from "@stagecraft/db";

import { auth } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import { ConnectResend } from "../settings/ConnectResend";
import styles from "./onboarding.module.css";

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
    <AppShell user={{ name: session.user.name, email: session.user.email }}>
      <div className={styles.container}>
        <h1 className={styles.title}>Welcome to Stagecraft</h1>
        <p className={styles.lead}>
          One quick setup step. Stagecraft uses your own Resend account to send
          magic-link sign-in emails (and contact-form submissions) on the
          musician sites you create — we never send mail on your behalf, and
          your sites&rsquo; subscribers&rsquo; addresses never reach our servers.
        </p>
        <p className={styles.signupHint}>
          Don&rsquo;t have a Resend account?{" "}
          <a href="https://resend.com/signup" target="_blank" rel="noopener noreferrer">
            Sign up here
          </a>{" "}
          — free tier covers everything you&rsquo;ll need.
        </p>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Connect Resend</h2>
          <ConnectResend successRedirect="/dashboard" />
        </section>
      </div>
    </AppShell>
  );
}
