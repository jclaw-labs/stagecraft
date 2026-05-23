import { describe, expect, it } from "vitest";

import { pickStepIndex } from "../progress-steps";

describe("pickStepIndex", () => {
  it("returns 0 at the start", () => {
    expect(pickStepIndex(0, 2000, 5)).toBe(0);
  });

  it("advances every intervalMs", () => {
    expect(pickStepIndex(1999, 2000, 5)).toBe(0);
    expect(pickStepIndex(2000, 2000, 5)).toBe(1);
    expect(pickStepIndex(4000, 2000, 5)).toBe(2);
    expect(pickStepIndex(8000, 2000, 5)).toBe(4);
  });

  it("saturates at the last step (no off-by-one past the end)", () => {
    expect(pickStepIndex(60_000, 2000, 5)).toBe(4);
    expect(pickStepIndex(Number.MAX_SAFE_INTEGER, 2000, 5)).toBe(4);
  });

  it("returns 0 when totalSteps is 0 or negative", () => {
    expect(pickStepIndex(5000, 2000, 0)).toBe(0);
    expect(pickStepIndex(5000, 2000, -1)).toBe(0);
  });

  it("clamps negative elapsed time to 0", () => {
    expect(pickStepIndex(-100, 2000, 5)).toBe(0);
  });

  it("works with totalSteps = 1 (single step always returns 0)", () => {
    expect(pickStepIndex(0, 2000, 1)).toBe(0);
    expect(pickStepIndex(10_000, 2000, 1)).toBe(0);
  });
});
