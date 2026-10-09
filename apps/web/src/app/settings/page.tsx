import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@stagecraft/db";
import { findIntegration } from "@stagecraft/shared";

import AppShell from "@/components/AppShell";
import { STAGECRAFT_GITHUB_APP_INSTALL_URL } from "@/lib/install-url";
import { ConnectNetlify } from "./ConnectNetlify";
import { ConnectResend } from "./ConnectResend";
import { ConnectVercel } from "./ConnectVercel";
import styles from "./settings.module.css";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;

  const githubAppInstallUrl = STAGECRAFT_GITHUB_APP_INSTALL_URL;

  const integrations = await prisma.integrationAccount.findMany({
    where: { userId: session.user.id },
  });

  const github = findIntegration(integrations, "github");
  const netlify = findIntegration(integrations, "netlify");
  const vercel = findIntegration(integrations, "vercel");
  const resend = findIntegration(integrations, "resend");
  const vercelUsername =
    vercel?.metadata && typeof vercel.metadata === "object" && vercel.metadata !== null
      ? (vercel.metadata as { username?: string }).username ?? null
      : null;
  const netlifyEmail =
    netlify?.metadata && typeof netlify.metadata === "object" && netlify.metadata !== null
      ? (netlify.metadata as { email?: string }).email ?? netlify.providerAccountId
      : netlify?.providerAccountId ?? null;
  // Connected admin email = providerAccountId on the Resend
  // IntegrationAccount (set during /connect to the verified address).
  // Mirrors User.email; shown as the connected-state indicator.
  const resendAdminEmail = resend?.providerAccountId ?? null;

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }} current="settings">
      <div className={styles.container}>
        <div className={styles.pageHead}>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.sub}>Connect the services Stagecraft uses to build, deploy, and run your sites.</p>
        </div>

        {params.success && (
          <div className={`${styles.banner} ${styles.bannerSuccess}`}>
            {params.success === "github_connected" && "GitHub connected successfully."}
            {params.success === "netlify_connected" && "Netlify connected successfully."}
            {params.success === "netlify_disconnected" && "Netlify disconnected."}
            {params.success === "vercel_connected" && "Vercel connected successfully."}
            {params.success === "vercel_disconnected" && "Vercel disconnected."}
            {params.success === "resend_connected" && "Resend connected successfully."}
            {params.success === "resend_disconnected" && "Resend disconnected."}
          </div>
        )}

        {params.error && (
          <div className={`${styles.banner} ${styles.bannerError}`}>
            Connection failed. Please try again.
          </div>
        )}

        <p className={styles.intro}>
          GitHub is required (the platform commits to your repo). For deploys, connect either Vercel or Netlify — Vercel is recommended for new sites because its API auto-resolves repo linking; Netlify needs manual GitHub-App setup per repo. Resend is required for magic-link sign-in on artist sites.
        </p>

        <div className={styles.grid}>
          <div className={styles.integration}>
            <h2 className={styles.integrationTitle}>GitHub</h2>
            {github ? (
              <p>
                Connected as <strong>{(github.metadata as { login?: string })?.login ?? github.providerAccountId}</strong>
              </p>
            ) : (
              <p className={styles.muted}>Sign in with GitHub to connect.</p>
            )}
          </div>

          <div className={styles.integration}>
            <h2 className={styles.integrationTitle}>Vercel <span className={styles.tagBrand}>(recommended)</span></h2>
            <ConnectVercel connectedUsername={vercelUsername} />
          </div>

          <div className={styles.integration}>
            <h2 className={styles.integrationTitle}>Netlify</h2>
            <ConnectNetlify connectedEmail={netlifyEmail} />
          </div>

          <div className={styles.integration}>
            <h2 className={styles.integrationTitle}>Resend <span className={styles.tag}>(required for magic-link sign-in)</span></h2>
            <ConnectResend connectedAdminEmail={resendAdminEmail} />
          </div>

          {githubAppInstallUrl && (
            <div className={styles.integration}>
              <h2 className={styles.integrationTitle}>Stagecraft GitHub App</h2>
              <p className={styles.cardText}>
                Installing the Stagecraft App on your GitHub account lets the platform
                manage repos without a per-site connection step. Select &ldquo;All repositories&rdquo;
                for the smoothest experience.
              </p>
              <a
                href={githubAppInstallUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.installLink}
              >
                Install Stagecraft App &rarr;
              </a>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
