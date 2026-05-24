import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@stagecraft/db";
import type { SiteStatus } from "@stagecraft/shared";
import Button from "@/components/Button";
import AppShell from "@/components/AppShell";
import SiteCard from "@/components/SiteCard";

import { isStagecraftAdmin } from "@/lib/admin-allowlist";
import { NukeAllSitesButton } from "./NukeAllSitesButton";
import styles from "./dashboard.module.css";

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

  const liveCount = sites.filter((s) => s.status === "active").length;
  const attentionCount = sites.filter(
    (s) => s.status === "error" || s.status === "deploy_failed",
  ).length;

  const isAdmin = isStagecraftAdmin(session.user.email);

  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }} current="sites">
      <div className={styles.container}>
        {sites.length === 0 ? (
          <section className={styles.empty}>
            <div className={styles.emptyInner}>
              <div className={styles.emptyArt} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 9h18" />
                  <path d="M12 13v4M10 15h4" />
                </svg>
              </div>
              <h1 className={styles.emptyTitle}>Let&rsquo;s build your first site</h1>
              <p className={styles.emptyText}>
                Stagecraft turns a few details into a polished, ready-to-publish
                musician website — pick a theme, add your music and shows, and go live.
              </p>
              <Button href="/create">New site</Button>
            </div>
          </section>
        ) : (
          <>
            <div className={styles.pageHead}>
              <div>
                <h1 className={styles.title}>Your sites</h1>
                <p className={styles.sub}>
                  {sites.length} {sites.length === 1 ? "site" : "sites"} · {liveCount} live
                </p>
              </div>
              <Button href="/create">New site</Button>
            </div>

            <div className={styles.stats}>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Total sites</div>
                <div className={styles.statValue}>{sites.length}</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Live</div>
                <div className={styles.statValue}>{liveCount}</div>
              </div>
              <div className={`${styles.stat}${attentionCount > 0 ? ` ${styles.statAlert}` : ""}`}>
                <div className={styles.statLabel}>Needs attention</div>
                <div className={styles.statValue}>{attentionCount}</div>
              </div>
            </div>

            <section className={styles.grid} aria-label="Sites">
              {sites.map((site) => (
                <SiteCard
                  key={site.id}
                  site={{
                    id: site.id,
                    name: site.name,
                    status: site.status as SiteStatus,
                    productionUrl: site.productionUrl,
                    deployTarget: site.deployTarget,
                    githubRepoName: site.githubRepoName,
                  }}
                />
              ))}
            </section>
          </>
        )}

        {isAdmin && (
          <div className={styles.adminZone}>
            <NukeAllSitesButton siteCount={sites.length} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
