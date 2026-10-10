import { describe, it, expect } from "vitest";
import { repairResult, MAX_REPAIR_ATTEMPTS } from "../repair";

describe("MAX_REPAIR_ATTEMPTS", () => {
  it("is a positive integer", () => {
    expect(typeof MAX_REPAIR_ATTEMPTS).toBe("number");
    expect(MAX_REPAIR_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_REPAIR_ATTEMPTS)).toBe(true);
  });
});

describe("repairResult", () => {
  it("returns success: false", () => {
    const result = repairResult("Schema invalid");
    expect(result.success).toBe(false);
  });

  it("sets shouldRepair: true", () => {
    const result = repairResult("Schema invalid");
    expect(result.shouldRepair).toBe(true);
  });

  it("passes the message through", () => {
    const result = repairResult("Schema validation failed");
    expect(result.message).toBe("Schema validation failed");
  });

  it("defaults failureCategory to validation_error", () => {
    const result = repairResult("Schema invalid");
    expect(result.failureCategory).toBe("validation_error");
  });

  it("accepts a custom failureCategory", () => {
    const result = repairResult("Deploy timed out", "timeout");
    expect(result.failureCategory).toBe("timeout");
  });

  it("returns all required JobResult fields", () => {
    const result = repairResult("some failure");
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("message");
    expect(result).toHaveProperty("failureCategory");
    expect(result).toHaveProperty("shouldRepair");
  });
});
