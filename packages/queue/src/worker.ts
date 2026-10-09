import { prisma } from "@stagecraft/db";
import type { Prisma } from "@stagecraft/db";
import type { JobStatus } from "@stagecraft/shared";
import { MAX_REPAIR_ATTEMPTS } from "./repair";
import { JOB_LEASE_MS, LEASE_HEARTBEAT_MS, MAX_RETRY_ATTEMPTS, retryDelayMs } from "./retry";
import type { JobHandler, JobResult } from "./types";

export type WorkerEventType =
  | "job.started"
  | "job.completed"
  | "job.failed"
  | "job.retrying" //   handler threw; re-queued with backoff
  | "job.lease_lost" // the run was reaped (or canceled) while this worker held it
  | "jobs.reaped" //    expired leases were returned to the queue or failed
  | "worker.started"
  | "worker.stopped";

export interface WorkerEvent {
  event: WorkerEventType;
  jobId?: string;
  jobType?: string;
  siteId?: string;
  durationMs?: number;
  error?: string;
  /** job.retrying: the retry about to run (1-based). */
  attempt?: number;
  /** job.retrying: when the retry becomes eligible to run (ISO 8601). */
  runAt?: string;
  /** jobs.reaped: rows returned to `queued`. */
  requeued?: number;
  /** jobs.reaped: rows failed because they were out of retries. */
  failed?: number;
}

interface WorkerOptions {
  handlers: Record<string, JobHandler>;
  pollIntervalMs?: number;
  /** Optional callback invoked after each structured event is logged. */
  onEvent?: (event: WorkerEvent) => void;
}

const QUEUED: JobStatus = "queued";
const RUNNING: JobStatus = "running";
const COMPLETED: JobStatus = "completed";
const FAILED: JobStatus = "failed";

export const LEASE_EXPIRED_MESSAGE = "Lease expired: the worker stopped before the job finished";

function emit(event: WorkerEvent, onEvent?: (e: WorkerEvent) => void): void {
  console.log(JSON.stringify({ ...event, ts: new Date().toISOString() }));
  onEvent?.(event);
}

/** A queued job is claimable once its retry backoff (if any) has passed. */
function dueFilter(now: Date): Prisma.SiteJobWhereInput {
  return { OR: [{ runAt: null }, { runAt: { lte: now } }] };
}

/**
 * Return `running` jobs whose lease has lapsed to the queue, or fail them
 * when they are out of retries. Runs at the start of every poll.
 *
 * Each step is a single conditional UPDATE, so concurrent reapers can't
 * double-process a row: once one flips it out of `running`, the other's
 * WHERE no longer matches. Rows with a null `lockedUntil` (claimed by a
 * worker that predates leases, or `create_site` rows the sites API runs
 * synchronously) are never touched.
 */
export async function reapExpiredLeases(now: Date = new Date()): Promise<{ requeued: number; failed: number }> {
  const expired = { status: RUNNING, lockedUntil: { lt: now } };
  const requeued = await prisma.siteJob.updateMany({
    where: { ...expired, retryAttempts: { lt: MAX_RETRY_ATTEMPTS } },
    data: {
      status: QUEUED,
      lockedUntil: null,
      startedAt: null,
      runAt: now,
      retryAttempts: { increment: 1 },
      errorMessage: LEASE_EXPIRED_MESSAGE,
      failureCategory: "timeout",
    },
  });
  const failed = await prisma.siteJob.updateMany({
    where: { ...expired, retryAttempts: { gte: MAX_RETRY_ATTEMPTS } },
    data: {
      status: FAILED,
      lockedUntil: null,
      errorMessage: LEASE_EXPIRED_MESSAGE,
      failureCategory: "timeout",
      completedAt: now,
    },
  });
  return { requeued: requeued.count, failed: failed.count };
}

