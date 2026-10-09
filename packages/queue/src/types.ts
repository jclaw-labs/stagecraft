import type { SiteJob } from "@prisma/client";
import type { FailureCategory } from "@stagecraft/shared";

export interface JobContext {
  job: SiteJob;
}

export interface JobResult {
  success: boolean;
  message?: string;
  failureCategory?: FailureCategory;
  /** When true and repair attempts remain, worker will re-queue instead of failing */
  shouldRepair?: boolean;
  /**
   * When true on a failure and retries remain, the worker re-queues the job
   * with backoff, exactly as if the handler had thrown, but keeps `message`
   * and `failureCategory`. Ignored on success. A retry doesn't write `data`:
   * a step-run job's progress is already on the row. Out of retries, the
   * failure is handled as if the flag weren't set.
   */
  retryable?: boolean;
  data?: Record<string, unknown>;
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;
