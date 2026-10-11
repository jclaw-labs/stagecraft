"use client";

import { useEffect, useState } from "react";
import Button from "@/components/Button";
import {
  isUpgradeSiteBlocker,
  type KnownJobFields,
  type SiteVersionInfo,
  type UpgradeSiteResultData,
} from "@stagecraft/shared";

import { signInWithGitHubAgain } from "./actions";
import { upgradeJobSummary, UPGRADE_FILE_LIST_LIMIT, type UpgradeSummaryTone } from "./upgrade-summary";
import { versionSummary, type VersionSummaryTone } from "./version-summary";
import styles from "./site-detail.module.css";

const TONE_CLASS: Record<UpgradeSummaryTone, string | undefined> = {
  progress: styles.upgradeProgress,
  ok: styles.upgradeOk,
  warn: styles.upgradeWarn,
  error: styles.upgradeFailed,
};

const VERSION_TONE_CLASS: Record<VersionSummaryTone, string | undefined> = {
  behind: styles.upgradeWarn,
  current: styles.upgradeOk,
  unknown: undefined,
};

/** An upgrade_site job as `GET /api/sites/[siteId]` returns it. */
export interface UpgradeJob extends KnownJobFields {
  id: string;
  errorMessage?: string | null;
  resultPayload?: UpgradeSiteResultData | null;
  createdAt: string;
  completedAt?: string | null;
}

/**
 * The "Upgrade site" action on a live site's page (ADR-016 §4): shows the
 * release the site is on against the latest one, with any open update pull
 * request; queues an upgrade_site job, then shows how the latest one went:
 * the pull request it opened or updated, or why it stopped (sign in again,
 * changed files, drafts to publish).
 */
export default function UpgradePanel({
  siteId,
  job,
  onQueued,
}: {
  siteId: string;
  job: UpgradeJob | null;
  /** Called once a job is queued, so the page starts polling it. */
  onQueued: () => void;
}) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [version, setVersion] = useState<SiteVersionInfo | null>(null);
  const [versionError, setVersionError] = useState("");
  const [versionReauth, setVersionReauth] = useState(false);

  // Read again once an upgrade finishes: it may have opened a pull request.
  const finishedJobId = job?.status === "completed" || job?.status === "failed" ? job.id : null;
  useEffect(() => {
    let cancelled = false;
    async function fetchVersion() {
      try {
        const res = await fetch(`/api/sites/${siteId}/version`);
        const data = (await res.json()) as { version?: SiteVersionInfo; error?: string; reauthRequired?: boolean };
        if (cancelled) return;
        if (res.ok && data.version) {
          setVersion(data.version);
          setVersionError("");
          setVersionReauth(false);
        } else {
          setVersionError(data.error || "Couldn't read which version this site runs");
          setVersionReauth(data.reauthRequired === true);
        }
      } catch {
        if (!cancelled) {
          setVersionError("Couldn't read which version this site runs");
          setVersionReauth(false);
        }
      }
    }
    fetchVersion();
    return () => {
      cancelled = true;
    };
  }, [siteId, finishedJobId]);

  const versionLine = version ? versionSummary(version) : null;

  const summary = upgradeJobSummary(job);
  // The job's summary links the pull request it opened; don't link it twice.
  const versionPullRequest =
    versionLine?.pullRequest && versionLine.pullRequest.url !== summary?.pullRequestUrl ? versionLine.pullRequest : null;
  const result = job?.resultPayload ?? null;
  const blocker = isUpgradeSiteBlocker(result?.blocker) ? result.blocker : null;

  async function handleUpgrade() {
    setIsRequesting(true);
    setRequestError("");
    try {
      const res = await fetch(`/api/sites/${siteId}/upgrade`, { method: "POST" });
      if (res.ok) {
        onQueued();
      } else {
        const data = (await res.json()) as { error?: string };
        setRequestError(data.error || "Could not start the upgrade");
      }
    } catch {
      setRequestError("Could not start the upgrade");
    }
    setIsRequesting(false);
  }

  const changedFiles = result?.changedFiles ?? [];
  const draftBranches = result?.draftBranches ?? [];

  return (
    <section className={styles.panel} aria-labelledby="upgrade-heading">
      <div className={styles.panelHead}>
        <h2 id="upgrade-heading">Site upgrades</h2>
      </div>
      <div className={styles.panelBody}>
        <p className={styles.upgradeIntro}>
          Move this site onto the latest release of Stagecraft&rsquo;s site code. Stagecraft opens a pull request on
          your repository; nothing changes on your site until you merge it.
        </p>

        {versionLine && (
          <div className={`${styles.upgradeStatus} ${VERSION_TONE_CLASS[versionLine.tone] ?? ""}`} role="status">
            <p className={styles.upgradeStatusText}>{versionLine.text}</p>
            {versionPullRequest && (
              <Button href={versionPullRequest.url} target="_blank" rel="noopener noreferrer" size="sm" variant="secondary">
                {versionPullRequest.label}
              </Button>
            )}
          </div>
        )}
        {versionError && (
          <div className={styles.versionError} role="status">
            <p className={styles.versionErrorText}>
              {versionLine ? `${versionError}. The line above may be out of date.` : versionError}
            </p>
            {versionReauth && (
              <form action={signInWithGitHubAgain.bind(null, siteId)}>
                <Button type="submit" size="sm" variant="secondary">
                  Sign in with GitHub again
                </Button>
              </form>
            )}
          </div>
        )}

        {summary && (
          <div className={`${styles.upgradeStatus} ${TONE_CLASS[summary.tone] ?? ""}`} role="status">
            <p className={styles.upgradeStatusText}>{summary.text}</p>

            {summary.pullRequestUrl && (
              <Button href={summary.pullRequestUrl} target="_blank" rel="noopener noreferrer" size="sm" variant="secondary">
                Review the pull request
              </Button>
            )}

            {blocker === "reauth_required" && (
              <form action={signInWithGitHubAgain.bind(null, siteId)}>
                <Button type="submit" size="sm" variant="secondary">
                  Sign in with GitHub again
                </Button>
              </form>
            )}

            {blocker === "customized" && changedFiles.length > 0 && (
              <ul className={styles.upgradeFileList}>
                {changedFiles.slice(0, UPGRADE_FILE_LIST_LIMIT).map((path) => (
                  <li key={path}>{path}</li>
                ))}
                {changedFiles.length > UPGRADE_FILE_LIST_LIMIT && (
                  <li>and {changedFiles.length - UPGRADE_FILE_LIST_LIMIT} more</li>
                )}
              </ul>
            )}

            {blocker === "drafts_pending" && draftBranches.length > 0 && (
              <ul className={styles.upgradeFileList}>
                {draftBranches.map((branch) => (
                  <li key={branch}>{branch}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {requestError && <p className={styles.upgradeError}>{requestError}</p>}

        {/* Secondary once the page knows the job would find nothing to do; still
            enabled, since the platform's release can change before the click. */}
        <Button
          onClick={handleUpgrade}
          isDisabled={isRequesting || summary?.inFlight === true}
          variant={version && !version.updateAvailable ? "secondary" : "primary"}
        >
          {isRequesting || summary?.inFlight ? "Upgrading…" : "Upgrade site"}
        </Button>
      </div>
    </section>
  );
}
