import { describe, expect, it } from "vitest";

import { extractBearer } from "../utils";

describe("extractBearer", () => {
  it("returns the token from a Bearer header", () => {
    expect(extractBearer("Bearer abc123")).toBe("abc123");
  });

  it("matches the scheme case-insensitively", () => {
    expect(extractBearer("bearer abc123")).toBe("abc123");
  });

  it("returns null for a missing header", () => {
    expect(extractBearer(null)).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(extractBearer("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null when the token is empty", () => {
    expect(extractBearer("Bearer ")).toBeNull();
  });
});
