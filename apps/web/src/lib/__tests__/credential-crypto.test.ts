import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREDENTIALS_KEY_ENV,
  CREDENTIALS_OLD_KEYS_ENV,
  credentialKeyId,
  currentCredentialKeyId,
  decryptCredential,
  decryptOptionalCredential,
  encryptCredential,
  encryptOptionalCredential,
  isEncryptedCredential,
  resetCredentialCryptoForTests,
} from "../credential-crypto";

function newKey(id: string): string {
  return `${id}:${randomBytes(32).toString("base64")}`;
}

const KEY_A = newKey("a");
const KEY_B = newKey("b");

beforeEach(() => {
  resetCredentialCryptoForTests();
  vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_A);
  vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("encryptCredential / decryptCredential", () => {
  it("round-trips and writes the versioned, key-tagged format", async () => {
    const stored = await encryptCredential("ghp_secret");
    expect(stored).toMatch(/^enc:v1:a:[\w-]+:[\w-]+:[\w-]+$/);
    expect(stored).not.toContain("ghp_secret");
    expect(isEncryptedCredential(stored)).toBe(true);
    expect(await decryptCredential(stored)).toBe("ghp_secret");
  });

  it("uses a fresh IV per call", async () => {
    const one = await encryptCredential("same");
    const two = await encryptCredential("same");
    expect(one).not.toBe(two);
  });

  it("round-trips unicode and empty strings", async () => {
    expect(await decryptCredential(await encryptCredential("tökén ✓"))).toBe("tökén ✓");
    expect(await decryptCredential(await encryptCredential(""))).toBe("");
  });

  it("does not double-encrypt an already-encrypted value", async () => {
    const stored = await encryptCredential("x");
    expect(await encryptCredential(stored)).toBe(stored);
  });

  it("passes legacy plaintext through on read", async () => {
    expect(await decryptCredential("ghp_legacy_plaintext")).toBe("ghp_legacy_plaintext");
    expect(isEncryptedCredential("ghp_legacy_plaintext")).toBe(false);
  });

  it("fails with the wrong key under the same id", async () => {
    const stored = await encryptCredential("secret");
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("a"));
    await expect(decryptCredential(stored)).rejects.toThrow(/failed to decrypt with key "a"/);
  });

  it("fails on a tampered ciphertext, tag or key id", async () => {
    const stored = await encryptCredential("secret");
    const [, , keyId, iv, tag, ct] = stored.split(":");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);

    await expect(decryptCredential(`enc:v1:${keyId}:${iv}:${tag}:${flip(ct)}`)).rejects.toThrow(
      /failed to decrypt/,
    );
    await expect(decryptCredential(`enc:v1:${keyId}:${iv}:${flip(tag)}:${ct}`)).rejects.toThrow(
      /failed to decrypt/,
    );
    // Same key material under another id: the AAD binds the id, so it still fails.
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, `z:${KEY_A.split(":")[1]}`);
    await expect(decryptCredential(`enc:v1:z:${iv}:${tag}:${ct}`)).rejects.toThrow(
      /failed to decrypt/,
    );
  });

  it("rejects malformed encrypted values", async () => {
    await expect(decryptCredential("enc:v1:a:onlythree:parts")).rejects.toThrow(/malformed/);
    await expect(decryptCredential("enc:v1:a:AAAA:AAAA:AAAA")).rejects.toThrow(/malformed/);
  });

  it("rejects a value encrypted under a key that isn't configured", async () => {
    const stored = await encryptCredential("secret");
    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_B);
    await expect(decryptCredential(stored)).rejects.toThrow(/key "a", which is not configured/);
  });
});

describe("key rotation", () => {
  it("decrypts with an old key and encrypts with the current one", async () => {
    const underA = await encryptCredential("secret");

    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_B);
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, ` ${KEY_A} `);

    expect(await decryptCredential(underA)).toBe("secret");
    const underB = await encryptCredential("secret");
    expect(underB.startsWith("enc:v1:b:")).toBe(true);
    expect(await decryptCredential(underB)).toBe("secret");
  });

  it("accepts several comma-separated old keys", async () => {
    const underA = await encryptCredential("one");
    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_B);
    const underB = await encryptCredential("two");
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("c"));
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, `${KEY_A},${KEY_B}`);
    expect(await decryptCredential(underA)).toBe("one");
    expect(await decryptCredential(underB)).toBe("two");
  });

  it("rejects a key id configured twice", async () => {
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, newKey("a"));
    await expect(encryptCredential("x")).rejects.toThrow(/configured more than once/);
  });
});

describe("missing or invalid key", () => {
  it("stores plaintext and warns once when no key is set", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await encryptCredential("one")).toBe("one");
    expect(await encryptCredential("two")).toBe("two");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(CREDENTIALS_KEY_ENV);
  });

  it("still reads plaintext with no key set", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    expect(await decryptCredential("plain")).toBe("plain");
  });

  it("cannot read encrypted values with no key set", async () => {
    const stored = await encryptCredential("secret");
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    await expect(decryptCredential(stored)).rejects.toThrow(/not configured/);
  });

  it.each([
    ["no key id", randomBytes(32).toString("base64")],
    ["bad key id", `a b:${randomBytes(32).toString("base64")}`],
    ["short key", `a:${randomBytes(16).toString("base64")}`],
  ])("throws on a malformed key (%s)", async (_label, spec) => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, spec);
    await expect(encryptCredential("x")).rejects.toThrow(CREDENTIALS_KEY_ENV);
  });

  it("re-reports a malformed key on the next call instead of caching the failure", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "a:short");
    await expect(encryptCredential("x")).rejects.toThrow();
    await expect(encryptCredential("x")).rejects.toThrow();
    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_A);
    expect(isEncryptedCredential(await encryptCredential("x"))).toBe(true);
  });
});

describe("key ids", () => {
  it("reports the current key id, or null with no key", async () => {
    expect(await currentCredentialKeyId()).toBe("a");
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    expect(await currentCredentialKeyId()).toBeNull();
  });

  it("reads the key id off an encrypted value, null for plaintext", async () => {
    expect(credentialKeyId(await encryptCredential("x"))).toBe("a");
    expect(credentialKeyId("plain")).toBeNull();
  });
});

describe("optional helpers", () => {
  it("pass null and undefined through", async () => {
    expect(await encryptOptionalCredential(null)).toBeNull();
    expect(await encryptOptionalCredential(undefined)).toBeUndefined();
    expect(await decryptOptionalCredential(null)).toBeNull();
    expect(await decryptOptionalCredential(undefined)).toBeUndefined();
  });

  it("encrypt and decrypt strings", async () => {
    const stored = await encryptOptionalCredential("tok");
    expect(isEncryptedCredential(stored)).toBe(true);
    expect(await decryptOptionalCredential(stored)).toBe("tok");
  });
});
