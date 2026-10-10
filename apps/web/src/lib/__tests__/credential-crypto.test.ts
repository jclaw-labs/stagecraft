import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREDENTIALS_ACCEPT_V1_ENV,
  CREDENTIALS_KEY_ENV,
  CREDENTIALS_OLD_KEYS_ENV,
  CREDENTIALS_REQUIRED_ENV,
  credentialBinding,
  credentialFormat,
  credentialKeyId,
  credentialsAcceptV1,
  credentialsRequired,
  currentCredentialKeyId,
  decryptCredential,
  decryptOptionalCredential,
  encryptCredential,
  encryptOptionalCredential,
  integrationCredentialField,
  isEncryptedCredential,
  resetCredentialCryptoForTests,
  type AccountCredentialField,
} from "../credential-crypto";
import { encryptV1ForTests, newCredentialKey as newKey } from "./credential-test-helpers";

const KEY_A = newKey("a");
const KEY_B = newKey("b");

const GITHUB = integrationCredentialField("user-1", "github");
const ACCOUNT: AccountCredentialField = {
  table: "Account",
  provider: "github",
  providerAccountId: "123",
  column: "access_token",
};

beforeEach(() => {
  resetCredentialCryptoForTests();
  vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_A);
  vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, "");
  vi.stubEnv(CREDENTIALS_REQUIRED_ENV, "");
  vi.stubEnv(CREDENTIALS_ACCEPT_V1_ENV, "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("encryptCredential / decryptCredential (v2)", () => {
  it("round-trips and writes the v2, key-tagged format", async () => {
    const stored = await encryptCredential("ghp_secret", GITHUB);
    expect(stored).toMatch(/^enc:v2:a:[\w-]+:[\w-]+:[\w-]+$/);
    expect(stored).not.toContain("ghp_secret");
    expect(isEncryptedCredential(stored)).toBe(true);
    expect(credentialFormat(stored)).toBe("v2");
    expect(await decryptCredential(stored, GITHUB)).toBe("ghp_secret");
  });

  it("round-trips Account fields", async () => {
    const stored = await encryptCredential("gho_secret", ACCOUNT);
    expect(await decryptCredential(stored, ACCOUNT)).toBe("gho_secret");
  });

  it("uses a fresh IV per call", async () => {
    const one = await encryptCredential("same", GITHUB);
    const two = await encryptCredential("same", GITHUB);
    expect(one).not.toBe(two);
  });

  it("round-trips unicode and empty strings", async () => {
    expect(await decryptCredential(await encryptCredential("tökén ✓", GITHUB), GITHUB)).toBe("tökén ✓");
    expect(await decryptCredential(await encryptCredential("", GITHUB), GITHUB)).toBe("");
  });

  it("refuses to encrypt a value that is already encrypted", async () => {
    const stored = await encryptCredential("x", GITHUB);
    await expect(encryptCredential(stored, GITHUB)).rejects.toThrow(/already in the encrypted format/);
    await expect(encryptCredential(encryptV1ForTests("x", KEY_A), GITHUB)).rejects.toThrow(
      /already in the encrypted format/,
    );
  });

  it("passes legacy plaintext through on read", async () => {
    expect(await decryptCredential("ghp_legacy_plaintext", GITHUB)).toBe("ghp_legacy_plaintext");
    expect(isEncryptedCredential("ghp_legacy_plaintext")).toBe(false);
    expect(credentialFormat("ghp_legacy_plaintext")).toBe("plaintext");
  });

  it("fails with the wrong key under the same id", async () => {
    const stored = await encryptCredential("secret", GITHUB);
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("a"));
    await expect(decryptCredential(stored, GITHUB)).rejects.toThrow(/failed to decrypt with key "a"/);
  });

  it("fails on a tampered ciphertext, tag, key id or version", async () => {
    const stored = await encryptCredential("secret", GITHUB);
    const [, , keyId, iv, tag, ct] = stored.split(":");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);

    await expect(decryptCredential(`enc:v2:${keyId}:${iv}:${tag}:${flip(ct)}`, GITHUB)).rejects.toThrow(
      /failed to decrypt/,
    );
    await expect(decryptCredential(`enc:v2:${keyId}:${iv}:${flip(tag)}:${ct}`, GITHUB)).rejects.toThrow(
      /failed to decrypt/,
    );
    // Downgrading the label to v1 (to drop the row binding) fails the tag check.
    await expect(decryptCredential(`enc:v1:${keyId}:${iv}:${tag}:${ct}`, GITHUB)).rejects.toThrow(
      /failed to decrypt/,
    );
    // Same key material under another id: the AAD binds the id, so it still fails.
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, `z:${KEY_A.split(":")[1]}`);
    await expect(decryptCredential(`enc:v2:z:${iv}:${tag}:${ct}`, GITHUB)).rejects.toThrow(
      /failed to decrypt/,
    );
  });

  it("rejects malformed encrypted values", async () => {
    await expect(decryptCredential("enc:v2:a:onlythree:parts", GITHUB)).rejects.toThrow(/malformed/);
    await expect(decryptCredential("enc:v2:a:AAAA:AAAA:AAAA", GITHUB)).rejects.toThrow(/malformed/);
  });

  it("rejects an unknown format version instead of treating it as plaintext", async () => {
    await expect(decryptCredential("enc:v9:a:AAAA:AAAA:AAAA", GITHUB)).rejects.toThrow(
      /unsupported format/,
    );
    expect(() => credentialFormat("enc:v9:x")).toThrow(/unsupported format/);
  });

  it("rejects a value encrypted under a key that isn't configured", async () => {
    const stored = await encryptCredential("secret", GITHUB);
    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_B);
    await expect(decryptCredential(stored, GITHUB)).rejects.toThrow(/key "a", which is not configured/);
  });
});

