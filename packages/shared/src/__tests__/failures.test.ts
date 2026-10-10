import { describe, it, expect } from "vitest";
import { getFailureSummary } from "../failures";
import { FAILURE_CATEGORIES } from "../types";

describe("getFailureSummary", () => {
  it("returns the correct summary for github_api_error", () => {
    const summary = getFailureSummary("github_api_error");
    expect(summary.title).toBe("GitHub connection problem");
    expect(summary.description).toContain("GitHub");
    expect(summary.suggestedAction).toContain("Settings");
  });

  it("returns the correct summary for netlify_deploy_error", () => {
    const summary = getFailureSummary("netlify_deploy_error");
    expect(summary.title).toBe("Deployment failed");
    expect(summary.description).toContain("Netlify");
  });

  it("returns the correct summary for validation_error", () => {
    const summary = getFailureSummary("validation_error");
    expect(summary.title).toBe("Content validation failed");
  });

  it("returns the correct summary for timeout", () => {
    const summary = getFailureSummary("timeout");
    expect(summary.title).toBe("Request timed out");
  });

  it("returns the correct summary for unknown", () => {
    const summary = getFailureSummary("unknown");
    expect(summary.title).toBe("Something went wrong");
  });

  it("falls back to unknown summary when category is null", () => {
    const summary = getFailureSummary(null);
    expect(summary.title).toBe("Something went wrong");
  });

  it("falls back to unknown summary when category is undefined", () => {
    const summary = getFailureSummary(undefined);
    expect(summary.title).toBe("Something went wrong");
  });

  it("returns an object with all required fields for every category", () => {
    for (const category of FAILURE_CATEGORIES) {
      const summary = getFailureSummary(category);
      expect(summary).toHaveProperty("title");
      expect(summary).toHaveProperty("description");
      expect(summary).toHaveProperty("suggestedAction");
      expect(typeof summary.title).toBe("string");
      expect(typeof summary.description).toBe("string");
      expect(typeof summary.suggestedAction).toBe("string");
    }
  });
});
