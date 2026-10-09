import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JobResult } from "../types";

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();

vi.mock("@stagecraft/db", () => ({
  prisma: {
    siteJob: {
      findFirst: mockFindFirst,
      update: mockUpdate,
      updateMany: mockUpdateMany,
    },
  },
}));

const { createWorker } = await import("../worker");

function makeJob(overrides = {}) {
  return {
    id: "job-1",
    type: "create_site",
    status: "queued",
    repairAttempts: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("createWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default: this runner wins the queued → running claim.
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("processes a queued job through to completion", async () => {
    const job = makeJob();
    mockFindFirst.mockResolvedValueOnce(job);
    mockUpdate.mockResolvedValue({});

    const handler = vi.fn().mockResolvedValue({ success: true, data: { url: "https://example.com" } });
    const worker = createWorker({ handlers: { create_site: handler } });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    // Claimed atomically: only flips the row if it is still queued
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "job-1", status: "queued" },
      data: expect.objectContaining({ status: "running" }),
    });

    // Handler called with job context
    expect(handler).toHaveBeenCalledWith({ job });

    // Marked as completed with result
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "completed",
        resultPayload: { url: "https://example.com" },
        errorMessage: null,
        failureCategory: null,
      }),
    });
  });

  it("marks job as failed with failureCategory when handler returns success: false", async () => {
    const job = makeJob();
    mockFindFirst.mockResolvedValueOnce(job);
    mockUpdate.mockResolvedValue({});

    const handler = vi.fn().mockResolvedValue({
      success: false,
      message: "Repo not found",
      failureCategory: "github_api_error",
    });
    const worker = createWorker({ handlers: { create_site: handler } });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Repo not found",
        failureCategory: "github_api_error",
      }),
    });
  });

  it("marks job as failed with unknown category when handler throws", async () => {
    const job = makeJob();
    mockFindFirst.mockResolvedValueOnce(job);
    mockUpdate.mockResolvedValue({});

    const handler = vi.fn().mockRejectedValue(new Error("Connection timeout"));
    const worker = createWorker({ handlers: { create_site: handler } });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Connection timeout",
        failureCategory: "unknown",
      }),
    });
  });

  it("re-queues for repair when shouldRepair=true and repairAttempts < limit", async () => {
    const job = makeJob({ repairAttempts: 0 });
    mockFindFirst.mockResolvedValueOnce(job);
    mockUpdate.mockResolvedValue({});

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

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "queued",
        repairAttempts: { increment: 1 },
        failureCategory: "validation_error",
      }),
    });
  });

  it("fails instead of repairing when repairAttempts has reached the limit", async () => {
    const job = makeJob({ repairAttempts: 2 });
    mockFindFirst.mockResolvedValueOnce(job);
    mockUpdate.mockResolvedValue({});

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

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Schema still invalid",
        failureCategory: "validation_error",
      }),
    });
  });

  it("fails job with unknown category for no registered handler", async () => {
    const job = makeJob({ type: "deploy_config" });
    mockFindFirst.mockResolvedValueOnce(job);
    mockUpdate.mockResolvedValue({});

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockUpdate.mockResolvedValue({});
  });

  it("returns idle when no jobs are queued", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const worker = createWorker({ handlers: {} });

    await expect(worker.runNext()).resolves.toBe("idle");
  });

  it("returns lost-claim and skips the handler when another runner claimed the job", async () => {
    mockFindFirst.mockResolvedValueOnce(makeJob());
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });
    const handler = vi.fn();
    const worker = createWorker({ handlers: { create_site: handler } });

    await expect(worker.runNext()).resolves.toBe("lost-claim");
    expect(handler).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
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
});

describe("drain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockUpdate.mockResolvedValue({});
  });

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
    mockUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const handler = vi.fn().mockResolvedValue({ success: true });
    const worker = createWorker({ handlers: { create_site: handler } });

    await expect(worker.drain()).resolves.toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
