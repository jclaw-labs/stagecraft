import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JobResult } from "../types";
import type { WorkerEvent } from "../worker";

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();

// The worker issues four kinds of updateMany; route each to its own mock so
// tests can assert on (and stub) them independently.
const mockReap = vi.fn(); //      where.lockedUntil: expired leases
const mockClaim = vi.fn(); //     where.status: queued
const mockHeartbeat = vi.fn(); // data is only { lockedUntil }
const mockFinish = vi.fn(); //    owned-run writes: complete / fail / requeue

type UpdateManyArgs = { where: Record<string, unknown>; data: Record<string, unknown> };

function routeUpdateMany(args: UpdateManyArgs) {
  if ("lockedUntil" in args.where) return mockReap(args);
  if (args.where.status === "queued") return mockClaim(args);
  const keys = Object.keys(args.data);
  if (keys.length === 1 && keys[0] === "lockedUntil") return mockHeartbeat(args);
  return mockFinish(args);
}

vi.mock("@stagecraft/db", () => ({
  prisma: {
    siteJob: {
      findFirst: mockFindFirst,
      update: mockUpdate,
      updateMany: mockUpdateMany,
    },
  },
}));

const { createWorker, reapExpiredLeases, LEASE_EXPIRED_MESSAGE } = await import("../worker");
const { JOB_LEASE_MS, LEASE_HEARTBEAT_MS, MAX_RETRY_ATTEMPTS, RETRY_BASE_DELAY_MS } = await import("../retry");

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    type: "create_site",
    siteId: "site-1",
    status: "queued",
    repairAttempts: 0,
    retryAttempts: 0,
    runAt: null,
    lockedUntil: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function resetMocks() {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockUpdateMany.mockImplementation(routeUpdateMany);
  mockReap.mockResolvedValue({ count: 0 });
  // Default: this runner wins the queued → running claim and still owns it.
  mockClaim.mockResolvedValue({ count: 1 });
  mockHeartbeat.mockResolvedValue({ count: 1 });
  mockFinish.mockResolvedValue({ count: 1 });
  mockUpdate.mockResolvedValue({});
}

/** The `where` every post-claim write must carry: still running, our startedAt. */
function ownedWhere() {
  const claimData = mockClaim.mock.calls[0][0].data as { startedAt: Date };
  return { id: "job-1", status: "running", startedAt: claimData.startedAt };
}

describe("createWorker", () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes a queued job through to completion", async () => {
    const job = makeJob();
    mockFindFirst.mockResolvedValueOnce(job);

    const handler = vi.fn().mockResolvedValue({ success: true, data: { url: "https://example.com" } });
    const worker = createWorker({ handlers: { create_site: handler } });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    // Claimed atomically: only flips the row if it is still queued and unchanged
    expect(mockClaim).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "job-1", status: "queued", retryAttempts: 0, repairAttempts: 0 }),
      data: expect.objectContaining({ status: "running", lockedUntil: expect.any(Date) }),
    });

    // Handler called with job context
    expect(handler).toHaveBeenCalledWith({ job });

    // Marked as completed with result, releasing the lease
    expect(mockFinish).toHaveBeenCalledWith({
      where: ownedWhere(),
      data: expect.objectContaining({
        status: "completed",
        resultPayload: { url: "https://example.com" },
        errorMessage: null,
        failureCategory: null,
        lockedUntil: null,
      }),
    });
  });

  it("marks job as failed with failureCategory when handler returns success: false", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob());

    const handler = vi.fn().mockResolvedValue({
      success: false,
      message: "Repo not found",
      failureCategory: "github_api_error",
    });
    const worker = createWorker({ handlers: { create_site: handler } });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    expect(mockFinish).toHaveBeenCalledWith({
      where: ownedWhere(),
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Repo not found",
        failureCategory: "github_api_error",
      }),
    });
  });

  it("re-queues for repair when shouldRepair=true and repairAttempts < limit", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob({ repairAttempts: 0 }));

    const handler = vi.fn().mockResolvedValue({
      success: false,
      message: "Schema invalid",
      failureCategory: "validation_error",
      shouldRepair: true,
    });
    const worker = createWorker({ handlers: { create_site: handler } });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    expect(mockFinish).toHaveBeenCalledWith({
      where: ownedWhere(),
      data: expect.objectContaining({
        status: "queued",
        startedAt: null,
        lockedUntil: null,
        repairAttempts: { increment: 1 },
        failureCategory: "validation_error",
      }),
    });
  });

  it("fails instead of repairing when repairAttempts has reached the limit", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob({ repairAttempts: 2 }));

    const handler = vi.fn().mockResolvedValue({
      success: false,
      message: "Schema still invalid",
      failureCategory: "validation_error",
      shouldRepair: true,
    });
    const worker = createWorker({ handlers: { create_site: handler } });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    expect(mockFinish).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "job-1", status: "running" }),
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Schema still invalid",
        failureCategory: "validation_error",
      }),
    });
  });

  it("fails job with unknown category for no registered handler", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob({ type: "deploy_config" }));

    const worker = createWorker({ handlers: {} });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "No handler registered for job type: deploy_config",
        failureCategory: "unknown",
      }),
    });
  });

  it("does nothing when no jobs are queued", async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const worker = createWorker({ handlers: {} });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it("does not start a second interval if already started", () => {
    const worker = createWorker({ handlers: {} });
    mockFindFirst.mockResolvedValue(null);

    worker.start();
    worker.start();
    worker.stop();
  });
});

