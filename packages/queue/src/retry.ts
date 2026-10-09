/**
 * Lease and retry policy for the job worker.
 *
 * A worker that claims a job holds a lease on it (`SiteJob.lockedUntil`)
 * and renews it every LEASE_HEARTBEAT_MS while the handler runs. If the
 * worker dies or its runtime is frozen (a serverless invocation that
 * returned mid-job), the heartbeat stops, the lease lapses, and the next
 * poll from any worker returns the job to `queued`.
 *
 * Because the lease is renewed, its length does not have to exceed the
 * longest job — only the longest gap between heartbeats, with margin for
 * clock skew between workers and a slow database round-trip. Five minutes
 * against a one-minute heartbeat tolerates four missed renewals before a
 * live job is reaped, and bounds how long a dead worker's job sits idle.
 */
export const JOB_LEASE_MS = 5 * 60_000;

/** How often a running job's lease is renewed. Must be well below JOB_LEASE_MS. */
export const LEASE_HEARTBEAT_MS = 60_000;

/**
 * How many times a failed run — a handler that threw, or a job whose lease
 * expired — is retried before the job is failed for good. Two retries means
 * at most three runs. Kept low because handlers such as migrate_site have
 * external side effects (repo creation, deploys) and are not idempotent.
 * Independent of MAX_REPAIR_ATTEMPTS, which bounds `repairResult()` passes.
 */
export const MAX_RETRY_ATTEMPTS = 2;

/**
 * How many times a worker tries its terminal write (complete, fail or
 * re-queue) before giving up. A write lost to a connection blip would
 * otherwise leave the row `running` until the lease expires, and the reaper
 * would then re-run a job that already finished.
 */
export const FINISH_WRITE_ATTEMPTS = 3;

/** Delay before the second terminal-write attempt; doubles for the third. */
export const FINISH_RETRY_DELAY_MS = 1_000;

/** Delay before the first retry; doubles on each subsequent retry. */
export const RETRY_BASE_DELAY_MS = 30_000;

/** Upper bound on any single retry delay. */
export const RETRY_MAX_DELAY_MS = 10 * 60_000;

/**
 * Backoff before the next run of a job that has already been retried
 * `retryAttempts` times: 30s, 60s, 120s, … capped at RETRY_MAX_DELAY_MS.
 *
 * With MAX_RETRY_ATTEMPTS = 2 the worker only ever calls this with 0 or 1,
 * so only 30s and 60s are used. The input guard, the exponent clamp and the
 * RETRY_MAX_DELAY_MS cap are unreachable today; they keep the function
 * correct if the retry budget is raised.
 */
export function retryDelayMs(retryAttempts: number): number {
  const attempts = Number.isNaN(retryAttempts) ? 0 : Math.max(0, Math.floor(retryAttempts));
  // Cap the exponent so 2 ** n can't overflow to Infinity for absurd inputs.
  const exponent = Math.min(attempts, 30);
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
}
