import { describe, expect, it } from "vitest";

import { extractBearer, pluralise } from "../utils";

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

describe("pluralise", () => {
  it("keeps the noun singular for exactly one", () => {
    expect(pluralise(1, "image")).toBe("1 image");
  });

  it("adds an s for zero and for more than one", () => {
    expect(pluralise(0, "image")).toBe("0 images");
    expect(pluralise(2, "image reference")).toBe("2 image references");
  });
});