describe("row binding (v2)", () => {
  it.each([
    ["another user", integrationCredentialField("user-2", "github")],
    ["another provider", integrationCredentialField("user-1", "netlify")],
    ["another column", integrationCredentialField("user-1", "github", "refreshToken")],
    ["another table", { ...ACCOUNT, providerAccountId: "user-1" }],
  ])("a ciphertext copied to %s's row fails to decrypt", async (_label, otherField) => {
    const stored = await encryptCredential("ghp_secret", GITHUB);
    await expect(decryptCredential(stored, otherField)).rejects.toThrow(
      /failed to decrypt.*another row or column/,
    );
  });

  it("binds Account values to provider and providerAccountId", async () => {
    const stored = await encryptCredential("gho", ACCOUNT);
    await expect(decryptCredential(stored, { ...ACCOUNT, providerAccountId: "456" })).rejects.toThrow(
      /failed to decrypt/,
    );
    await expect(decryptCredential(stored, { ...ACCOUNT, column: "id_token" })).rejects.toThrow(
      /failed to decrypt/,
    );
  });

  it("encodes the binding unambiguously", () => {
    // A ":" inside an id can't make two different rows encode the same.
    const one = credentialBinding({ ...ACCOUNT, provider: "a:b", providerAccountId: "c" });
    const two = credentialBinding({ ...ACCOUNT, provider: "a", providerAccountId: "b:c" });
    expect(one).not.toBe(two);
    expect(credentialBinding(GITHUB)).toBe('["IntegrationAccount","user-1","github","accessToken"]');
  });
});

describe("legacy v1 values", () => {
  it("still decrypt, under the current or an old key", async () => {
    const v1 = encryptV1ForTests("ghp_old", KEY_A);
    expect(credentialFormat(v1)).toBe("v1");
    expect(credentialKeyId(v1)).toBe("a");
    expect(await decryptCredential(v1, GITHUB)).toBe("ghp_old");

    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_B);
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, KEY_A);
    expect(await decryptCredential(v1, GITHUB)).toBe("ghp_old");
  });

  it("are not bound to a row (unchanged v1 semantics)", async () => {
    const v1 = encryptV1ForTests("ghp_old", KEY_A);
    expect(await decryptCredential(v1, integrationCredentialField("user-2", "vercel"))).toBe("ghp_old");
  });

  it("still fail on tampering", async () => {
    const v1 = encryptV1ForTests("ghp_old", KEY_A);
    const [, , keyId, iv, tag, ct] = v1.split(":");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    await expect(decryptCredential(`enc:v1:${keyId}:${iv}:${tag}:${flip(ct)}`, GITHUB)).rejects.toThrow(
      /failed to decrypt/,
    );
    // Relabelling a v1 value as v2 fails too.
    await expect(decryptCredential(`enc:v2:${keyId}:${iv}:${tag}:${ct}`, GITHUB)).rejects.toThrow(
      /failed to decrypt/,
    );
  });
});

