import { describe, expect, it, vi } from "vitest";

import { buildCronRequest, CRON_JOBS_PATH, requestCronDrain } from "./cron-drain";

const SITE_URL = "https://stagecraft.example.dev";

function sendReturning(response: Response) {
  return vi.fn(async (_request: Request) => response);
}

describe("buildCronRequest", () => {
  it("builds a bearer-authenticated POST to the cron jobs route", () => {
    const request = buildCronRequest("s3cret", SITE_URL);

    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${SITE_URL}${CRON_JOBS_PATH}`);
    expect(request.headers.get("authorization")).toBe("Bearer s3cret");
  });

  it("uses only the site URL's origin", () => {
    const request = buildCronRequest("s3cret", `${SITE_URL}/some/base/?x=1`);

    expect(request.url).toBe(`${SITE_URL}${CRON_JOBS_PATH}`);
  });
});

describe("requestCronDrain", () => {
  it("sends one drain request", async () => {
    const send = sendReturning(Response.json({ ok: true, processed: 2 }));

    await requestCronDrain(send, "s3cret", SITE_URL);

    expect(send).toHaveBeenCalledTimes(1);
    const [request] = send.mock.calls[0];
    expect(request.url).toBe(`${SITE_URL}${CRON_JOBS_PATH}`);
    expect(request.headers.get("authorization")).toBe("Bearer s3cret");
  });

  it.each([undefined, ""])("throws without sending when the secret is %o", async (secret) => {
    const send = sendReturning(Response.json({ ok: true }));

    await expect(requestCronDrain(send, secret, SITE_URL)).rejects.toThrow(/CRON_SECRET is not set/);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("throws without sending when the site URL is %o", async (siteUrl) => {
    const send = sendReturning(Response.json({ ok: true }));

    await expect(requestCronDrain(send, "s3cret", siteUrl)).rejects.toThrow(/site URL is not set/);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [401, { ok: false, error: "unauthorized" }],
    [503, { ok: false, error: "cron-not-configured" }],
    [500, { ok: false, error: "boom" }],
  ])("throws with the status and body when the route answers %i", async (status, body) => {
    const send = sendReturning(Response.json(body, { status }));

    await expect(requestCronDrain(send, "s3cret", SITE_URL)).rejects.toThrow(
      `${CRON_JOBS_PATH} returned ${status}: ${JSON.stringify(body)}`,
    );
  });

  it("propagates a send failure", async () => {
    const send = vi.fn(async (_request: Request): Promise<Response> => {
      throw new Error("network down");
    });

    await expect(requestCronDrain(send, "s3cret", SITE_URL)).rejects.toThrow("network down");
  });
});
