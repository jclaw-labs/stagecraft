/** Failure categories for structured error taxonomy */
export type FailureCategory =
  | "github_api_error"
  | "netlify_deploy_error"
  | "vercel_github_app_missing"
  | "validation_error"
  | "ai_error"
  | "timeout"
  | "unknown";

/** Site blueprint types available for new site creation */
export type BlueprintType =
  | "solo-artist"
  | "band"
  | "composer-educator"
  | "epk-focused"
  | "tour-focused";

/** Blueprint option for display in selection UIs. */
export interface BlueprintOption {
  value: BlueprintType;
  label: string;
  description: string;
}

/** All available blueprints with display labels and descriptions. */
export const BLUEPRINT_OPTIONS: BlueprintOption[] = [
  { value: "solo-artist", label: "Solo Artist", description: "For solo musicians, singer-songwriters, and solo performers" },
  { value: "band", label: "Band / Ensemble", description: "For bands, ensembles, and musical groups" },
  { value: "composer-educator", label: "Composer / Educator", description: "For composers, music teachers, and academics" },
  { value: "epk-focused", label: "EPK / Press Kit", description: "Emphasis on press materials, bio, and booking info" },
  { value: "tour-focused", label: "Tour Focused", description: "Emphasis on tour dates, venues, and live performance" },
];

/** All valid blueprint type values, derived from BLUEPRINT_OPTIONS. */
export const BLUEPRINT_VALUES: BlueprintType[] = BLUEPRINT_OPTIONS.map((b) => b.value);

/** Type guard: returns true if `value` is a valid BlueprintType. */
export function isBlueprintType(value: string): value is BlueprintType {
  return (BLUEPRINT_VALUES as string[]).includes(value);
}

/** Job types for the platform's async task system */
export type JobType =
  | "create_site"
  | "edit_site"
  | "migrate_site"
  | "repair_site"
  | "deploy_config";

/** Job status lifecycle */
export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "awaiting_review"
  | "canceled";


/** Integration provider identifiers */
export type IntegrationProvider = "github" | "netlify";

/** Site status lifecycle */
export type SiteStatus =
  | "creating"
  | "active"
  | "error"
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
