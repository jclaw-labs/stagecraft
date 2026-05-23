import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMagicLinkToken,
  createSessionToken,
  getAllowedEditorEmails,
  verifyMagicLinkToken,
  verifySessionToken,
} from "./auth";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MAGIC_LINK_SIGNING_SECRET;
  delete process.env.STAGECRAFT_BROKER_SECRET;
  process.env.MAGIC_LINK_SIGNING_SECRET = "test-secret-do-not-use-in-prod";
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.unstubAllEnvs();
});

describe("auth tokens", () => {
  it("magic-link token round-trips", async () => {
    const token = await createMagicLinkToken("user@example.com");
    expect(await verifyMagicLinkToken(token)).toEqual({ email: "user@example.com" });
  });

  it("session token round-trips", async () => {
    const token = await createSessionToken("user@example.com");
    expect(await verifySessionToken(token)).toEqual({ email: "user@example.com" });
  });

  it("session tokens cannot pass as magic-link tokens", async () => {
    const token = await createSessionToken("user@example.com");
    expect(await verifyMagicLinkToken(token)).toBeNull();
  });

  it("magic-link tokens cannot pass as session tokens", async () => {
    const token = await createMagicLinkToken("user@example.com");
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("malformed tokens return null", async () => {
    expect(await verifyMagicLinkToken("not-a-jwt")).toBeNull();
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
  });

  it("tokens signed with a different secret are rejected", async () => {
    const token = await createSessionToken("user@example.com");
    process.env.MAGIC_LINK_SIGNING_SECRET = "different-secret";
    expect(await verifySessionToken(token)).toBeNull();
  });
});

describe("auth tokens: secret derived from STAGECRAFT_BROKER_SECRET", () => {
  it("derives a signing secret from STAGECRAFT_BROKER_SECRET when MAGIC_LINK_SIGNING_SECRET is unset", async () => {
    delete process.env.MAGIC_LINK_SIGNING_SECRET;
    process.env.STAGECRAFT_BROKER_SECRET = "scbs_test_broker_secret_12345";

    const token = await createSessionToken("user@example.com");
    expect(await verifySessionToken(token)).toEqual({ email: "user@example.com" });
  });

  it("explicit MAGIC_LINK_SIGNING_SECRET takes precedence over derived (back-compat)", async () => {
    // Two distinct sites with the same explicit signing secret but
    // different broker secrets should produce interchangeable tokens —
    // the broker secret is ignored when MAGIC_LINK_SIGNING_SECRET is
    // present.
    process.env.MAGIC_LINK_SIGNING_SECRET = "explicit-secret";
    process.env.STAGECRAFT_BROKER_SECRET = "broker-A";
    const token = await createSessionToken("user@example.com");

    process.env.STAGECRAFT_BROKER_SECRET = "broker-B";
    expect(await verifySessionToken(token)).toEqual({ email: "user@example.com" });
  });

  it("rotating STAGECRAFT_BROKER_SECRET invalidates derived-secret tokens (by design)", async () => {
    delete process.env.MAGIC_LINK_SIGNING_SECRET;
    process.env.STAGECRAFT_BROKER_SECRET = "broker-A";
    const token = await createSessionToken("user@example.com");

    process.env.STAGECRAFT_BROKER_SECRET = "broker-B";
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("throws in production when neither secret is set", async () => {
    delete process.env.MAGIC_LINK_SIGNING_SECRET;
    delete process.env.STAGECRAFT_BROKER_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    await expect(createSessionToken("user@example.com")).rejects.toThrow(
      /Neither MAGIC_LINK_SIGNING_SECRET nor STAGECRAFT_BROKER_SECRET/,
    );
  });

  it("falls back to a hardcoded dev secret when neither is set in dev", async () => {
    delete process.env.MAGIC_LINK_SIGNING_SECRET;
    delete process.env.STAGECRAFT_BROKER_SECRET;
    vi.stubEnv("NODE_ENV", "development");

    const token = await createSessionToken("user@example.com");
    expect(await verifySessionToken(token)).toEqual({ email: "user@example.com" });
  });
});

describe("editor allowlist", () => {
  beforeEach(() => {
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
  });

  it("returns an empty list when neither var is set", () => {
    expect(getAllowedEditorEmails()).toEqual([]);
  });

  it("honors the legacy single ADMIN_EMAIL (normalized)", () => {
    process.env.ADMIN_EMAIL = "  Artist@Example.COM ";
    expect(getAllowedEditorEmails()).toEqual(["artist@example.com"]);
    expect(getAllowedEditorEmails().includes("nope@example.com")).toBe(false);
  });

  it("parses ADMIN_EMAILS as a comma/whitespace separated list", () => {
    process.env.ADMIN_EMAILS = "a@x.com, b@y.com\nc@z.com";
    expect(getAllowedEditorEmails()).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("unions ADMIN_EMAILS with the legacy ADMIN_EMAIL and dedupes case-insensitively", () => {
    process.env.ADMIN_EMAILS = "a@x.com, b@y.com";
    process.env.ADMIN_EMAIL = "B@Y.com";
    expect(getAllowedEditorEmails()).toEqual(["a@x.com", "b@y.com"]);
  });
});
