import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { afterMock, drainMock } = vi.hoisted(() => ({ afterMock: vi.fn(), drainMock: vi.fn() }));

vi.mock("next/server", () => ({ after: afterMock }));
vi.mock("@stagecraft/queue", () => ({ createWorker: () => ({ drain: drainMock }) }));
vi.mock("../jobs/create-site", () => ({ handleCreateSite: vi.fn() }));
vi.mock("../jobs/migrate-site", () => ({ handleMigrateSite: vi.fn() }));

const { drainAfterResponse } = await import("../jobs/worker");

const ORIGINAL = process.env.STAGECRAFT_INPROCESS_WORKER;

beforeEach(() => {
  vi.resetAllMocks();
  drainMock.mockResolvedValue(1);
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.STAGECRAFT_INPROCESS_WORKER;
  else process.env.STAGECRAFT_INPROCESS_WORKER = ORIGINAL;
});

describe("drainAfterResponse", () => {
  it("schedules a one-job drain after the response on in-process-worker hosts", async () => {
    delete process.env.STAGECRAFT_INPROCESS_WORKER;

    drainAfterResponse();

    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(drainMock).not.toHaveBeenCalled();
    await afterMock.mock.calls[0][0]();
    expect(drainMock).toHaveBeenCalledWith({ maxJobs: 1 });
  });

  it("does nothing on cron-drained hosts (STAGECRAFT_INPROCESS_WORKER=false)", () => {
    process.env.STAGECRAFT_INPROCESS_WORKER = "false";

    drainAfterResponse();

    expect(afterMock).not.toHaveBeenCalled();
  });

  it("logs instead of throwing when the drain fails", async () => {
    delete process.env.STAGECRAFT_INPROCESS_WORKER;
    drainMock.mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    drainAfterResponse();
    await expect(afterMock.mock.calls[0][0]()).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(expect.stringContaining("worker.after_drain_error"));
  });
});
