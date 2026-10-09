import { prisma } from "@stagecraft/db";
import type { Prisma } from "@stagecraft/db";
import { MAX_REPAIR_ATTEMPTS } from "./repair";
import type { JobHandler, JobResult } from "./types";

export type WorkerEventType =
  | "job.started"
  | "job.completed"
  | "job.failed"
  | "worker.started"
  | "worker.stopped";

export interface WorkerEvent {
  event: WorkerEventType;
  jobId?: string;
  jobType?: string;
  siteId?: string;
  durationMs?: number;
  error?: string;
}

interface WorkerOptions {
  handlers: Record<string, JobHandler>;
  pollIntervalMs?: number;
  /** Optional callback invoked after each structured event is logged. */
  onEvent?: (event: WorkerEvent) => void;
}

function emit(event: WorkerEvent, onEvent?: (e: WorkerEvent) => void): void {
  console.log(JSON.stringify({ ...event, ts: new Date().toISOString() }));
  onEvent?.(event);
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
      // Fetch next queued job, ordered by creation time
      const job = await prisma.siteJob.findFirst({
        where: { status: "queued" },
        orderBy: { createdAt: "asc" },
      });

      if (!job) return "idle";

      const handler = handlers[job.type];
      if (!handler) {
        await prisma.siteJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
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

      // Claim atomically: only flip queued → running if nobody else has.
      // Two runners (the in-process poller and the cron route, or two
      // concurrent cron invocations) can both see the same queued row.
      const claim = await prisma.siteJob.updateMany({
        where: { id: job.id, status: "queued" },
        data: { status: "running", startedAt: new Date() },
      });
      if (claim.count === 0) return "lost-claim";
      emit({ event: "job.started", jobId: job.id, jobType: job.type, siteId: job.siteId }, onEvent);

      const startMs = Date.now();
      let result: JobResult;
      try {
        result = await handler({ job });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const durationMs = Date.now() - startMs;
        await prisma.siteJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            errorMessage: message,
            failureCategory: "unknown",
            completedAt: new Date(),
          },
        });
        emit(
          { event: "job.failed", jobId: job.id, jobType: job.type, siteId: job.siteId, durationMs, error: message },
          onEvent
        );
        return "processed";
      }

      const durationMs = Date.now() - startMs;

      if (result.success) {
        await prisma.siteJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            resultPayload: (result.data ?? undefined) as Prisma.InputJsonValue | undefined,
            errorMessage: null,
            failureCategory: null,
            completedAt: new Date(),
          },
        });
        emit(
          { event: "job.completed", jobId: job.id, jobType: job.type, siteId: job.siteId, durationMs },
          onEvent
        );
      } else if (result.shouldRepair && job.repairAttempts < MAX_REPAIR_ATTEMPTS) {
        // Bounded repair: re-queue with incremented repair counter
        await prisma.siteJob.update({
          where: { id: job.id },
          data: {
            status: "queued",
            repairAttempts: { increment: 1 },
            errorMessage: result.message ?? null,
            failureCategory: result.failureCategory ?? null,
          },
        });
      } else {
        await prisma.siteJob.update({
          where: { id: job.id },
          data: {
            status: "failed",
            resultPayload: (result.data ?? undefined) as Prisma.InputJsonValue | undefined,
            errorMessage: result.message ?? null,
            failureCategory: result.failureCategory ?? null,
            completedAt: new Date(),
          },
        });
        emit(
          { event: "job.failed", jobId: job.id, jobType: job.type, siteId: job.siteId, durationMs, error: result.message },
          onEvent
        );
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
