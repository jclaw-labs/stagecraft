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
export const JOB_TYPES = ["create_site", "migrate_site"] as const;

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
