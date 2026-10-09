import { prisma } from "@stagecraft/db";
import type { Prisma } from "@stagecraft/db";
import type { JobStatus } from "@stagecraft/shared";

/**
 * Named, resumable steps for a job handler.
 *
 * A handler that talks to several external services (create a repo, push
 * files, create a hosting project, …) wraps each call in `runner.run(name,
 * fn)`. The runner records each step on the job's `resultPayload.steps` as
 * it starts and finishes, so when the run dies part way (thrown error,
 * expired lease) the next run of the same job returns the recorded results
 * of finished steps without calling them again and picks up at the first
 * unfinished one.
 *
 * A step's result must be plain JSON, and must never hold a secret: it is
 * stored on the job row and served to the site owner with the job.
 *
 * Every progress write is conditional on this run still owning the job
 * (status `running` with the `startedAt` its claim stamped). If the lease
 * was reaped or the job canceled, the write matches no row and the runner
 * throws LeaseLostError, so a run that lost its lease stops at the next
 * step boundary instead of racing the run that replaced it.
 */

export type StepState = "started" | "completed";

export interface StepRecord {
  state: StepState;
  /** Runs that have started this step, this one included. */
  attempts: number;
  /** When the first of those runs started it (ISO 8601). */
  startedAt?: string;
  /** What the step returned, once it completed. */
  result?: Prisma.JsonValue;
  completedAt?: string;
}

/** The `steps` map a step-run job keeps in `SiteJob.resultPayload`. */
export type StepProgress = Record<string, StepRecord>;

export interface StepContext {
  /**
   * True when an earlier run started this step and never recorded it
   * finished: its side effect may already have happened. Steps that create
   * something use this to look for the earlier result before creating again.
   */
  interrupted: boolean;
  /**
   * When the first attempt at this step started, if an earlier attempt
   * exists (null on a first attempt). "Interrupted" includes an attempt
   * that failed cleanly before creating anything, so a step that adopts an
   * existing resource by name checks it was created at or after this time:
   * one that predates the step belongs to someone else.
   */
  firstStartedAt: Date | null;
}

export interface StepRunner {
  /** Run `name` unless an earlier run completed it; return its result either way. */
  run<T extends Prisma.JsonValue>(name: string, fn: (ctx: StepContext) => Promise<T>): Promise<T>;
  /** Whether `name` has completed, in this run or an earlier one. */
  isCompleted(name: string): boolean;
  /** A copy of every step's record, e.g. to include in a JobResult's `data`. */
  progress(): StepProgress;
}

export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} is no longer owned by this run (lease expired or job canceled)`);
    this.name = "LeaseLostError";
  }
}

const RUNNING: JobStatus = "running";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStepRecord(value: unknown): value is StepRecord {
  return (
    isRecord(value) &&
    (value.state === "started" || value.state === "completed") &&
    typeof value.attempts === "number"
  );
}

/** Read the step records out of a job's `resultPayload`, dropping anything malformed. */
export function readStepProgress(resultPayload: unknown): StepProgress {
  const steps = isRecord(resultPayload) ? resultPayload.steps : undefined;
  if (!isRecord(steps)) return {};
  const progress: StepProgress = {};
  for (const [name, record] of Object.entries(steps)) {
    if (isStepRecord(record)) progress[name] = { ...record };
  }
  return progress;
}

/**
 * Build a step runner for the job with id `jobId`, which the calling worker
 * has claimed. Reads the job fresh so it sees the progress earlier runs
 * wrote and the `startedAt` of the current claim.
 */
export async function createStepRunner(jobId: string): Promise<StepRunner> {
  const row = await prisma.siteJob.findUnique({
    where: { id: jobId },
    select: { status: true, startedAt: true, resultPayload: true },
  });
  if (!row || row.status !== RUNNING || !row.startedAt) {
    throw new LeaseLostError(jobId);
  }

  const owned: Prisma.SiteJobWhereInput = { id: jobId, status: RUNNING, startedAt: row.startedAt };
  // Keep any other keys a handler stored next to `steps`.
  const base = isRecord(row.resultPayload) ? { ...row.resultPayload } : {};
  const steps = readStepProgress(row.resultPayload);

  async function persist(): Promise<void> {
    const res = await prisma.siteJob.updateMany({
      where: owned,
      data: { resultPayload: structuredClone({ ...base, steps }) as unknown as Prisma.InputJsonValue },
    });
    if (res.count === 0) throw new LeaseLostError(jobId);
  }

  return {
    async run<T extends Prisma.JsonValue>(name: string, fn: (ctx: StepContext) => Promise<T>): Promise<T> {
      const prior = steps[name];
      if (prior?.state === "completed") return (prior.result ?? null) as T;

      const startedAt = prior ? prior.startedAt : new Date().toISOString();
      steps[name] = {
        state: "started",
        attempts: (prior?.attempts ?? 0) + 1,
        ...(startedAt ? { startedAt } : {}),
      };
      await persist();

      const result = await fn({
        interrupted: prior !== undefined,
        firstStartedAt: prior?.startedAt ? new Date(prior.startedAt) : null,
      });

      steps[name] = {
        ...steps[name],
        state: "completed",
        result,
        completedAt: new Date().toISOString(),
      };
      await persist();
      return result;
    },
    isCompleted(name: string): boolean {
      return steps[name]?.state === "completed";
    },
    progress(): StepProgress {
      return structuredClone(steps);
    },
  };
}
