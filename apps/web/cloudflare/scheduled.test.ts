import { describe, expect, it, vi } from "vitest";

import {
  buildCronRequest,
  CRON_JOBS_PATH,
  CRON_REQUEST_ORIGIN,
  cronRequestOrigin,
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

  it("builds the request on AUTH_URL's origin when it is set", () => {
    const request = buildCronRequest("s3cret", "https://stagecraft.example.dev/some/base/");

    expect(request.url).toBe(`https://stagecraft.example.dev${CRON_JOBS_PATH}`);
  });

  it("falls back to the placeholder origin when AUTH_URL is unset", () => {
    const request = buildCronRequest("s3cret");

    expect(new URL(request.url).origin).toBe(CRON_REQUEST_ORIGIN);
  });
});

describe("cronRequestOrigin", () => {
  it.each([
    ["https://stagecraft.example.dev", "https://stagecraft.example.dev"],
    ["https://stagecraft.example.dev/", "https://stagecraft.example.dev"],
    ["http://localhost:3000/dashboard?x=1", "http://localhost:3000"],
  ])("uses the origin of AUTH_URL %s", (authUrl, origin) => {
    expect(cronRequestOrigin(authUrl)).toBe(origin);
  });

  it.each([undefined, "", "not a url", "stagecraft.example.dev", "ftp://stagecraft.example.dev"])(
    "falls back to the placeholder origin for AUTH_URL %o",
    (authUrl) => {
      expect(cronRequestOrigin(authUrl)).toBe(CRON_REQUEST_ORIGIN);
    },
  );
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

  it("sends the cron request to AUTH_URL's origin when the binding is set", async () => {
    const fetchHandler = fetchReturning(Response.json({ ok: true, processed: 0 }));

    await runScheduledDrain(fetchHandler, { CRON_SECRET: "s3cret", AUTH_URL: "https://stagecraft.example.dev" }, ctx);

    const [request] = fetchHandler.mock.calls[0];
    expect(request.url).toBe(`https://stagecraft.example.dev${CRON_JOBS_PATH}`);
  });

  it("sends the cron request to the placeholder origin when AUTH_URL is unset", async () => {
    const fetchHandler = fetchReturning(Response.json({ ok: true, processed: 0 }));

    await runScheduledDrain(fetchHandler, { CRON_SECRET: "s3cret" }, ctx);

    const [request] = fetchHandler.mock.calls[0];
    expect(new URL(request.url).origin).toBe(CRON_REQUEST_ORIGIN);
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