describe("runNext", () => {
  beforeEach(resetMocks);

  it("returns idle when no jobs are queued", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const worker = createWorker({ handlers: {} });

    await expect(worker.runNext()).resolves.toBe("idle");
  });

  it("only looks for queued jobs whose backoff has passed", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const worker = createWorker({ handlers: {} });

    await worker.runNext();

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { status: "queued", OR: [{ runAt: null }, { runAt: { lte: expect.any(Date) } }] },
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns lost-claim and skips the handler when another runner claimed the job", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob());
    mockClaim.mockResolvedValueOnce({ count: 0 });
    const handler = vi.fn();
    const worker = createWorker({ handlers: { create_site: handler } });

    await expect(worker.runNext()).resolves.toBe("lost-claim");
    expect(handler).not.toHaveBeenCalled();
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it("claims with a lease of JOB_LEASE_MS from the claim time", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob());
    const worker = createWorker({ handlers: { create_site: vi.fn().mockResolvedValue({ success: true }) } });

    await worker.runNext();

    const { startedAt, lockedUntil } = mockClaim.mock.calls[0][0].data as { startedAt: Date; lockedUntil: Date };
    expect(lockedUntil.getTime() - startedAt.getTime()).toBe(JOB_LEASE_MS);
  });

  it("returns busy when a job is already in flight on this worker", async () => {
    let finish: (v: JobResult) => void = () => {};
    mockFindFirst.mockResolvedValueOnce(makeJob());
    const handler = vi.fn(() => new Promise<JobResult>((resolve) => { finish = resolve; }));
    const worker = createWorker({ handlers: { create_site: handler } });

    const first = worker.runNext();
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    await expect(worker.runNext()).resolves.toBe("busy");

    finish({ success: true });
    await expect(first).resolves.toBe("processed");
  });

  it("returns idle when the queue read throws", async () => {
    mockFindFirst.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const worker = createWorker({ handlers: {} });

    await expect(worker.runNext()).resolves.toBe("idle");
  });

  it("drops a late result when the lease was lost mid-run", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob());
    mockFinish.mockResolvedValueOnce({ count: 0 });
    const events: WorkerEvent[] = [];
    const worker = createWorker({
      handlers: { create_site: vi.fn().mockResolvedValue({ success: true }) },
      onEvent: (e) => events.push(e),
    });

    await expect(worker.runNext()).resolves.toBe("processed");

    const names = events.map((e) => e.event);
    expect(names).toContain("job.lease_lost");
    expect(names).not.toContain("job.completed");
  });
});

describe("lease heartbeat", () => {
  beforeEach(() => {
    resetMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews the lease while a long handler runs, and stops after it finishes", async () => {
    let finish: (v: JobResult) => void = () => {};
    mockFindFirst.mockResolvedValueOnce(makeJob());
    const handler = vi.fn(() => new Promise<JobResult>((resolve) => { finish = resolve; }));
    const worker = createWorker({ handlers: { create_site: handler } });

    const run = worker.runNext();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockHeartbeat).not.toHaveBeenCalled();

    // Run well past the original lease: it must keep being pushed forward.
    await vi.advanceTimersByTimeAsync(JOB_LEASE_MS * 2);
    const renewals = mockHeartbeat.mock.calls.length;
    expect(renewals).toBe((JOB_LEASE_MS * 2) / LEASE_HEARTBEAT_MS);
    const last = mockHeartbeat.mock.calls[renewals - 1][0] as UpdateManyArgs;
    expect(last.where).toEqual(ownedWhere());
    expect((last.data.lockedUntil as Date).getTime()).toBe(Date.now() + JOB_LEASE_MS);

    finish({ success: true });
    await expect(run).resolves.toBe("processed");

    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS * 3);
    expect(mockHeartbeat).toHaveBeenCalledTimes(renewals);
  });

  it("keeps running the handler when a renewal fails", async () => {
    let finish: (v: JobResult) => void = () => {};
    mockFindFirst.mockResolvedValueOnce(makeJob());
    mockHeartbeat.mockRejectedValueOnce(new Error("db blip"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn(() => new Promise<JobResult>((resolve) => { finish = resolve; }));
    const worker = createWorker({ handlers: { create_site: handler } });

    const run = worker.runNext();
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("worker.heartbeat_error"));

    finish({ success: true });
    await expect(run).resolves.toBe("processed");
    expect(mockFinish).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) })
    );
  });
});

