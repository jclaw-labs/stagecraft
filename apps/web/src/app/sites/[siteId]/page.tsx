"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Button from "@/components/Button";
import Input from "@/components/Input";

type SiteStatus = "creating" | "active" | "error" | "deploy_failed" | "archived";
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

export default function SiteDetailPage() {
  const { siteId } = useParams<{ siteId: string }>();
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
      <main style={{ maxWidth: "var(--max-width-narrow)", margin: "2.5rem auto", fontFamily: "var(--font-body)" }}>
        <p>Loading...</p>
      </main>
    );
  }

  if (error || !site) {
    return (
      <main style={{ maxWidth: "var(--max-width-narrow)", margin: "2.5rem auto", fontFamily: "var(--font-body)" }}>
        <h1>Error</h1>
        <p>{error || "Site not found"}</p>
        <a href="/dashboard">&larr; Dashboard</a>
      </main>
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

  const statusBg = isCreating || isBuilding || isCheckingStatus
    ? "var(--color-warning-bg)"
    : isError || isDeployError
    ? "var(--color-error-bg)"
    : isArchived
    ? "var(--color-neutral-bg)"
    : "var(--color-success-bg)";

  return (
    <main style={{ maxWidth: "var(--max-width-narrow)", margin: "2.5rem auto", fontFamily: "var(--font-body)" }}>
      <p><a href="/dashboard">&larr; Dashboard</a></p>

      <h1>{site.name}</h1>

      <div style={{ padding: "0.75rem", background: statusBg, borderRadius: "var(--radius-sm)", marginBottom: "1rem" }}>
        {isCreating && latestJob?.type === "migrate_site" && "Migrating your site\u2026 Crawling pages and building your repo. This may take a minute."}
        {isCreating && latestJob?.type !== "migrate_site" && "Setting up your site\u2026 This may take a few minutes."}
        {site.status === "error" && `Something went wrong: ${latestJob?.errorMessage ?? "Unknown error"}`}
        {(isBuilding || isCheckingStatus) && "Building your site\u2026 1\u20133 minutes for the first deploy."}
        {isDeployError && `First deploy failed${deploy?.errorMessage ? `: ${deploy.errorMessage}` : "."} Check the deploy logs.`}
        {isReady && !needsRepoLink && "Your site is live!"}
        {isArchived && "This site is archived. The GitHub repo is read-only."}
        {(isCreating || isBuilding || isCheckingStatus) && (
          <div style={{ marginTop: "0.5rem" }}>
            <FirstDeployProgress
              state={isCreating ? "creating" : deploy?.state ?? "queued"}
              startedAt={deploy?.createdAt ?? latestJob?.createdAt ?? null}
            />
          </div>
        )}
      </div>

      {/* GitHub App publishing — connect / suspended states */}
      {!isArchived && !site.githubInstallationId && (
        <div style={{
          padding: "1rem",
          background: "var(--color-info-bg)",
          border: `1px solid var(--color-info-border)`,
          borderRadius: "var(--radius-sm)",
          marginBottom: "1rem",
        }}>
          <strong>Connect your GitHub App for publishing</strong>
          <p style={{ margin: "0.5rem 0 0.75rem", fontSize: "var(--font-size-sm)", color: "var(--color-text-faint)" }}>
            Install the Stagecraft GitHub App on this site&rsquo;s repo so the editor can publish edits as commits. You&rsquo;ll see your broker secret once after install &mdash; copy it to your site&rsquo;s deployment env vars.
          </p>
          <Button onClick={handleConnectGithubApp} isDisabled={isConnecting} size="sm">
            {isConnecting ? "Starting install…" : "Connect GitHub App"}
          </Button>
        </div>
      )}

      {site.githubInstallationId && site.githubAppSuspended && (
        <div style={{
          padding: "1rem",
          background: "var(--color-warning-bg)",
          border: `1px solid var(--color-warning-border)`,
          borderRadius: "var(--radius-sm)",
          marginBottom: "1rem",
        }}>
          <strong>GitHub App is suspended</strong>
          <p style={{ margin: "0.5rem 0 0", fontSize: "var(--font-size-sm)", color: "var(--color-text-faint)" }}>
            Publishing is paused until the App is unsuspended on GitHub.
          </p>
        </div>
      )}

      {needsRepoLink && netlifyLinkRepoUrl && (
        <div style={{
          padding: "1rem",
          background: "var(--color-info-bg)",
          border: `1px solid var(--color-info-border)`,
          borderRadius: "var(--radius-sm)",
          marginBottom: "1rem",
        }}>
          <strong>Next step: connect your GitHub repo to Netlify</strong>
          <p style={{ margin: "0.5rem 0 0.75rem", fontSize: "var(--font-size-sm)", color: "var(--color-text-faint)" }}>
            Your GitHub repo and Netlify site are created. Link them to enable auto-deploys on push.
          </p>
          <Button href={netlifyLinkRepoUrl} target="_blank" rel="noopener noreferrer" size="sm">
            Connect repo in Netlify &rarr;
          </Button>
        </div>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Details</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ padding: "0.5rem", fontWeight: "var(--font-weight-semibold)" }}>Status</td>
              <td style={{ padding: "0.5rem" }}>{site.status}</td>
            </tr>
            {githubUrl && (
              <tr>
                <td style={{ padding: "0.5rem", fontWeight: "var(--font-weight-semibold)" }}>GitHub</td>
                <td style={{ padding: "0.5rem" }}>
                  <a href={githubUrl} target="_blank" rel="noopener noreferrer">{githubUrl}</a>
                </td>
              </tr>
            )}
            <tr>
              <td style={{ padding: "0.5rem", fontWeight: "var(--font-weight-semibold)" }}>GitHub App</td>
              <td style={{ padding: "0.5rem" }}>
                {site.githubInstallationId
                  ? site.githubAppSuspended
                    ? <span style={{ color: "var(--color-warning)" }}>installed (suspended)</span>
                    : <span style={{ color: "var(--color-success)" }}>installed</span>
                  : <span style={{ color: "var(--color-text-muted)" }}>not connected</span>}
              </td>
            </tr>
            {site.netlifyAdminUrl && (
              <tr>
                <td style={{ padding: "0.5rem", fontWeight: "var(--font-weight-semibold)" }}>Netlify</td>
                <td style={{ padding: "0.5rem" }}>
                  <a href={site.netlifyAdminUrl} target="_blank" rel="noopener noreferrer">Site settings</a>
                </td>
              </tr>
            )}
            {site.vercelProjectName && (
              <tr>
                <td style={{ padding: "0.5rem", fontWeight: "var(--font-weight-semibold)" }}>Vercel</td>
                <td style={{ padding: "0.5rem" }}>
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
                </td>
              </tr>
            )}
            {site.productionUrl && (
              <tr>
                <td style={{ padding: "0.5rem", fontWeight: "var(--font-weight-semibold)" }}>Production URL</td>
                <td style={{ padding: "0.5rem" }}>
                  {/* Show the URL as a plain link both when confirmed live (isReady)
                      and during the pre-fetch window (isCheckingStatus) — the
                      muted "(available once the first build finishes)" treatment
                      only applies when we have a firm "still building" signal. */}
                  {isReady || isCheckingStatus ? (
                    <a href={site.productionUrl} target="_blank" rel="noopener noreferrer">{site.productionUrl}</a>
                  ) : (
                    <span style={{ color: "var(--color-text-faint)" }}>
                      {site.productionUrl} <em>(available once the first build finishes)</em>
                    </span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {migrationReport && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Migration Report</h2>

          <ul style={{ paddingLeft: "1.25rem", margin: "0 0 1rem" }}>
            {migrationReport.summary.map((line, i) => (
              <li key={i} style={{ fontSize: "var(--font-size-sm)", marginBottom: "0.25rem" }}>{line}</li>
            ))}
          </ul>

          <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
            Overall import confidence: <strong>{Math.round(migrationReport.overallConfidence * 100)}%</strong>
            {" "}&mdash; higher means more content was accurately mapped.
          </p>

          {migrationReport.importedItems.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "var(--font-size-sm)", marginBottom: "0.5rem", color: "var(--color-success)" }}>
                Imported
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {migrationReport.importedItems.map((item, i) => (
                  <li key={i} style={{ padding: "0.5rem", border: `1px solid var(--color-border)`, borderRadius: "var(--radius-sm)", marginBottom: "0.375rem" }}>
                    <strong style={{ fontSize: "var(--font-size-sm)" }}>{item.label}</strong>
                    <p style={{ margin: "0.125rem 0 0", fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>{item.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {migrationReport.manualReviewItems.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "var(--font-size-sm)", marginBottom: "0.5rem", color: "var(--color-warning)" }}>
                Needs your attention
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {migrationReport.manualReviewItems.map((item, i) => (
                  <li key={i} style={{ padding: "0.5rem", border: `1px solid var(--color-border)`, borderRadius: "var(--radius-sm)", marginBottom: "0.375rem" }}>
                    <strong style={{ fontSize: "var(--font-size-sm)" }}>{item.label}</strong>
                    <p style={{ margin: "0.125rem 0 0", fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>{item.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {migrationReport.skippedItems.length > 0 && (
            <div>
              <h3 style={{ fontSize: "var(--font-size-sm)", marginBottom: "0.5rem", color: "var(--color-text-muted)" }}>
                Not imported
              </h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {migrationReport.skippedItems.map((item, i) => (
                  <li key={i} style={{ padding: "0.5rem", border: `1px solid var(--color-border)`, borderRadius: "var(--radius-sm)", marginBottom: "0.375rem" }}>
                    <strong style={{ fontSize: "var(--font-size-sm)" }}>{item.label}</strong>
                    <p style={{ margin: "0.125rem 0 0", fontSize: "var(--font-size-xs)", color: "var(--color-text-faint)" }}>{item.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {(site.status === "active" || isArchived) && (
        <section style={{ marginTop: "2rem" }}>
          <Button
            variant={isArchived ? "primary" : "muted"}
            onClick={handleArchiveToggle}
            isDisabled={isArchiving}
          >
            {isArchiving
              ? (isArchived ? "Unarchiving..." : "Archiving...")
              : (isArchived ? "Unarchive Site" : "Archive Site")}
          </Button>
          {!isArchived && (
            <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", marginTop: "0.375rem" }}>
              Archiving makes the GitHub repo read-only. You can unarchive later.
            </p>
          )}
        </section>
      )}

      <section style={{ marginTop: "3rem", borderTop: `1px solid var(--color-border)`, paddingTop: "1.5rem" }}>
        <h2 style={{ color: "var(--color-error)" }}>Danger Zone</h2>
        <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
          Permanently delete this site, its GitHub repository, and its {site.deployTarget === "vercel" ? "Vercel" : "Netlify"} {site.deployTarget === "vercel" ? "project" : "deployment"}. This cannot be undone.
        </p>
        <div style={{ maxWidth: "18.75rem" }}>
          <Input
            id="delete-confirm"
            label={`Type "${site.name}" to confirm:`}
            value={deleteConfirmName}
            onChange={setDeleteConfirmName}
            placeholder={site.name}
          />
        </div>
        <div style={{ marginTop: "0.5rem" }}>
          <Button
            variant="danger"
            onClick={handleDelete}
            isDisabled={isDeleting || deleteConfirmName !== site.name}
          >
            {isDeleting ? "Deleting..." : "Permanently Delete Site"}
          </Button>
        </div>
      </section>
    </main>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <div
        aria-hidden
        style={{
          width: "100%",
          height: "0.375rem",
          background: "var(--color-surface-raised)",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--color-brand)",
            borderRadius: "var(--radius-sm)",
            // Smooth visual transition across stage jumps (e.g.
            // building 45% → finalizing 90%). 800ms feels distinct
            // without dragging.
            transition: "width 800ms ease",
          }}
        />
      </div>
      <div
        role="status"
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-muted)",
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
        }}
      >
        <Spinner />
        <strong style={{ fontWeight: "var(--font-weight-semibold)", color: "var(--color-text)" }}>
          {stageLabel(state)}
        </strong>
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
        border: "2px solid var(--color-text-muted)",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "stagecraftSpin 0.8s linear infinite",
        verticalAlign: "middle",
        marginRight: "0.25em",
      }}
    />
  );
}
