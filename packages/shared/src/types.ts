/** Failure categories for structured error taxonomy */
export type FailureCategory =
  | "github_api_error"
  | "netlify_deploy_error"
  | "vercel_github_app_missing"
  | "validation_error"
  | "ai_error"
  | "timeout"
  | "unknown";

/** Job types for the platform's async task system */
export type JobType = "create_site" | "migrate_site";

/** Job status lifecycle */
export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "awaiting_review"
  | "canceled";

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

/** Asset upload status */
export type AssetUploadStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "committed"
  | "failed";

/** Deploy preview status */
export type PreviewStatus =
  | "queued"
  | "building"
  | "ready"
  | "failed";
