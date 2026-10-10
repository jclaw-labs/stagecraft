import { describe, it, expect } from "vitest";
import { narrowJobFields } from "../jobs";
import {
  FAILURE_CATEGORIES,
  JOB_STATUSES,
  JOB_TYPES,
  isFailureCategory,
  isJobStatus,
  isJobType,
} from "../types";

describe("job type guards", () => {
  it.each(JOB_TYPES)("isJobType accepts %s", (type) => {
    expect(isJobType(type)).toBe(true);
  });

  it.each(JOB_STATUSES)("isJobStatus accepts %s", (status) => {
    expect(isJobStatus(status)).toBe(true);
  });

  it.each(FAILURE_CATEGORIES)("isFailureCategory accepts %s", (category) => {
    expect(isFailureCategory(category)).toBe(true);
  });

  it("rejects retired, empty and wrongly-cased values", () => {
    expect(isJobType("edit_site")).toBe(false);
    expect(isJobType("")).toBe(false);
    expect(isJobType("Create_Site")).toBe(false);
    expect(isJobStatus("awaiting_review")).toBe(false);
    expect(isJobStatus("")).toBe(false);
    expect(isFailureCategory("ai_error")).toBe(false);
    expect(isFailureCategory("")).toBe(false);
  });

  it("rejects Object.prototype keys", () => {
    expect(isJobType("constructor")).toBe(false);
    expect(isJobStatus("toString")).toBe(false);
  });
});

describe("narrowJobFields", () => {
  const base = { id: "job-1", errorMessage: "boom", createdAt: "2026-04-02T00:00:00.000Z" };

  it("keeps known values and the row's other fields", () => {
    const row = { ...base, type: "create_site", status: "failed", failureCategory: "timeout" };
    expect(narrowJobFields(row)).toEqual(row);
  });

  it("keeps a null failure category null", () => {
    const row = { ...base, type: "migrate_site", status: "completed", failureCategory: null };
    expect(narrowJobFields(row).failureCategory).toBeNull();
  });

  it("maps a retired AI-edit row to the fallbacks", () => {
    const row = { ...base, type: "edit_site", status: "awaiting_review", failureCategory: "ai_error" };
    expect(narrowJobFields(row)).toEqual({ ...base, type: null, status: null, failureCategory: "unknown" });
  });

  it("narrows each column on its own", () => {
    const row = { ...base, type: "edit_site", status: "failed", failureCategory: "validation_error" };
    expect(narrowJobFields(row)).toMatchObject({ type: null, status: "failed", failureCategory: "validation_error" });
  });

  it("does not modify the input row", () => {
    const row = { ...base, type: "edit_site", status: "awaiting_review", failureCategory: "ai_error" };
    narrowJobFields(row);
    expect(row.type).toBe("edit_site");
  });
});
