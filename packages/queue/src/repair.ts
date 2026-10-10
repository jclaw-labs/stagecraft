import type { FailureCategory } from "@stagecraft/shared";
import type { JobResult } from "./types";

/**
 * Maximum number of automatic repair attempts before a job is permanently failed.
 * Handlers should signal repair intent via repairResult(); the worker enforces this
 * hard cap by comparing job.repairAttempts against MAX_REPAIR_ATTEMPTS.
 */
export const MAX_REPAIR_ATTEMPTS = 2;

/**
 * Returns a JobResult that signals the worker to re-queue this job for
 * a bounded self-repair attempt. The worker will increment repairAttempts
 * and only honour up to MAX_REPAIR_ATTEMPTS total repair cycles.
 *
 * Typical use: a handler detects a validation_error in content it generated
 * and wants one more pass before surfacing the failure to the user.
 *
 * @example
 * if (validationErrors.length > 0) {
 *   return repairResult("Schema validation failed", "validation_error");
 * }
 */
export function repairResult(
  message: string,
  failureCategory: FailureCategory = "validation_error"
): JobResult {
  return {
    success: false,
    message,
    failureCategory,
    shouldRepair: true,
  };
}
