import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { hashSessionToken, isSessionTokenHash } from "../session-token";

describe("hashSessionToken", () => {
  it("returns the lowercase hex SHA-256 of the token", async () => {
    const token = "2f1c7a3e-5b8d-4e0f-9a6b-1c2d3e4f5a6b";
    expect(await hashSessionToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("matches a known vector", async () => {
    expect(await hashSessionToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the empty string", async () => {
    expect(await hashSessionToken("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("produces a value isSessionTokenHash recognises", async () => {
    expect(isSessionTokenHash(await hashSessionToken("token"))).toBe(true);
  });
});

describe("isSessionTokenHash", () => {
  it("rejects a UUID session token", () => {
    expect(isSessionTokenHash("2f1c7a3e-5b8d-4e0f-9a6b-1c2d3e4f5a6b")).toBe(false);
  });

  it("rejects uppercase hex", () => {
    expect(isSessionTokenHash("A".repeat(64))).toBe(false);
  });

  it("rejects hex one character short or long", () => {
    expect(isSessionTokenHash("a".repeat(63))).toBe(false);
    expect(isSessionTokenHash("a".repeat(65))).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isSessionTokenHash("")).toBe(false);
  });
});
