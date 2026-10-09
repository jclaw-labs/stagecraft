import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindUnique = vi.fn();
const mockUpdateMany = vi.fn();

vi.mock("@stagecraft/db", () => ({
  prisma: {
    siteJob: {
      findUnique: mockFindUnique,
      updateMany: mockUpdateMany,
    },
  },
}));

const { createStepRunner, readStepProgress, LeaseLostError } = await import("../steps");

const STARTED_AT = new Date("2026-10-09T12:00:00Z");

function row(resultPayload: unknown = null, overrides: Record<string, unknown> = {}) {
  return { status: "running", startedAt: STARTED_AT, resultPayload, ...overrides };
}

/** The `steps` map from the most recent progress write. */
function lastWrittenSteps() {
  const calls = mockUpdateMany.mock.calls;
  return calls[calls.length - 1][0].data.resultPayload.steps;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe("createStepRunner", () => {
  it("runs a fresh step, records started then completed, and returns its result", async () => {
    mockFindUnique.mockResolvedValue(row());
    const runner = await createStepRunner("job-1");
    const fn = vi.fn().mockResolvedValue({ owner: "jclaw" });

    const result = await runner.run("createRepo", fn);

    expect(result).toEqual({ owner: "jclaw" });
    expect(fn).toHaveBeenCalledWith({ interrupted: false, firstStartedAt: null });
    expect(mockUpdateMany).toHaveBeenCalledTimes(2);
    const [started, completed] = mockUpdateMany.mock.calls.map(([args]) => args);
    expect(started.where).toEqual({ id: "job-1", status: "running", startedAt: STARTED_AT });
    expect(started.data.resultPayload.steps.createRepo).toEqual({
      state: "started",
      attempts: 1,
      startedAt: expect.any(String),
    });
    expect(completed.data.resultPayload.steps.createRepo).toMatchObject({
      state: "completed",
      attempts: 1,
      result: { owner: "jclaw" },
    });
    expect(runner.isCompleted("createRepo")).toBe(true);
  });

  it("skips a step an earlier run completed and returns the stored result", async () => {
    mockFindUnique.mockResolvedValue(
      row({ steps: { createRepo: { state: "completed", attempts: 1, result: { owner: "jclaw" } } } }),
    );
    const runner = await createStepRunner("job-1");
    const fn = vi.fn();

    const result = await runner.run("createRepo", fn);

    expect(result).toEqual({ owner: "jclaw" });
    expect(fn).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("re-runs a step an earlier run started but never finished, flagged as interrupted", async () => {
    const firstStart = "2026-10-09T11:00:00.000Z";
    mockFindUnique.mockResolvedValue(
      row({ steps: { pushTemplate: { state: "started", attempts: 1, startedAt: firstStart } } }),
    );
    const runner = await createStepRunner("job-1");
    const fn = vi.fn().mockResolvedValue("sha");

    await runner.run("pushTemplate", fn);

    expect(fn).toHaveBeenCalledWith({ interrupted: true, firstStartedAt: new Date(firstStart) });
    // The first attempt's start time is kept across attempts.
    expect(lastWrittenSteps().pushTemplate).toMatchObject({ state: "completed", attempts: 2, startedAt: firstStart });
  });

  it("passes no first start time for a record written without one", async () => {
    mockFindUnique.mockResolvedValue(row({ steps: { pushTemplate: { state: "started", attempts: 1 } } }));
    const runner = await createStepRunner("job-1");
    const fn = vi.fn().mockResolvedValue("sha");

    await runner.run("pushTemplate", fn);

    expect(fn).toHaveBeenCalledWith({ interrupted: true, firstStartedAt: null });
  });

  it("leaves a failed step recorded as started and rethrows", async () => {
    mockFindUnique.mockResolvedValue(row());
    const runner = await createStepRunner("job-1");

    await expect(runner.run("createHostProject", () => Promise.reject(new Error("503")))).rejects.toThrow(
      "503",
    );

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect(lastWrittenSteps().createHostProject).toEqual({
      state: "started",
      attempts: 1,
      startedAt: expect.any(String),
    });
    expect(runner.isCompleted("createHostProject")).toBe(false);
  });

  it("keeps other resultPayload keys next to steps", async () => {
    mockFindUnique.mockResolvedValue(row({ note: "kept" }));
    const runner = await createStepRunner("job-1");

    await runner.run("findInstallation", async () => null);

    expect(mockUpdateMany.mock.calls[0][0].data.resultPayload).toMatchObject({ note: "kept" });
  });

  it("throws LeaseLostError when a progress write matches no row", async () => {
    mockFindUnique.mockResolvedValue(row());
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });
    const runner = await createStepRunner("job-1");
    const fn = vi.fn();

    await expect(runner.run("createRepo", fn)).rejects.toBeInstanceOf(LeaseLostError);
    // The side effect never starts once ownership is gone.
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["not running", row(null, { status: "canceled" })],
    ["never claimed", row(null, { startedAt: null })],
  ])("throws LeaseLostError when the job is %s", async (_label, value) => {
    mockFindUnique.mockResolvedValue(value);
    await expect(createStepRunner("job-1")).rejects.toBeInstanceOf(LeaseLostError);
  });

  it("progress() returns a copy the caller can't use to change the runner's state", async () => {
    mockFindUnique.mockResolvedValue(row({ steps: { a: { state: "completed", attempts: 1, result: 1 } } }));
    const runner = await createStepRunner("job-1");

    const snapshot = runner.progress();
    snapshot.a.state = "started";

    expect(runner.isCompleted("a")).toBe(true);
  });
});

describe("readStepProgress", () => {
  it("returns {} for payloads without steps", () => {
    expect(readStepProgress(null)).toEqual({});
    expect(readStepProgress({ report: {} })).toEqual({});
    expect(readStepProgress({ steps: [] })).toEqual({});
  });

  it("drops malformed step records", () => {
    expect(
      readStepProgress({
        steps: {
          good: { state: "completed", attempts: 1, result: "x" },
          badState: { state: "done", attempts: 1 },
          noAttempts: { state: "started" },
          notObject: "completed",
        },
      }),
    ).toEqual({ good: { state: "completed", attempts: 1, result: "x" } });
  });
});
