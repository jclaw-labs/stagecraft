import { describe, it, expect } from "vitest";
import {
  JOB_LEASE_MS,
  LEASE_HEARTBEAT_MS,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  retryDelayMs,
} from "../retry";

describe("lease policy", () => {
  it("renews the lease several times per lease period", () => {
    // At least 3 heartbeats may be missed before a live job is reaped.
    expect(JOB_LEASE_MS / LEASE_HEARTBEAT_MS).toBeGreaterThanOrEqual(4);
  });

  it("bounds retries to a small positive integer", () => {
    expect(Number.isInteger(MAX_RETRY_ATTEMPTS)).toBe(true);
    expect(MAX_RETRY_ATTEMPTS).toBeGreaterThan(0);
  });
});

describe("retryDelayMs", () => {
  it("starts at the base delay", () => {
    expect(retryDelayMs(0)).toBe(RETRY_BASE_DELAY_MS);
  });

  it("doubles with each retry", () => {
    expect(retryDelayMs(1)).toBe(RETRY_BASE_DELAY_MS * 2);
    expect(retryDelayMs(2)).toBe(RETRY_BASE_DELAY_MS * 4);
  });

  it("caps at the max delay", () => {
    expect(retryDelayMs(10)).toBe(RETRY_MAX_DELAY_MS);
    expect(retryDelayMs(1_000_000)).toBe(RETRY_MAX_DELAY_MS);
    expect(retryDelayMs(Number.POSITIVE_INFINITY)).toBe(RETRY_MAX_DELAY_MS);
  });

  it("treats negative, fractional and NaN inputs safely", () => {
    expect(retryDelayMs(-3)).toBe(RETRY_BASE_DELAY_MS);
    expect(retryDelayMs(1.7)).toBe(RETRY_BASE_DELAY_MS * 2);
    expect(retryDelayMs(Number.NaN)).toBe(RETRY_BASE_DELAY_MS);
  });
});
