import Button from "./Button";
import styles from "./SiteCard.module.css";

export interface SiteCardData {
  id: string;
  name: string;
  status: string;
  productionUrl?: string | null;
  /** "netlify" | "vercel" */
  deployTarget?: string | null;
  githubRepoName?: string | null;
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  active: { label: "Live", tone: styles.live },
  creating: { label: "Building", tone: styles.building },
  error: { label: "Needs attention", tone: styles.error },
  deploy_failed: { label: "Deploy failed", tone: styles.error },
  archived: { label: "Archived", tone: styles.archivedBadge },
};

const SUBTEXT: Record<string, string> = {
  creating: "Deploying first build…",
  error: "Last deploy errored",
  deploy_failed: "Last deploy failed",
  archived: "Archived",
};

const PRIMARY_LABEL: Record<string, string> = {
  active: "Manage",
  creating: "View progress",
  error: "Resolve",
  deploy_failed: "Resolve",
  archived: "Manage",
};

/**
 * One site in the dashboard grid: a generated preview banner, name +
 * colour-coded status, production URL or status line, provider chips,
 * and quick actions. Pure render (server component).
 */
export default function SiteCard({ site }: { site: SiteCardData }) {
  const status = STATUS_META[site.status] ?? { label: site.status, tone: styles.archivedBadge };
  const isArchived = site.status === "archived";
  const showUrl = site.status === "active" && Boolean(site.productionUrl);
  const detailHref = `/sites/${site.id}`;

  return (
    <article className={`${styles.card}${isArchived ? ` ${styles.archived}` : ""}`}>
      <div className={styles.thumb} style={{ background: thumbGradient(site.id) }}>
        <span className={styles.thumbWord}>{site.name}</span>
      </div>

      <div className={styles.body}>
        <div className={styles.row}>
          <a className={styles.name} href={detailHref}>{site.name}</a>
          <span className={`${styles.badge} ${status.tone}`}>
            <span className={styles.dot} aria-hidden="true" />
            {status.label}
          </span>
        </div>

        {showUrl ? (
          <a className={styles.url} href={site.productionUrl ?? "#"} target="_blank" rel="noreferrer">
            {prettyUrl(site.productionUrl ?? "")}
            <ExternalIcon />
          </a>
        ) : (
          <span className={styles.sub}>{SUBTEXT[site.status] ?? ""}</span>
        )}

        {(site.githubRepoName || site.deployTarget) && (
          <div className={styles.providers}>
            {site.githubRepoName ? (
              <span className={styles.chip}><GitHubIcon />{site.githubRepoName}</span>
            ) : null}
            {site.deployTarget ? (
              <span className={styles.chip}><HostIcon target={site.deployTarget} />{hostLabel(site.deployTarget)}</span>
            ) : null}
          </div>
        )}

        <div className={styles.actions}>
          <Button href={detailHref} variant="secondary" size="sm" className={styles.action}>
            {PRIMARY_LABEL[site.status] ?? "Manage"}
          </Button>
          {showUrl ? (
            <Button
              href={site.productionUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              size="sm"
              className={styles.action}
            >
              Visit
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** Deterministic gradient from the site id so each card reads as its own. */
function thumbGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const h2 = (h + 38) % 360;
  return `linear-gradient(135deg, hsl(${h} 52% 26%), hsl(${h2} 58% 44%))`;
}

function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function hostLabel(target: string): string {
  if (target === "netlify") return "Netlify";
  if (target === "vercel") return "Vercel";
  return target;
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 5h5v5" /><path d="M19 5l-8 8" /><path d="M19 13v6H5V5h6" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.3-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5 3.9-1.4 6.8-5.2 6.8-9.7C22 6.6 17.5 2 12 2Z" />
    </svg>
  );
}

function HostIcon({ target }: { target: string }) {
  if (target === "vercel") {
    return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 22 19H2 Z" /></svg>;
  }
  // netlify (and fallback): a simple diamond mark
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 3 19l9-4 9 4Z" /></svg>;
}
