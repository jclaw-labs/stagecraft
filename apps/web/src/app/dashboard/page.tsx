import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@stagecraft/db";
import Button from "@/components/Button";

import { isStagecraftAdmin } from "@/lib/admin-allowlist";
import { NukeAllSitesButton } from "./NukeAllSitesButton";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // First-time-setup gate: until the artist has connected Resend (and
  // verified an email through it), they can't usefully /create a site
  // — the artist site's magic-link sign-in needs a real Resend account.
  // /onboarding is the only path that doesn't redirect here.
  const resend = await prisma.integrationAccount.findUnique({
    where: {
      userId_provider: { userId: session.user.id, provider: "resend" },
    },
  });
  if (!resend) {
    redirect("/onboarding");
  }

  const sites = await prisma.site.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main style={{ maxWidth: "var(--max-width-wide)", margin: "var(--space-10) auto", fontFamily: "var(--font-body)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Dashboard</h1>
        <div>
          <a href="/settings" style={{ marginRight: "var(--space-4)" }}>Settings</a>
          <span style={{ marginRight: "var(--space-4)" }}>{session.user.name ?? session.user.email}</span>
          {/* next-auth signout endpoint — must use plain anchor, not next/link */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/auth/signout" style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>Sign out</a>
        </div>
      </header>

      <section style={{ marginTop: "var(--space-8)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Your Sites</h2>
          <Button href="/create" size="sm">+ Create site</Button>
        </div>
        {sites.length === 0 ? (
          <p>No sites yet. <a href="/create">Create your first musician website</a> to get started.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {sites.map((site: { id: string; name: string; status: string; productionUrl: string | null }) => (
              <li key={site.id} style={{
                padding: "var(--space-4)",
                border: `1px solid var(--color-border)`,
                borderRadius: "var(--radius-lg)",
                marginBottom: "var(--space-3)",
                opacity: site.status === "archived" ? 0.6 : 1,
              }}>
                <a href={`/sites/${site.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <strong>{site.name}</strong>
                  <span style={{ marginLeft: "var(--space-2)", color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>{site.status}</span>
                </a>
                {site.productionUrl && site.status !== "archived" && (
                  <div style={{ marginTop: "var(--space-1)" }}>
                    <a href={site.productionUrl} style={{ fontSize: "var(--font-size-sm)", color: "var(--color-brand)" }}>{site.productionUrl}</a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isStagecraftAdmin(session.user.email) && (
        <NukeAllSitesButton siteCount={sites.length} />
      )}
    </main>
  );
}
