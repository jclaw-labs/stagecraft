import { describe, expect, it } from "vitest";

import { isStagecraftAdmin } from "../admin-allowlist";

describe("isStagecraftAdmin", () => {
  it("returns true for the allowlisted email", () => {
    expect(isStagecraftAdmin("jclaw3456@gmail.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isStagecraftAdmin("JClaw3456@Gmail.com")).toBe(true);
    expect(isStagecraftAdmin("JCLAW3456@GMAIL.COM")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(isStagecraftAdmin("  jclaw3456@gmail.com  ")).toBe(true);
  });

  it("returns false for non-allowlisted emails", () => {
    expect(isStagecraftAdmin("someone-else@example.com")).toBe(false);
    expect(isStagecraftAdmin("jclaw@gmail.com")).toBe(false); // lookalike
  });

  it("returns false for null / undefined / empty", () => {
    expect(isStagecraftAdmin(null)).toBe(false);
    expect(isStagecraftAdmin(undefined)).toBe(false);
    expect(isStagecraftAdmin("")).toBe(false);
  });
});
