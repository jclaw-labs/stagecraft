import { isUpgradeSiteBlocker, type JobStatus, type UpgradeSiteBlocker, type UpgradeSiteResultData } from "@stagecraft/shared";

/** Changed files listed on the page before the rest are counted. */
export const UPGRADE_FILE_LIST_LIMIT = 10;

/** How the latest upgrade's status line reads. */
export type UpgradeSummaryTone = "progress" | "ok" | "warn" | "error";

export interface UpgradeSummary {
  tone: UpgradeSummaryTone;
  text: string;
  /** The upgrade pull request, once one is open. */
  pullRequestUrl?: string;
  /** True while the job is queued or running: no second upgrade yet. */
  inFlight: boolean;
}

/** The fields of an upgrade_site job the summary reads. */
export interface UpgradeJobFields {
  status: JobStatus | null;
  errorMessage?: string | null;
  resultPayload?: UpgradeSiteResultData | null;
}

/** What the artist is told for each reason an upgrade stopped. */
export const UPGRADE_BLOCKER_TEXT: Record<UpgradeSiteBlocker, string> = {
  no_release: "There's no new release to upgrade to yet.",
  reauth_required:
    "Stagecraft needs you to sign in with GitHub again before it can open the upgrade pull request. Then run the upgrade again.",
  customized:
    "Some of the site's code was changed in its repository, so Stagecraft didn't open a pull request. This site needs upgrading by hand. Changed files:",
  baseline_mismatch:
    "Stagecraft couldn't tell which version of its code this site started from, so it didn't open a pull request. This site needs upgrading by hand.",
  drafts_pending:
    "This upgrade rewrites content that has unpublished edits in your site's editor. Publish or discard those edits, then run the upgrade again. Drafts with edits:",
  unsupported_schema:
    "This release needs a newer version of Stagecraft to upgrade your content. Try again later.",
  upgrade_branch_changed:
    "The upgrade pull request's branch (stagecraft/upgrade) has commits Stagecraft didn't make, such as a push or GitHub's \"Update branch\", so Stagecraft didn't replace them. Merge or close that pull request and delete the branch, then run the upgrade again.",
};

/**
 * The status line for a site's latest upgrade_site job, or null when it has
 * never been upgraded. Unknown statuses (a retired value) read as nothing.
 */
export function upgradeJobSummary(job: UpgradeJobFields | null): UpgradeSummary | null {
  if (!job) return null;
  const result = job.resultPayload ?? null;
  switch (job.status) {
    case "queued":
    case "running":
      return { tone: "progress", text: "Upgrading… Stagecraft is preparing the pull request.", inFlight: true };
    case "completed": {
      if (result?.pullRequest) {
        const { number, url, action } = result.pullRequest;
        const version = result.packageVersion ? ` to ${result.packageVersion}` : "";
        return {
          tone: "ok",
          text: `Upgrade pull request #${number}${version} ${action === "opened" ? "opened" : "updated"}. Review it, then merge it to finish the upgrade.`,
          pullRequestUrl: url,
          inFlight: false,
        };
      }
      if (result?.upToDate) {
        const current = result.currentVersion ?? result.packageVersion;
        const version = current ? ` (it's on ${current})` : "";
        return { tone: "ok", text: `Stagecraft has no newer release to upgrade this site to${version}.`, inFlight: false };
      }
      return { tone: "ok", text: "The last upgrade finished.", inFlight: false };
    }
    case "failed": {
      const blocker = isUpgradeSiteBlocker(result?.blocker) ? result.blocker : null;
      if (blocker) return { tone: "warn", text: UPGRADE_BLOCKER_TEXT[blocker], inFlight: false };
      return {
        tone: "error",
        text: `The last upgrade failed: ${job.errorMessage || "unknown error"}`,
        inFlight: false,
      };
    }
    default:
      return null;
  }
}
