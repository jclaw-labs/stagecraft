import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@stagecraft/db";

import { STAGECRAFT_GITHUB_APP_INSTALL_URL } from "@/lib/install-url";
import { ConnectNetlify } from "./ConnectNetlify";
import { ConnectResend } from "./ConnectResend";
import { ConnectVercel } from "./ConnectVercel";

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

  const github = integrations.find((i: { provider: string }) => i.provider === "github");
  const netlify = integrations.find((i: { provider: string }) => i.provider === "netlify");
  const vercel = integrations.find((i: { provider: string }) => i.provider === "vercel");
  const resend = integrations.find((i: { provider: string }) => i.provider === "resend");
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
    <main style={{ maxWidth: "var(--max-width-wide)", margin: "var(--space-10) auto", fontFamily: "var(--font-body)", color: "var(--color-text)" }}>
      <h1>Settings</h1>
      <p><a href="/dashboard">&larr; Dashboard</a></p>

      {params.success && (
        <div style={{ padding: "var(--space-3)", background: "var(--color-success-bg)", color: "var(--color-success)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-4)" }}>
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
        <div style={{ padding: "var(--space-3)", background: "var(--color-error-bg)", color: "var(--color-error)", borderRadius: "var(--radius-sm)", marginBottom: "var(--space-4)" }}>
          Connection failed. Please try again.
        </div>
      )}

      <section style={{ marginTop: "var(--space-8)" }}>
        <h2>Integrations</h2>
        <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
          GitHub is required (the platform commits to your repo). For deploys, connect either Vercel or Netlify — Vercel is recommended for new sites because its API auto-resolves repo linking; Netlify needs manual GitHub-App setup per repo. Resend is required for magic-link sign-in on artist sites.
        </p>

        <div style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", marginBottom: "var(--space-4)" }}>
          <h3>GitHub</h3>
          {github ? (
            <p>
              Connected as <strong>{(github.metadata as { login?: string })?.login ?? github.providerAccountId}</strong>
            </p>
          ) : (
            <p style={{ color: "var(--color-text-muted)" }}>Sign in with GitHub to connect.</p>
          )}
        </div>

        <div style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", marginBottom: "var(--space-4)" }}>
          <h3>Vercel <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-brand)", fontWeight: "var(--font-weight-normal)" }}>(recommended)</span></h3>
          <ConnectVercel connectedUsername={vercelUsername} />
        </div>

        <div style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", marginBottom: "var(--space-4)" }}>
          <h3>Netlify</h3>
          <ConnectNetlify connectedEmail={netlifyEmail} />
        </div>

        <div style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" }}>
          <h3>Resend <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", fontWeight: "var(--font-weight-normal)" }}>(required for magic-link sign-in)</span></h3>
          <ConnectResend connectedAdminEmail={resendAdminEmail} />
        </div>

        {githubAppInstallUrl && (
          <div style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", marginTop: "var(--space-4)" }}>
            <h3>Stagecraft GitHub App</h3>
            <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)", marginTop: "var(--space-1)" }}>
              Installing the Stagecraft App on your GitHub account lets the platform
              manage repos without a per-site connection step. Select &ldquo;All repositories&rdquo;
              for the smoothest experience.
            </p>
            <a
              href={githubAppInstallUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: "var(--font-weight-semibold)", color: "var(--color-brand)" }}
            >
              Install Stagecraft App &rarr;
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