describe(`legacy v1 values with ${CREDENTIALS_ACCEPT_V1_ENV}=false`, () => {
  beforeEach(() => {
    vi.stubEnv(CREDENTIALS_ACCEPT_V1_ENV, "false");
  });

  it("are refused, in their own row and in a row they were copied into", async () => {
    const v1 = encryptV1ForTests("ghp_old", KEY_A);
    await expect(decryptCredential(v1, GITHUB)).rejects.toThrow(CREDENTIALS_ACCEPT_V1_ENV);
    await expect(
      decryptCredential(v1, integrationCredentialField("user-2", "vercel")),
    ).rejects.toThrow(/legacy v1 format/);
    await expect(decryptOptionalCredential(v1, GITHUB)).rejects.toThrow(/legacy v1 format/);
  });

  it("leave v2 values and legacy plaintext readable", async () => {
    const v2 = await encryptCredential("ghp_new", GITHUB);
    expect(await decryptCredential(v2, GITHUB)).toBe("ghp_new");
    expect(await decryptCredential("ghp_plain", GITHUB)).toBe("ghp_plain");
  });

  it("refuses v1 on a typo too, rather than reading it", async () => {
    vi.stubEnv(CREDENTIALS_ACCEPT_V1_ENV, "flase");
    const v1 = encryptV1ForTests("ghp_old", KEY_A);
    await expect(decryptCredential(v1, GITHUB)).rejects.toThrow(CREDENTIALS_ACCEPT_V1_ENV);
  });
});

describe("credentialsAcceptV1", () => {
  it.each([
    ["", true],
    ["true", true],
    [" TRUE ", true],
    ["false", false],
    [" False\n", false],
  ])("%j is %s", (flag, expected) => {
    vi.stubEnv(CREDENTIALS_ACCEPT_V1_ENV, flag);
    expect(credentialsAcceptV1()).toBe(expected);
  });

  it.each(["0", "no", "off"])("throws on %j rather than guessing", (flag) => {
    vi.stubEnv(CREDENTIALS_ACCEPT_V1_ENV, flag);
    expect(() => credentialsAcceptV1()).toThrow(CREDENTIALS_ACCEPT_V1_ENV);
  });
});

describe("key rotation", () => {
  it("decrypts with an old key and encrypts with the current one", async () => {
    const underA = await encryptCredential("secret", GITHUB);

    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_B);
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, ` ${KEY_A} `);

    expect(await decryptCredential(underA, GITHUB)).toBe("secret");
    const underB = await encryptCredential("secret", GITHUB);
    expect(underB.startsWith("enc:v2:b:")).toBe(true);
    expect(await decryptCredential(underB, GITHUB)).toBe("secret");
  });

  it("accepts several comma-separated old keys", async () => {
    const underA = await encryptCredential("one", GITHUB);
    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_B);
    const underB = await encryptCredential("two", GITHUB);
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("c"));
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, `${KEY_A},${KEY_B}`);
    expect(await decryptCredential(underA, GITHUB)).toBe("one");
    expect(await decryptCredential(underB, GITHUB)).toBe("two");
  });

  it("rejects a key id configured twice", async () => {
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, newKey("a"));
    await expect(encryptCredential("x", GITHUB)).rejects.toThrow(/configured more than once/);
  });
});

describe("missing key", () => {
  it("stores plaintext and warns once when no key is set outside production", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await encryptCredential("one", GITHUB)).toBe("one");
    expect(await encryptCredential("two", GITHUB)).toBe("two");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(CREDENTIALS_KEY_ENV);
  });

  it("refuses to store plaintext in production", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(encryptCredential("one", GITHUB)).rejects.toThrow(
      new RegExp(`${CREDENTIALS_KEY_ENV} is not set; refusing`),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it(`refuses to store plaintext with ${CREDENTIALS_REQUIRED_ENV}=true outside production`, async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    vi.stubEnv(CREDENTIALS_REQUIRED_ENV, "true");
    await expect(encryptCredential("one", GITHUB)).rejects.toThrow(/refusing/);
  });

  it(`stores plaintext in production only with an explicit ${CREDENTIALS_REQUIRED_ENV}=false`, async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CREDENTIALS_REQUIRED_ENV, "false");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await encryptCredential("one", GITHUB)).toBe("one");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses to store plaintext when only old keys are set, even when not required", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, KEY_A);
    vi.stubEnv(CREDENTIALS_REQUIRED_ENV, "false");
    await expect(encryptCredential("one", GITHUB)).rejects.toThrow(
      new RegExp(`${CREDENTIALS_OLD_KEYS_ENV} is set but ${CREDENTIALS_KEY_ENV} is not`),
    );
  });

  it("still reads plaintext with no key set, even in production", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    vi.stubEnv("NODE_ENV", "production");
    expect(await decryptCredential("plain", GITHUB)).toBe("plain");
  });

  it("cannot read encrypted values with no key set", async () => {
    const stored = await encryptCredential("secret", GITHUB);
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    await expect(decryptCredential(stored, GITHUB)).rejects.toThrow(/not configured/);
  });
});

