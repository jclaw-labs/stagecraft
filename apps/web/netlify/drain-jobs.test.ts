import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CRON_JOBS_PATH } from "../src/lib/jobs/cron-drain";
import drainJobs, { config } from "./functions/drain-jobs";

const fetchMock = vi.fn<typeof fetch>();

describe("drain-jobs scheduled function", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.stubEnv("URL", "https://stagecraft.example.dev");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("runs every five minutes", () => {
    expect(config.schedule).toBe("*/5 * * * *");
  });

  it("posts to the drain route on the site URL with the cron secret", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, processed: 1 }));

    await drainJobs();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe(`https://stagecraft.example.dev${CRON_JOBS_PATH}`);
    expect(request.method).toBe("POST");
    expect(request.headers.get("authorization")).toBe("Bearer s3cret");
  });

  it("fails without calling the route when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    await expect(drainJobs()).rejects.toThrow(/CRON_SECRET is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when the route answers non-2xx", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: false, error: "unauthorized" }, { status: 401 }));

    await expect(drainJobs()).rejects.toThrow(`${CRON_JOBS_PATH} returned 401`);
  });
});
