"use client";

import { useEffect, useState } from "react";
import Button from "@/components/Button";
import Input from "@/components/Input";
import StatusBadge, { type BadgeTone } from "@/components/StatusBadge";
import type { SiteStatus } from "@stagecraft/shared";

import styles from "./site-detail.module.css";

type JobType = "create_site" | "edit_site" | "migrate_site" | "repair_site" | "deploy_config";
type JobStatus = "queued" | "running" | "completed" | "failed" | "awaiting_review" | "canceled";

interface MigrationReportItem {
  label: string;
  status: "imported" | "partial" | "skipped" | "manual_review";
  detail: string;
}

interface MigrationReport {
  summary: string[];
  overallConfidence: number;
  importedItems: MigrationReportItem[];
  manualReviewItems: MigrationReportItem[];
  skippedItems: MigrationReportItem[];
  pagesCrawled: number;
  pagesMapped: number;
  imagesFound: number;
  embedsFound: number;
  socialLinksFound: number;
}

interface MigrateJobResult {
  sourceUrl?: string;
  pagesCrawled?: number;
  pagesMapped?: number;
  overallConfidence?: number;
  report?: MigrationReport;
}

interface SiteJob {
  id: string;
  type: JobType;
  status: JobStatus;
  errorMessage?: string;
  resultPayload?: MigrateJobResult;
  createdAt: string;
  completedAt?: string;
}

interface Site {
  id: string;
  name: string;
  slug: string;
  status: SiteStatus;
  blueprintType: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  githubInstallationId?: number | null;
  githubAppSuspended?: boolean;
  /** "netlify" | "vercel" — which provider hosts this site. */
  deployTarget?: string;
  netlifySiteId?: string;
  netlifyAdminUrl?: string;
  vercelProjectId?: string;
  vercelProjectName?: string;
  vercelTeamId?: string;
  vercelTeamSlug?: string;
  productionUrl?: string;
  archivedAt?: string;
  jobs: SiteJob[];
}

type DeployState =
  | "queued"
  | "initializing"
  | "building"
  | "finalizing"
  | "ready"
  | "error"
  | "unknown";

interface DeployStatus {
  id: string | null;
  state: DeployState;
  url: string | null;
  errorMessage?: string | null;
  createdAt: string | null;
}

