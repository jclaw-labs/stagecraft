import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { afterMock, drainMock, createWorkerMock, handleUpgradeSiteMock } = vi.hoisted(() => ({
  afterMock: vi.fn(),
  drainMock: vi.fn(),
  createWorkerMock: vi.fn(),
  handleUpgradeSiteMock: vi.fn(),
}));

vi.mock("next/server", () => ({ after: afterMock }));
vi.mock("@stagecraft/queue", () => ({
  createWorker: (options: unknown) => {
    createWorkerMock(options);
    return { drain: drainMock };
  },
}));
vi.mock("../jobs/create-site", () => ({ handleCreateSite: vi.fn() }));
vi.mock("../jobs/migrate-site", () => ({ handleMigrateSite: vi.fn() }));
vi.mock("../jobs/upgrade-site", () => ({ handleUpgradeSite: handleUpgradeSiteMock }));

const { drainAfterResponse, getWorker } = await import("../jobs/worker");

const ORIGINAL = process.env.STAGECRAFT_INPROCESS_WORKER;

beforeEach(() => {
  vi.resetAllMocks();
  drainMock.mockResolvedValue(1);
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.STAGECRAFT_INPROCESS_WORKER;
  else process.env.STAGECRAFT_INPROCESS_WORKER = ORIGINAL;
});

describe("getWorker", () => {
  it("registers a handler for every job type, upgrade_site included", () => {
    getWorker();
    const [{ handlers }] = createWorkerMock.mock.calls[0] as [{ handlers: Record<string, unknown> }];
    expect(Object.keys(handlers).sort()).toEqual(["create_site", "migrate_site", "upgrade_site"]);
    expect(handlers.upgrade_site).toBe(handleUpgradeSiteMock);
  });
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