/** Outcome of one `runNext()` call. */
export type RunNextOutcome =
  | "processed" // claimed a job and drove it to its next state
  | "idle" //      no queued jobs (or the queue read failed)
  | "lost-claim" // another runner claimed the job first
  | "busy"; //     this worker is already mid-job (interval tick overlapped)

export interface DrainOptions {
  /** Stop after this many jobs. Default 10. */
  maxJobs?: number;
  /**
   * Don't start another job once this much wall time has elapsed. A job
   * already in flight is allowed to finish. Default 50s, which keeps a
   * drain inside a typical 60s serverless / cron invocation.
   */
  timeBudgetMs?: number;
}

export function createWorker(options: WorkerOptions) {
  const { handlers, pollIntervalMs = 5000, onEvent } = options;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runNext(): Promise<RunNextOutcome> {
    if (running) return "busy";
    running = true;

    try {
      const reaped = await reapExpiredLeases();
      if (reaped.requeued > 0 || reaped.failed > 0) {
        emit({ event: "jobs.reaped", ...reaped }, onEvent);
      }

      // Fetch the oldest queued job whose retry backoff has passed.
      const job = await prisma.siteJob.findFirst({
        where: { status: QUEUED, ...dueFilter(new Date()) },
        orderBy: { createdAt: "asc" },
      });

      if (!job) return "idle";

      const handler = handlers[job.type];
      if (!handler) {
        await prisma.siteJob.update({
          where: { id: job.id },
          data: {
            status: FAILED,
            errorMessage: `No handler registered for job type: ${job.type}`,
            failureCategory: "unknown",
            completedAt: new Date(),
          },
        });
        emit(
          { event: "job.failed", jobId: job.id, jobType: job.type, siteId: job.siteId, error: "No handler" },
          onEvent
        );
        return "processed";
      }

      // Claim atomically: only flip queued → running if the row is still
      // what we read. Two runners (the in-process poller and the cron
      // route, or two concurrent cron invocations) can both see the same
      // queued row; the conditional UPDATE lets exactly one win. Matching
      // the attempt counters too means a row that was claimed, failed and
      // re-queued since our read is never run against stale counters.
      const claimedAt = new Date();
      const claim = await prisma.siteJob.updateMany({
        where: {
          id: job.id,
          status: QUEUED,
          retryAttempts: job.retryAttempts,
          repairAttempts: job.repairAttempts,
          ...dueFilter(claimedAt),
        },
        data: {
          status: RUNNING,
          startedAt: claimedAt,
          lockedUntil: new Date(claimedAt.getTime() + JOB_LEASE_MS),
          runAt: null,
        },
      });
      if (claim.count === 0) return "lost-claim";
      emit({ event: "job.started", jobId: job.id, jobType: job.type, siteId: job.siteId }, onEvent);

      // Every write after the claim is conditional on this worker still
      // owning the run: still `running` with the startedAt we stamped. If
      // the lease was reaped (and maybe re-claimed elsewhere) or an
      // operator canceled the job, our late result is dropped instead of
      // clobbering the newer state.
      const owned: Prisma.SiteJobWhereInput = { id: job.id, status: RUNNING, startedAt: claimedAt };
      const jobRef = { jobId: job.id, jobType: job.type, siteId: job.siteId };

      async function finish(data: Prisma.SiteJobUpdateManyMutationInput): Promise<boolean> {
        const res = await prisma.siteJob.updateMany({ where: owned, data: { ...data, lockedUntil: null } });
        if (res.count === 0) {
          emit({ event: "job.lease_lost", ...jobRef }, onEvent);
          return false;
        }
        return true;
      }

      // Shared re-queue path for repair passes and thrown-error retries.
      function requeue(data: Prisma.SiteJobUpdateManyMutationInput): Promise<boolean> {
        return finish({ status: QUEUED, startedAt: null, ...data });
      }

      // Renew the lease while the handler runs so a long job is never
      // reaped out from under a live worker.
      const heartbeat = setInterval(() => {
        prisma.siteJob
          .updateMany({ where: owned, data: { lockedUntil: new Date(Date.now() + JOB_LEASE_MS) } })
          .catch((error: unknown) => {
            console.error(
              JSON.stringify({
                event: "worker.heartbeat_error",
                jobId: job.id,
                error: String(error),
                ts: new Date().toISOString(),
              })
            );
          });
      }, LEASE_HEARTBEAT_MS);
      // Never keep a process alive just to renew a lease.
      heartbeat.unref?.();

      const startMs = Date.now();
      let result: JobResult;
      try {
        result = await handler({ job });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const durationMs = Date.now() - startMs;
        if (job.retryAttempts < MAX_RETRY_ATTEMPTS) {
          const runAt = new Date(Date.now() + retryDelayMs(job.retryAttempts));
          const requeued = await requeue({
            retryAttempts: { increment: 1 },
            runAt,
            errorMessage: message,
            failureCategory: "unknown",
          });
          if (requeued) {
            emit(
              {
                event: "job.retrying",
                ...jobRef,
                durationMs,
                error: message,
                attempt: job.retryAttempts + 1,
                runAt: runAt.toISOString(),
              },
              onEvent
            );
          }
          return "processed";
        }
        const failed = await finish({
          status: FAILED,
          errorMessage: message,
          failureCategory: "unknown",
          completedAt: new Date(),
        });
        if (failed) emit({ event: "job.failed", ...jobRef, durationMs, error: message }, onEvent);
        return "processed";
      } finally {
        clearInterval(heartbeat);
      }

      const durationMs = Date.now() - startMs;

      if (result.success) {
        const completed = await finish({
          status: COMPLETED,
          resultPayload: (result.data ?? undefined) as Prisma.InputJsonValue | undefined,
          errorMessage: null,
          failureCategory: null,
          completedAt: new Date(),
        });
        if (completed) emit({ event: "job.completed", ...jobRef, durationMs }, onEvent);
      } else if (result.shouldRepair && job.repairAttempts < MAX_REPAIR_ATTEMPTS) {
        // Bounded repair: re-queue with incremented repair counter
        await requeue({
          repairAttempts: { increment: 1 },
          errorMessage: result.message ?? null,
          failureCategory: result.failureCategory ?? null,
        });
      } else {
        const failed = await finish({
          status: FAILED,
          resultPayload: (result.data ?? undefined) as Prisma.InputJsonValue | undefined,
          errorMessage: result.message ?? null,
          failureCategory: result.failureCategory ?? null,
          completedAt: new Date(),
        });
        if (failed) emit({ event: "job.failed", ...jobRef, durationMs, error: result.message }, onEvent);
      }
      return "processed";
    } catch (error) {
      console.error(
        JSON.stringify({ event: "worker.poll_error", error: String(error), ts: new Date().toISOString() })
      );
      return "idle";
    } finally {
      running = false;
    }
  }

  async function poll() {
    await runNext();
  }

  return {
    runNext,
    /**
     * Process queued jobs back to back until the queue is empty or a limit
     * is hit, then return how many were processed. For runtimes with no
     * long-lived process (a cron-triggered route or scheduled function),
     * where `start()`'s interval would never fire.
     */
    async drain({ maxJobs = 10, timeBudgetMs = 50_000 }: DrainOptions = {}): Promise<number> {
      const startedAt = Date.now();
      let processed = 0;
      while (processed < maxJobs && Date.now() - startedAt < timeBudgetMs) {
        const outcome = await runNext();
        if (outcome === "lost-claim") continue;
        if (outcome !== "processed") break;
        processed++;
      }
      return processed;
    },
    start() {
      if (timer) return;
      emit({ event: "worker.started" }, onEvent);
      timer = setInterval(poll, pollIntervalMs);
      // Run immediately on start
      poll();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        emit({ event: "worker.stopped" }, onEvent);
      }
    },
  };
}
