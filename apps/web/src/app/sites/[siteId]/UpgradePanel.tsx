"use client";

import { useState } from "react";
import Button from "@/components/Button";
import {
  isUpgradeSiteBlocker,
  type KnownJobFields,
  type UpgradeSiteResultData,
} from "@stagecraft/shared";

import { signInWithGitHubAgain } from "./actions";
import { upgradeJobSummary, UPGRADE_FILE_LIST_LIMIT, type UpgradeSummaryTone } from "./upgrade-summary";
import styles from "./site-detail.module.css";

const TONE_CLASS: Record<UpgradeSummaryTone, string | undefined> = {
  progress: styles.upgradeProgress,
  ok: styles.upgradeOk,
  warn: styles.upgradeWarn,
  error: styles.upgradeFailed,
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
 * The "Upgrade site" action on a live site's page (ADR-016 §4): queues an
 * upgrade_site job, then shows how the latest one went: the pull request it
 * opened or updated, or why it stopped (sign in again, changed files, drafts
 * to publish).
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

  const summary = upgradeJobSummary(job);
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

        <Button onClick={handleUpgrade} isDisabled={isRequesting || summary?.inFlight === true}>
          {isRequesting || summary?.inFlight ? "Upgrading…" : "Upgrade site"}
        </Button>
      </div>
    </section>
  );
}