export default function SiteDetailClient({ siteId }: { siteId: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [deploy, setDeploy] = useState<DeployStatus | null>(null);
  const [deployFetched, setDeployFetched] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    let active = true;

    async function fetchSite() {
      try {
        const res = await fetch(`/api/sites/${siteId}`);
        if (!res.ok) {
          setError("Site not found");
          setIsLoading(false);
          return;
        }
        const data = await res.json();
        if (active) {
          setSite(data.site);
          setIsLoading(false);
        }
      } catch {
        if (active) {
          setError("Failed to load site");
          setIsLoading(false);
        }
      }
    }

    fetchSite();

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/sites/${siteId}`);
        if (res.ok) {
          const data = await res.json();
          if (active) {
            setSite(data.site);
            if (data.site.status !== "creating") {
              clearInterval(interval);
            }
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [siteId]);

  // Poll the deploy target (Vercel/Netlify) for first-build status. Runs
  // only once Site.status flips to "active" (the deploy project exists)
  // and stops once the build is "ready" or "error" — after that the URL
  // either works or the artist has actionable info.
  useEffect(() => {
    if (!site || site.status !== "active") return;
    if (deploy?.state === "ready" || deploy?.state === "error") return;

    let active = true;
    async function fetchDeploy() {
      try {
        const res = await fetch(`/api/sites/${siteId}/deploy-status`);
        if (!res.ok) return;
        const data = (await res.json()) as { deploy?: DeployStatus };
        if (active && data.deploy) {
          setDeploy(data.deploy);
          setDeployFetched(true);
        }
      } catch {
        // Transient errors don't block the UI; the next tick retries.
      }
    }
    fetchDeploy();
    const id = setInterval(fetchDeploy, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [siteId, site, deploy?.state]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <p>Loading…</p>
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className={styles.centered}>
        <h1>Something went wrong</h1>
        <p>{error || "Site not found"}</p>
        <a href="/dashboard">&larr; Back to sites</a>
      </div>
    );
  }

  async function handleArchiveToggle() {
    const action = site!.status === "archived" ? "unarchive" : "archive";
    if (action === "archive" && !confirm(`Archive "${site!.name}"? The GitHub repo will become read-only.`)) return;
    setIsArchiving(true);
    try {
      const res = await fetch(`/api/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setSite((prev) => prev ? { ...prev, status: data.site.status, archivedAt: action === "archive" ? new Date().toISOString() : undefined } : prev);
      } else {
        const data = await res.json();
        setError(data.error || `Failed to ${action} site`);
      }
    } catch {
      setError(`Failed to ${action} site`);
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleConnectGithubApp() {
    setIsConnecting(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/install-url`);
      const data = (await res.json()) as { url?: string; connected?: boolean; error?: string };
      if (res.ok && data.connected) {
        window.location.reload();
        return;
      }
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error || "Could not start install flow");
    } catch {
      setError("Could not start install flow");
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDelete() {
    if (deleteConfirmName !== site!.name) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/sites/${siteId}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        if (data.errors?.length) {
          alert(`Site deleted, but some cleanup failed:\n${data.errors.join("\n")}`);
        }
        window.location.href = "/dashboard";
      } else {
        setError(data.error || "Failed to delete site");
        setIsDeleting(false);
      }
    } catch {
      setError("Failed to delete site");
      setIsDeleting(false);
    }
  }

  const latestJob = site.jobs[0];
  const isCreating = site.status === "creating";
  const isError = site.status === "error" || site.status === "deploy_failed";
  const isArchived = site.status === "archived";
  const isActive = site.status === "active";

  const migrationJob = site.jobs.find((j) => j.type === "migrate_site" && j.status === "completed");
  const migrationReport = migrationJob?.resultPayload?.report ?? null;
  const githubUrl = site.githubRepoOwner && site.githubRepoName
    ? `https://github.com/${site.githubRepoOwner}/${site.githubRepoName}`
    : null;
  const needsRepoLink = site.status === "active" && site.netlifyAdminUrl && !site.productionUrl;
  const netlifyLinkRepoUrl = site.netlifyAdminUrl
    ? `${site.netlifyAdminUrl}/configuration/deploys#content`
    : null;

  // Treat the first-build state the same as platform-side "creating":
  // until the deploy target says "ready", the production URL won't
  // render anything useful and the success banner would be misleading.
  //
  // Pre-fetch window: we land on /sites/[id], render once, then ~3s later
  // the first deploy-status poll returns. Treat that window as "building"
  // (rather than a transient "Checking…" label) — the most likely truth
  // for a freshly-active site, and consistent with the in-flight states
  // (queued / initializing / building / finalizing).
  const isCheckingStatus = isActive && !deployFetched;
  const isBuilding = isActive && deployFetched && deploy && IN_FLIGHT_STATES.has(deploy.state);
  const isDeployError = isActive && deployFetched && deploy?.state === "error";
  const isReady = isActive && deployFetched && deploy?.state === "ready";

  const statusTone = isCreating || isBuilding || isCheckingStatus
    ? styles.toneBuilding
    : isError || isDeployError
    ? styles.toneError
    : isArchived
    ? styles.toneNeutral
    : styles.toneOk;

  const badge: { tone: BadgeTone; label: string } =
    isCreating || isBuilding || isCheckingStatus || needsRepoLink
      ? { tone: "building", label: needsRepoLink ? "Setup" : "Building" }
      : isError || isDeployError
      ? { tone: "error", label: isError ? "Error" : "Deploy failed" }
      : isArchived
      ? { tone: "neutral", label: "Archived" }
      : { tone: "live", label: "Live" };

  return (
    <div className={styles.container}>
      <a className={styles.breadcrumb} href="/dashboard">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        Sites
      </a>

      <div className={styles.head}>
        <div>
          <div className={styles.titleRow}>
            <h1 className={styles.name}>{site.name}</h1>
            <StatusBadge tone={badge.tone} label={badge.label} />
          </div>
          {site.productionUrl && (isReady || isCheckingStatus) && (
            <a className={styles.url} href={site.productionUrl} target="_blank" rel="noopener noreferrer">
              {site.productionUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 5h5v5" /><path d="M19 5l-8 8" /><path d="M19 13v6H5V5h6" /></svg>
            </a>
          )}
        </div>
        {site.productionUrl && (isReady || isCheckingStatus) && (
          <div className={styles.headActions}>
            <Button href={site.productionUrl} target="_blank" rel="noopener noreferrer">Visit site</Button>
          </div>
        )}
      </div>

      <div className={styles.stack}>
        <div className={`${styles.statusPanel} ${statusTone}`}>
          <span className={styles.statusMsg}>
            {isCreating && latestJob?.type === "migrate_site" && "Migrating your site\u2026 Crawling pages and building your repo. This may take a minute."}
            {isCreating && latestJob?.type !== "migrate_site" && "Setting up your site\u2026 This may take a few minutes."}
            {site.status === "error" && `Something went wrong: ${latestJob?.errorMessage ?? "Unknown error"}`}
            {(isBuilding || isCheckingStatus) && "Building your site\u2026 1\u20133 minutes for the first deploy."}
            {isDeployError && `First deploy failed${deploy?.errorMessage ? `: ${deploy.errorMessage}` : "."} Check the deploy logs.`}
            {isReady && !needsRepoLink && "Your site is live!"}
            {isArchived && "This site is archived. The GitHub repo is read-only."}
          </span>
          {(isCreating || isBuilding || isCheckingStatus) && (
            <FirstDeployProgress
              state={isCreating ? "creating" : deploy?.state ?? "queued"}
              startedAt={deploy?.createdAt ?? latestJob?.createdAt ?? null}
            />
          )}
        </div>

        {!isArchived && !site.githubInstallationId && (
          <div className={`${styles.notice} ${styles.noticeInfo}`}>
            <strong className={styles.noticeTitle}>Connect your GitHub App for publishing</strong>
            <p className={styles.noticeText}>
              Install the Stagecraft GitHub App on this site&rsquo;s repo so the editor can publish edits as commits. You&rsquo;ll see your broker secret once after install &mdash; copy it to your site&rsquo;s deployment env vars.
            </p>
            <Button onClick={handleConnectGithubApp} isDisabled={isConnecting} size="sm">
              {isConnecting ? "Starting install…" : "Connect GitHub App"}
            </Button>
          </div>
        )}

        {site.githubInstallationId && site.githubAppSuspended && (
          <div className={`${styles.notice} ${styles.noticeWarn}`}>
            <strong className={styles.noticeTitle}>GitHub App is suspended</strong>
            <p className={styles.noticeText}>
              Publishing is paused until the App is unsuspended on GitHub.
            </p>
          </div>
        )}

        {needsRepoLink && netlifyLinkRepoUrl && (
          <div className={`${styles.notice} ${styles.noticeInfo}`}>
            <strong className={styles.noticeTitle}>Next step: connect your GitHub repo to Netlify</strong>
            <p className={styles.noticeText}>
              Your GitHub repo and Netlify site are created. Link them to enable auto-deploys on push.
            </p>
            <Button href={netlifyLinkRepoUrl} target="_blank" rel="noopener noreferrer" size="sm">
              Connect repo in Netlify &rarr;
            </Button>
          </div>
        )}

        <section className={styles.panel}>
          <div className={styles.panelHead}><h2>Details &amp; connections</h2></div>
          <div className={styles.panelBody}>
            <div className={styles.kv}>
              <div className={styles.kvRow}>
                <span className={styles.kvKey}>Status</span>
                <span className={styles.kvVal}>{site.status}</span>
              </div>
              {githubUrl && (
                <div className={styles.kvRow}>
                  <span className={styles.kvKey}>Repository</span>
                  <span className={styles.kvVal}>
                    <a href={githubUrl} target="_blank" rel="noopener noreferrer">{site.githubRepoOwner}/{site.githubRepoName}</a>
                  </span>
                </div>
              )}
              <div className={styles.kvRow}>
                <span className={styles.kvKey}>GitHub App</span>
                <span className={styles.kvVal}>
                  {site.githubInstallationId
                    ? site.githubAppSuspended
                      ? <span className={styles.warn}>installed (suspended)</span>
                      : <span className={styles.ok}>installed</span>
                    : <span className={styles.muted}>not connected</span>}
                </span>
              </div>
              {site.netlifyAdminUrl && (
                <div className={styles.kvRow}>
                  <span className={styles.kvKey}>Netlify</span>
                  <span className={styles.kvVal}>
                    <a href={site.netlifyAdminUrl} target="_blank" rel="noopener noreferrer">Site settings</a>
                  </span>
                </div>
              )}
              {site.vercelProjectName && (
                <div className={styles.kvRow}>
                  <span className={styles.kvKey}>Vercel</span>
                  <span className={styles.kvVal}>
                    <a
                      href={
                        site.vercelTeamSlug
                          ? `https://vercel.com/${site.vercelTeamSlug}/${site.vercelProjectName}`
                          : `https://vercel.com/${site.vercelProjectName}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Project settings
                    </a>
                  </span>
                </div>
              )}
              {site.productionUrl && (
                <div className={styles.kvRow}>
                  <span className={styles.kvKey}>Production URL</span>
                  <span className={styles.kvVal}>
                    {/* Plain link when live (isReady) or during the pre-fetch
                        window (isCheckingStatus); muted "(available once…)" only
                        on a firm "still building" signal. */}
                    {isReady || isCheckingStatus ? (
                      <a href={site.productionUrl} target="_blank" rel="noopener noreferrer">{site.productionUrl}</a>
                    ) : (
                      <span className={styles.muted}>
                        {site.productionUrl} <em>(available once the first build finishes)</em>
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>

        {migrationReport && (
          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>Migration report</h2></div>
            <div className={styles.panelBody}>
              <ul className={styles.reportList}>
                {migrationReport.summary.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>

              <p className={styles.dangerText}>
                Overall import confidence: <strong>{Math.round(migrationReport.overallConfidence * 100)}%</strong>
                {" "}&mdash; higher means more content was accurately mapped.
              </p>

              {migrationReport.importedItems.length > 0 && (
                <div className={styles.reportGroup}>
                  <h3 className={`${styles.reportGroupTitle} ${styles.ok}`}>Imported</h3>
                  <ul className={styles.reportItems}>
                    {migrationReport.importedItems.map((item, i) => (
                      <li key={i} className={styles.reportItem}>
                        <strong>{item.label}</strong>
                        <p>{item.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {migrationReport.manualReviewItems.length > 0 && (
                <div className={styles.reportGroup}>
                  <h3 className={`${styles.reportGroupTitle} ${styles.warn}`}>Needs your attention</h3>
                  <ul className={styles.reportItems}>
                    {migrationReport.manualReviewItems.map((item, i) => (
                      <li key={i} className={styles.reportItem}>
                        <strong>{item.label}</strong>
                        <p>{item.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {migrationReport.skippedItems.length > 0 && (
                <div className={styles.reportGroup}>
                  <h3 className={`${styles.reportGroupTitle} ${styles.muted}`}>Not imported</h3>
                  <ul className={styles.reportItems}>
                    {migrationReport.skippedItems.map((item, i) => (
                      <li key={i} className={styles.reportItem}>
                        <strong>{item.label}</strong>
                        <p>{item.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {(site.status === "active" || isArchived) && (
          <section className={styles.panel}>
            <div className={styles.panelBody}>
              <Button
                variant={isArchived ? "primary" : "secondary"}
                onClick={handleArchiveToggle}
                isDisabled={isArchiving}
              >
                {isArchiving
                  ? (isArchived ? "Unarchiving…" : "Archiving…")
                  : (isArchived ? "Unarchive site" : "Archive site")}
              </Button>
              {!isArchived && (
                <p className={styles.dangerText} style={{ margin: "var(--space-3) 0 0" }}>
                  Archiving makes the GitHub repo read-only. You can unarchive later.
                </p>
              )}
            </div>
          </section>
        )}

        <section className={`${styles.panel} ${styles.panelDanger}`}>
          <div className={styles.panelHead}><h2>Danger zone</h2></div>
          <div className={styles.panelBody}>
            <p className={styles.dangerText}>
              Permanently delete this site, its GitHub repository, and its {site.deployTarget === "vercel" ? "Vercel" : "Netlify"} {site.deployTarget === "vercel" ? "project" : "deployment"}. This cannot be undone.
            </p>
            <div className={styles.dangerConfirm}>
              <Input
                id="delete-confirm"
                label={`Type "${site.name}" to confirm:`}
                value={deleteConfirmName}
                onChange={setDeleteConfirmName}
                placeholder={site.name}
              />
            </div>
            <div className={styles.dangerActions}>
              <Button
                variant="danger"
                onClick={handleDelete}
                isDisabled={isDeleting || deleteConfirmName !== site.name}
              >
                {isDeleting ? "Deleting…" : "Permanently delete site"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// Deploy phases that count as "in flight" — anything that should render
// the progress bar rather than the final-state banner. Used both for
// gating the banner branches and (indirectly) for choosing the bar
// percentage. Module-scope so the component below and the page-level
// gate share one source of truth.
const IN_FLIGHT_STATES = new Set<DeployState>([
  "queued",
  "initializing",
  "building",
  "finalizing",
]);

/**
 * Where the progress bar sits for each phase. Reaching a stage means
 * roughly that fraction of typical work is done — calibrated from a
 * handful of observed builds, not from a real signal (neither Vercel
 * nor Netlify expose a percentage). The bar asymptotes at 95% via the
 * `finalizing` stage; only `ready` would push it to 100%, but at that
 * point we render the success banner instead.
 *
 * `creating` is the platform's own work (createRepo, pushFiles, env
 * vars, kick off first build); it precedes any provider state. Roughly
 * 10s on average, which is why its baseline is small.
 */
const STAGE_PROGRESS: Record<DeployState | "creating", number> = {
  creating: 0.05,
  queued: 0.15,
  initializing: 0.25,
  building: 0.45,
  finalizing: 0.90,
  ready: 1.0,
  error: 0,
  unknown: 0.10,
};

/**
 * User-visible label for each stage. Per intentional design we
 * collapse `queued` and `initializing` into "Building" — the
 * distinction between "waiting in queue" vs "VM spinning up" vs
 * "build command running" isn't useful to the artist, and those two
 * stages are usually <10s each. "Finalizing" gets its own label
 * because it means almost-done (upload + alias swap + post-deploy
 * plugins).
 */
function stageLabel(state: DeployState | "creating"): string {
  switch (state) {
    case "creating":
      return "Preparing";
    case "queued":
    case "initializing":
    case "building":
      return "Building";
    case "finalizing":
      return "Finalizing";
    case "ready":
      return "Live";
    case "error":
      return "Failed";
    default:
      return "Working";
  }
}

function useElapsed(startedAt: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return null;
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return null;
  const seconds = Math.max(0, Math.floor((now - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function FirstDeployProgress({
  state,
  startedAt,
}: {
  state: DeployState | "creating";
  startedAt: string | null;
}) {
  const pct = (STAGE_PROGRESS[state] ?? 0.1) * 100;
  const elapsed = useElapsed(startedAt);

  return (
    <div className={styles.progress}>
      <div className={styles.progressTrack} aria-hidden>
        {/* Width is data-driven (stage %); smooth across stage jumps via the
            class transition. */}
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.progressLabel} role="status">
        <Spinner />
        <strong>{stageLabel(state)}</strong>
        {elapsed ? <span>· {elapsed}</span> : null}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "0.75em",
        height: "0.75em",
        border: "var(--border-width-thick) solid var(--color-text-muted)",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "stagecraftSpin 0.8s linear infinite",
        verticalAlign: "middle",
        marginRight: "0.25em",
      }}
    />
  );
}
