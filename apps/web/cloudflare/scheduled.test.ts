import { describe, expect, it, vi } from "vitest";

import {
  buildCronRequest,
  CRON_JOBS_PATH,
  runScheduledDrain,
  type ScheduledEnv,
  type WorkerExecutionContext,
  type WorkerFetch,
} from "./scheduled";

const ctx: WorkerExecutionContext = {
  waitUntil: () => {},
  passThroughOnException: () => {},
};

function fetchReturning(response: Response) {
  return vi.fn<WorkerFetch<ScheduledEnv>>(async () => response);
}

describe("buildCronRequest", () => {
  it("builds a bearer-authenticated POST to the cron jobs route", () => {
    const request = buildCronRequest("s3cret");

    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(CRON_JOBS_PATH);
    expect(request.headers.get("authorization")).toBe("Bearer s3cret");
  });
});

describe("runScheduledDrain", () => {
  it("sends the cron request through the worker's fetch handler with env and ctx", async () => {
    const fetchHandler = fetchReturning(Response.json({ ok: true, processed: 2 }));
    const env = { CRON_SECRET: "s3cret" };

    await runScheduledDrain(fetchHandler, env, ctx);

    expect(fetchHandler).toHaveBeenCalledTimes(1);
    const [request, passedEnv, passedCtx] = fetchHandler.mock.calls[0];
    expect(new URL(request.url).pathname).toBe(CRON_JOBS_PATH);
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer s3cret");
    expect(passedEnv).toBe(env);
    expect(passedCtx).toBe(ctx);
  });

  it.each([{}, { CRON_SECRET: "" }])("throws without calling the route when CRON_SECRET is missing (%o)", async (env) => {
    const fetchHandler = fetchReturning(Response.json({ ok: true }));

    await expect(runScheduledDrain(fetchHandler, env, ctx)).rejects.toThrow(/CRON_SECRET is not set/);
    expect(fetchHandler).not.toHaveBeenCalled();
  });

  it.each([
    [401, { ok: false, error: "unauthorized" }],
    [503, { ok: false, error: "cron-not-configured" }],
    [500, { ok: false, error: "boom" }],
  ])("throws with the status and body when the route answers %i", async (status, body) => {
    const fetchHandler = fetchReturning(Response.json(body, { status }));

    await expect(runScheduledDrain(fetchHandler, { CRON_SECRET: "s3cret" }, ctx)).rejects.toThrow(
      `${CRON_JOBS_PATH} returned ${status}: ${JSON.stringify(body)}`,
    );
  });

  it("propagates a fetch handler failure", async () => {
    const fetchHandler = vi.fn<WorkerFetch<ScheduledEnv>>(async () => {
      throw new Error("handler crashed");
    });

    await expect(runScheduledDrain(fetchHandler, { CRON_SECRET: "s3cret" }, ctx)).rejects.toThrow("handler crashed");
  });
});
