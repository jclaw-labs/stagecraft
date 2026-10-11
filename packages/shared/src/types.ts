/** Every FailureCategory, for narrowing a stored `SiteJob.failureCategory`. */
export const FAILURE_CATEGORIES = [
  "github_api_error",
  "netlify_deploy_error",
  "vercel_github_app_missing",
  "validation_error",
  "timeout",
  "unknown",
] as const;

/** Failure categories for structured error taxonomy */
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** Every JobType, for narrowing a stored `SiteJob.type`. */
export const JOB_TYPES = ["create_site", "migrate_site", "upgrade_site"] as const;

/** Job types for the platform's async task system */
export type JobType = (typeof JOB_TYPES)[number];

/** Every JobStatus, for narrowing a stored `SiteJob.status`. */
export const JOB_STATUSES = ["queued", "running", "completed", "failed", "canceled"] as const;

/** Job status lifecycle */
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Type guard: returns true if `value` is a FailureCategory. */
export function isFailureCategory(value: string): value is FailureCategory {
  return (FAILURE_CATEGORIES as readonly string[]).includes(value);
}

/** Type guard: returns true if `value` is a JobType. */
export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

/** Type guard: returns true if `value` is a JobStatus. */
export function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUSES as readonly string[]).includes(value);
}

/** Integration provider identifiers stored in `IntegrationAccount.provider`. */
export const INTEGRATION_PROVIDERS = ["github", "netlify", "vercel", "resend"] as const;

/** Integration provider identifiers */
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/** Type guard: returns true if `value` is a valid IntegrationProvider. */
export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

/** Site status lifecycle */
export type SiteStatus =
  | "creating"
  | "active"
  | "error"
  | "deploy_failed"
  | "archived";

/** Deploy preview status */
export type PreviewStatus =
  | "queued"
  | "building"
  | "ready"
  | "failed";

/**
 * Why an `upgrade_site` job stopped without opening a pull request
 * (ADR-016 §4). Each one needs someone to act before a re-run can succeed.
 *
 * - `no_release`: no release of the musician-site package is on npm's
 *   `latest` that the platform can move a site onto.
 * - `reauth_required`: the owner's GitHub token is missing, stale, or lacks
 *   the `workflow` scope; they sign in again.
 * - `customized`: our code in the site's repo was changed; the site is
 *   handled by hand (`changedFiles` lists what changed).
 * - `baseline_mismatch`: the repo's history and the provisioning step record
 *   disagree on which commit was the template push; checked by hand.
 * - `drafts_pending`: the upgrade rewrites content that an open draft branch
 *   also changed; the artist publishes or discards those edits first.
 * - `unsupported_schema`: the target release reads a content schemaVersion
 *   the platform's upgrader chain can't produce yet.
 * - `upgrade_branch_changed`: someone pushed to the `stagecraft/upgrade`
 *   branch; a re-run would discard their commits.
 */
export const UPGRADE_SITE_BLOCKERS = [
  "no_release",
  "reauth_required",
  "customized",
  "baseline_mismatch",
  "drafts_pending",
  "unsupported_schema",
  "upgrade_branch_changed",
] as const;

/** Why an `upgrade_site` job opened no pull request. */
export type UpgradeSiteBlocker = (typeof UPGRADE_SITE_BLOCKERS)[number];

/** Type guard: returns true if `value` is an UpgradeSiteBlocker. */
export function isUpgradeSiteBlocker(value: unknown): value is UpgradeSiteBlocker {
  return typeof value === "string" && (UPGRADE_SITE_BLOCKERS as readonly string[]).includes(value);
}

/** Whether an `upgrade_site` run opened a new pull request or updated its open one. */
export type UpgradePullRequestAction = "opened" | "updated";

/**
 * What an `upgrade_site` job stores in `SiteJob.resultPayload`, next to its
 * step records: the pull request it opened or updated, that the site was
 * already on the target release, or why it stopped.
 */
export interface UpgradeSiteResultData {
  /** The `@jclaw-labs/musician-site` release the upgrade targets. */
  packageVersion?: string;
  pullRequest?: { number: number; url: string; action: UpgradePullRequestAction };
  /** True when the site already runs `packageVersion` or a later release: no pull request. */
  upToDate?: boolean;
  /** With `upToDate`: the release the site's package.json pins. */
  currentVersion?: string;
  blocker?: UpgradeSiteBlocker;
  /** `customized`: our files the artist changed, by path. */
  changedFiles?: string[];
  /** `drafts_pending`: the draft branches holding edits to rewritten files. */
  draftBranches?: string[];
}

/** Where a site's current package version was read from. */
export type SiteVersionSource = "package_json" | "stamp";

/** Who opened a pull request that moves a site onto a newer release. */
export type SiteUpdatePullRequestKind = "upgrade" | "dependabot";

/**
 * What `GET /api/sites/[siteId]/version` returns: the
 * `@jclaw-labs/musician-site` release a site is on, the latest one on npm,
 * and an open pull request that would update it (ADR-016 Consequences).
 */
export interface SiteVersionInfo {
  /**
   * The version or range the site's package.json pins the package at, or
   * the stamp's `packageVersion` when package.json doesn't name it. Null
   * for a full copy of the template (a site from before ADR-016).
   */
  current: string | null;
  source: SiteVersionSource | null;
  /** npm's `latest` release of the package, or null when it couldn't be read. */
  latest: string | null;
  /** Whether `latest` is newer than what the site may run; null when `latest` is unknown. */
  updateAvailable: boolean | null;
  pullRequest: { number: number; url: string; kind: SiteUpdatePullRequestKind } | null;
}