describe("reaper", () => {
  beforeEach(resetMocks);

  it("returns expired leases with retries left to the queue, failing the rest", async () => {
    const now = new Date("2026-10-09T12:00:00Z");
    mockReap.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });

    await expect(reapExpiredLeases(now)).resolves.toEqual({ requeued: 2, failed: 1 });

    expect(mockReap).toHaveBeenNthCalledWith(1, {
      where: { status: "running", lockedUntil: { lt: now }, retryAttempts: { lt: MAX_RETRY_ATTEMPTS } },
      data: expect.objectContaining({
        status: "queued",
        lockedUntil: null,
        startedAt: null,
        retryAttempts: { increment: 1 },
        errorMessage: LEASE_EXPIRED_MESSAGE,
        failureCategory: "timeout",
      }),
    });
    expect(mockReap).toHaveBeenNthCalledWith(2, {
      where: { status: "running", lockedUntil: { lt: now }, retryAttempts: { gte: MAX_RETRY_ATTEMPTS } },
      data: expect.objectContaining({
        status: "failed",
        lockedUntil: null,
        errorMessage: LEASE_EXPIRED_MESSAGE,
        failureCategory: "timeout",
        completedAt: now,
      }),
    });
  });

  it("never matches rows without a lease (null lockedUntil)", async () => {
    await reapExpiredLeases(new Date());
    // `lt` never matches NULL in SQL, so legacy / synchronous create_site
    // rows are left alone. Guard against a filter that would include them.
    for (const [args] of mockReap.mock.calls) {
      expect((args as UpdateManyArgs).where.lockedUntil).toEqual({ lt: expect.any(Date) });
    }
  });

  it("runs at the start of every poll, before the queue read", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const worker = createWorker({ handlers: {} });

    await worker.runNext();

    expect(mockReap).toHaveBeenCalledTimes(2);
    expect(mockReap.mock.invocationCallOrder[0]).toBeLessThan(mockFindFirst.mock.invocationCallOrder[0]);
  });

  it("emits jobs.reaped only when something was reaped", async () => {
    const events: WorkerEvent[] = [];
    mockFindFirst.mockResolvedValue(null);
    const worker = createWorker({ handlers: {}, onEvent: (e) => events.push(e) });

    await worker.runNext();
    expect(events).toEqual([]);

    mockReap.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await worker.runNext();
    expect(events).toEqual([{ event: "jobs.reaped", requeued: 1, failed: 0 }]);
  });

  it("returns idle and leaves the queue alone when the reaper throws", async () => {
    mockReap.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const worker = createWorker({ handlers: {} });

    await expect(worker.runNext()).resolves.toBe("idle");
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

describe("retrying thrown errors", () => {
  beforeEach(resetMocks);

  it("re-queues a throwing job with backoff while retries remain", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
      mockFindFirst.mockResolvedValueOnce(makeJob({ retryAttempts: 0 }));
      const events: WorkerEvent[] = [];
      const handler = vi.fn().mockRejectedValue(new Error("Connection timeout"));
      const worker = createWorker({ handlers: { create_site: handler }, onEvent: (e) => events.push(e) });

      await expect(worker.runNext()).resolves.toBe("processed");

      const expectedRunAt = new Date(Date.now() + RETRY_BASE_DELAY_MS);
      expect(mockFinish).toHaveBeenCalledWith({
        where: ownedWhere(),
        data: expect.objectContaining({
          status: "queued",
          startedAt: null,
          lockedUntil: null,
          retryAttempts: { increment: 1 },
          runAt: expectedRunAt,
          errorMessage: "Connection timeout",
          failureCategory: "unknown",
        }),
      });
      expect(events.find((e) => e.event === "job.retrying")).toMatchObject({
        attempt: 1,
        runAt: expectedRunAt.toISOString(),
        error: "Connection timeout",
      });
      expect(events.map((e) => e.event)).not.toContain("job.failed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off longer on each subsequent retry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
      mockFindFirst.mockResolvedValueOnce(makeJob({ retryAttempts: 1 }));
      const handler = vi.fn().mockRejectedValue(new Error("boom"));
      const worker = createWorker({ handlers: { create_site: handler } });

      await worker.runNext();

      const data = mockFinish.mock.calls[0][0].data as { runAt: Date };
      expect(data.runAt.getTime() - Date.now()).toBe(RETRY_BASE_DELAY_MS * 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails with the last error once retries are exhausted", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob({ retryAttempts: MAX_RETRY_ATTEMPTS }));
    const events: WorkerEvent[] = [];
    const handler = vi.fn().mockRejectedValue(new Error("Still timing out"));
    const worker = createWorker({ handlers: { create_site: handler }, onEvent: (e) => events.push(e) });

    await expect(worker.runNext()).resolves.toBe("processed");

    expect(mockFinish).toHaveBeenCalledTimes(1);
    expect(mockFinish).toHaveBeenCalledWith({
      where: ownedWhere(),
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Still timing out",
        failureCategory: "unknown",
        lockedUntil: null,
      }),
    });
    expect(mockFinish.mock.calls[0][0].data).not.toHaveProperty("retryAttempts");
    expect(events.map((e) => e.event)).toContain("job.failed");
    expect(events.map((e) => e.event)).not.toContain("job.retrying");
  });

  it("does not report a retry when the lease was lost before the requeue", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob());
    mockFinish.mockResolvedValueOnce({ count: 0 });
    const events: WorkerEvent[] = [];
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const worker = createWorker({ handlers: { create_site: handler }, onEvent: (e) => events.push(e) });

    await worker.runNext();

    const names = events.map((e) => e.event);
    expect(names).toContain("job.lease_lost");
    expect(names).not.toContain("job.retrying");
  });

  it("uses 'Unknown error' when the handler throws a non-Error", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob({ retryAttempts: MAX_RETRY_ATTEMPTS }));
    const handler = vi.fn().mockRejectedValue("a string");
    const worker = createWorker({ handlers: { create_site: handler } });

    await worker.runNext();

    expect(mockFinish).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed", errorMessage: "Unknown error" }) })
    );
  });
});