describe("credentialsRequired", () => {
  it.each([
    ["", "production", true],
    ["", "development", false],
    ["", "test", false],
    ["true", "development", true],
    [" TRUE ", "development", true],
    ["false", "production", false],
  ])("%j with NODE_ENV=%s is %s", (flag, nodeEnv, expected) => {
    vi.stubEnv(CREDENTIALS_REQUIRED_ENV, flag);
    vi.stubEnv("NODE_ENV", nodeEnv);
    expect(credentialsRequired()).toBe(expected);
  });

  it.each(["1", "yes", "off"])("throws on %j rather than guessing", (flag) => {
    vi.stubEnv(CREDENTIALS_REQUIRED_ENV, flag);
    expect(() => credentialsRequired()).toThrow(CREDENTIALS_REQUIRED_ENV);
  });
});

describe("strict key parsing", () => {
  const material = randomBytes(32).toString("base64");

  it.each([
    ["no key id", material],
    ["bad key id", `a b:${material}`],
    ["short key", `a:${randomBytes(16).toString("base64")}`],
    ["long key", `a:${randomBytes(33).toString("base64")}`],
    ["missing padding", `a:${material.slice(0, -1)}`],
    ["extra padding", `a:${material}=`],
    ["base64url characters", `a:${"-_".repeat(21)}A=`],
    ["a stray character", `a:${material.slice(0, 20)}!${material.slice(21)}`],
    ["embedded whitespace", `a:${material.slice(0, 20)} ${material.slice(21)}`],
    ["non-canonical final character", `a:${"A".repeat(42)}B=`],
  ])("rejects a current key with %s", async (_label, spec) => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, spec);
    await expect(encryptCredential("x", GITHUB)).rejects.toThrow(CREDENTIALS_KEY_ENV);
  });

  it.each([
    ["short key", `old:${randomBytes(16).toString("base64")}`],
    ["base64url characters", `old:${"-_".repeat(21)}A=`],
    ["a stray character", `old:${material.slice(0, 20)}*${material.slice(21)}`],
  ])("rejects an old key with %s", async (_label, spec) => {
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, spec);
    await expect(decryptCredential(encryptV1ForTests("x", KEY_A), GITHUB)).rejects.toThrow(
      CREDENTIALS_OLD_KEYS_ENV,
    );
  });

  it("never echoes key material in the error", async () => {
    const bad = `a:${material.slice(0, 20)}!${material.slice(21)}`;
    vi.stubEnv(CREDENTIALS_KEY_ENV, bad);
    const error: unknown = await encryptCredential("x", GITHUB).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(material.slice(0, 20));
  });

  it("accepts surrounding whitespace around the spec", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, ` ${KEY_A}\n`);
    expect(await currentCredentialKeyId()).toBe("a");
  });

  it("re-reports a malformed key on the next call instead of caching the failure", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "a:short");
    await expect(encryptCredential("x", GITHUB)).rejects.toThrow();
    await expect(encryptCredential("x", GITHUB)).rejects.toThrow();
    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_A);
    expect(isEncryptedCredential(await encryptCredential("x", GITHUB))).toBe(true);
  });
});

describe("key ids", () => {
  it("reports the current key id, or null with no key", async () => {
    expect(await currentCredentialKeyId()).toBe("a");
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    expect(await currentCredentialKeyId()).toBeNull();
  });

  it("reads the key id off an encrypted value, null for plaintext", async () => {
    expect(credentialKeyId(await encryptCredential("x", GITHUB))).toBe("a");
    expect(credentialKeyId(encryptV1ForTests("x", KEY_B))).toBe("b");
    expect(credentialKeyId("plain")).toBeNull();
  });
});

describe("optional helpers", () => {
  it("pass null and undefined through", async () => {
    expect(await encryptOptionalCredential(null, GITHUB)).toBeNull();
    expect(await encryptOptionalCredential(undefined, GITHUB)).toBeUndefined();
    expect(await decryptOptionalCredential(null, GITHUB)).toBeNull();
    expect(await decryptOptionalCredential(undefined, GITHUB)).toBeUndefined();
  });

  it("encrypt and decrypt strings", async () => {
    const stored = await encryptOptionalCredential("tok", GITHUB);
    expect(isEncryptedCredential(stored)).toBe(true);
    expect(await decryptOptionalCredential(stored, GITHUB)).toBe("tok");
  });
});
