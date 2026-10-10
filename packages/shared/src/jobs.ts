import {
  isFailureCategory,
  isJobStatus,
  isJobType,
  type FailureCategory,
  type JobStatus,
  type JobType,
} from "./types";

/** The `SiteJob` columns the database stores as plain strings. */
export interface StoredJobFields {
  type: string;
  status: string;
  failureCategory: string | null;
}

/** The same columns, narrowed to the values the code knows today. */
export interface KnownJobFields {
  /** Null for a type with no handler today, such as a retired `edit_site`. */
  type: JobType | null;
  /** Null for a status nothing writes today, such as a retired `awaiting_review`. */
  status: JobStatus | null;
  /** `"unknown"` for a retired category such as `ai_error`. */
  failureCategory: FailureCategory | null;
}

/**
 * Narrow a `SiteJob` row's string columns before handing it to a reader.
 *
 * The database doesn't constrain these columns, so rows written before a
 * value was retired keep that value: production can still hold April's
 * `edit_site` jobs, with `awaiting_review` statuses or `ai_error` failure
 * categories. An unrecognised type or status becomes null, which matches
 * none of the comparisons readers make. An unrecognised failure category
 * becomes `"unknown"`, so its summary is the generic one.
 */
export function narrowJobFields<T extends StoredJobFields>(
  row: T,
): Omit<T, keyof StoredJobFields> & KnownJobFields {
  const { failureCategory } = row;
  return {
    ...row,
    type: isJobType(row.type) ? row.type : null,
    status: isJobStatus(row.status) ? row.status : null,
    failureCategory:
      failureCategory === null ? null : isFailureCategory(failureCategory) ? failureCategory : "unknown",
  };
}