describe("drain", () => {
  beforeEach(resetMocks);

  it("processes jobs until the queue is empty and returns the count", async () => {
    mockFindFirst
      .mockResolvedValueOnce(makeJob({ id: "job-1" }))
      .mockResolvedValueOnce(makeJob({ id: "job-2" }))
      .mockResolvedValueOnce(null);
    const handler = vi.fn().mockResolvedValue({ success: true });
    const worker = createWorker({ handlers: { create_site: handler } });

    await expect(worker.drain()).resolves.toBe(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("returns 0 when nothing is queued", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const worker = createWorker({ handlers: {} });

    await expect(worker.drain()).resolves.toBe(0);
  });

  it("stops at maxJobs", async () => {
    mockFindFirst.mockResolvedValue(makeJob());
    const handler = vi.fn().mockResolvedValue({ success: true });
    const worker = createWorker({ handlers: { create_site: handler } });

    await expect(worker.drain({ maxJobs: 3 })).resolves.toBe(3);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("does not start another job once the time budget is spent", async () => {
    vi.useFakeTimers();
    try {
      mockFindFirst.mockResolvedValue(makeJob());
      const handler = vi.fn(async () => {
        vi.advanceTimersByTime(30_000);
        return { success: true };
      });
      const worker = createWorker({ handlers: { create_site: handler } });

      // Job 1 starts at t=0 and ends at 30s; job 2 starts at 30s (< 50s
      // budget) and ends at 60s; no job 3.
      await expect(worker.drain()).resolves.toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not count a lost claim and keeps draining", async () => {
    mockFindFirst
      .mockResolvedValueOnce(makeJob({ id: "job-1" }))
      .mockResolvedValueOnce(makeJob({ id: "job-2" }))
      .mockResolvedValueOnce(null);
    mockClaim.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const handler = vi.fn().mockResolvedValue({ success: true });
    const worker = createWorker({ handlers: { create_site: handler } });

    await expect(worker.drain()).resolves.toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
