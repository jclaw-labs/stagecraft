import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREDENTIALS_KEY_ENV,
  CREDENTIALS_OLD_KEYS_ENV,
  credentialKeyId,
  decryptCredential,
  encryptCredential,
  isEncryptedCredential,
  resetCredentialCryptoForTests,
} from "../src/lib/credential-crypto";
import { assertAllDecryptable, encryptStoredCredentials, type CredentialStore } from "./encrypt-credentials";

type Row = { id: string } & Record<string, string | null>;

/**
 * In-memory stand-in for the two Prisma delegates the script uses:
 * findMany (id > cursor, ordered, take) and updateMany (compare-and-set).
 */
function fakeTable(rows: Row[]) {
  const store = rows.map((r) => ({ ...r }));
  const findMany = vi.fn(
    async (args: { where?: { id: { gt: string } }; take: number; select: Record<string, true> }) =>
      store
        .filter((r) => !args.where || r.id > args.where.id.gt)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, args.take)
        .map((r) => Object.fromEntries(Object.keys(args.select).map((k) => [k, r[k] ?? null]))),
  );
  const updateMany = vi.fn(
    async (args: { where: Record<string, string>; data: Record<string, string> }) => {
      const row = store.find((r) => Object.entries(args.where).every(([k, v]) => r[k] === v));
      if (!row) return { count: 0 };
      Object.assign(row, args.data);
      return { count: 1 };
    },
  );
  return { store, findMany, updateMany };
}

function newKey(id: string): string {
  return `${id}:${randomBytes(32).toString("base64")}`;
}

const KEY_A = newKey("a");

function makeDb(accounts: Row[], integrations: Row[]) {
  const account = fakeTable(accounts);
  const integrationAccount = fakeTable(integrations);
  const db = { account, integrationAccount } as unknown as CredentialStore;
  return { db, account, integrationAccount };
}

beforeEach(() => {
  resetCredentialCryptoForTests();
  vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_A);
  vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("encryptStoredCredentials", () => {
  it("encrypts plaintext tokens in both tables, leaving nulls alone", async () => {
    const { db, account, integrationAccount } = makeDb(
      [{ id: "acc1", access_token: "gho_1", refresh_token: null, id_token: "idt" }],
      [
        { id: "int1", accessToken: "ghp_x", refreshToken: null },
        { id: "int2", accessToken: "re_y", refreshToken: "rt" },
      ],
    );

    const stats = await encryptStoredCredentials(db);

    expect(stats.account).toEqual({
      rowsScanned: 1,
      valuesEncrypted: 2,
      valuesAlreadyEncrypted: 0,
      undecryptable: 0,
      conflicts: 0,
    });
    expect(stats.integrationAccount.valuesEncrypted).toBe(3);
    const [acc] = account.store;
    expect(isEncryptedCredential(acc.access_token!)).toBe(true);
    expect(await decryptCredential(acc.access_token!)).toBe("gho_1");
    expect(acc.refresh_token).toBeNull();
    expect(await decryptCredential(acc.id_token!)).toBe("idt");
    expect(await decryptCredential(integrationAccount.store[1].refreshToken!)).toBe("rt");
    expect(integrationAccount.store[0].refreshToken).toBeNull();
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { db, account, integrationAccount } = makeDb(
      [{ id: "acc1", access_token: "gho_1", refresh_token: null, id_token: null }],
      [{ id: "int1", accessToken: "ghp_x", refreshToken: null }],
    );
    await encryptStoredCredentials(db);
    const afterFirst = JSON.stringify([account.store, integrationAccount.store]);
    account.updateMany.mockClear();
    integrationAccount.updateMany.mockClear();

    const stats = await encryptStoredCredentials(db);

    expect(JSON.stringify([account.store, integrationAccount.store])).toBe(afterFirst);
    expect(account.updateMany).not.toHaveBeenCalled();
    expect(integrationAccount.updateMany).not.toHaveBeenCalled();
    expect(stats.account.valuesAlreadyEncrypted).toBe(1);
    expect(stats.integrationAccount.valuesAlreadyEncrypted).toBe(1);
  });

  it("only updates the plaintext column of a partly encrypted row", async () => {
    const encrypted = await encryptCredential("already");
    const { db, integrationAccount } = makeDb([], [{ id: "int1", accessToken: encrypted, refreshToken: "plain" }]);

    await encryptStoredCredentials(db);

    expect(integrationAccount.updateMany).toHaveBeenCalledTimes(1);
    const { data, where } = integrationAccount.updateMany.mock.calls[0][0];
    expect(Object.keys(data)).toEqual(["refreshToken"]);
    expect(where).toEqual({ id: "int1", refreshToken: "plain" });
    expect(integrationAccount.store[0].accessToken).toBe(encrypted);
  });

  it("pages through rows in batches", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `int${i}`,
      accessToken: `tok${i}`,
      refreshToken: null,
    }));
    const { db, integrationAccount } = makeDb([], rows);

    const stats = await encryptStoredCredentials(db, { batchSize: 2 });

    expect(stats.integrationAccount.rowsScanned).toBe(5);
    expect(integrationAccount.findMany).toHaveBeenCalledTimes(3);
    for (const row of integrationAccount.store) {
      expect(isEncryptedCredential(row.accessToken!)).toBe(true);
    }
  });

  it("leaves a row alone if it changed between read and write", async () => {
    const { db, integrationAccount } = makeDb([], [{ id: "int1", accessToken: "old", refreshToken: null }]);
    const realFind = integrationAccount.findMany.getMockImplementation()!;
    integrationAccount.findMany.mockImplementationOnce(async (args) => {
      const result = await realFind(args);
      integrationAccount.store[0].accessToken = "rewritten-by-sign-in";
      return result;
    });

    const stats = await encryptStoredCredentials(db);

    expect(stats.integrationAccount.conflicts).toBe(1);
    expect(stats.integrationAccount.valuesEncrypted).toBe(0);
    expect(integrationAccount.store[0].accessToken).toBe("rewritten-by-sign-in");
  });

  it("writes nothing on a dry run", async () => {
    const { db, integrationAccount } = makeDb([], [{ id: "int1", accessToken: "plain", refreshToken: null }]);

    const stats = await encryptStoredCredentials(db, { dryRun: true });

    expect(stats.integrationAccount.valuesEncrypted).toBe(1);
    expect(integrationAccount.updateMany).not.toHaveBeenCalled();
    expect(integrationAccount.store[0].accessToken).toBe("plain");
  });

  it("refuses to run without a key", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    const { db, integrationAccount } = makeDb([], [{ id: "int1", accessToken: "plain", refreshToken: null }]);

    await expect(encryptStoredCredentials(db)).rejects.toThrow(CREDENTIALS_KEY_ENV);
    expect(integrationAccount.findMany).not.toHaveBeenCalled();
  });

  it("re-encrypts old-key values with --rotate only", async () => {
    const underA = await encryptCredential("tok");
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("b"));
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, KEY_A);
    const { db, integrationAccount } = makeDb([], [{ id: "int1", accessToken: underA, refreshToken: null }]);

    await encryptStoredCredentials(db);
    expect(integrationAccount.store[0].accessToken).toBe(underA);

    await encryptStoredCredentials(db, { rotate: true });
    const rotated = integrationAccount.store[0].accessToken!;
    expect(credentialKeyId(rotated)).toBe("b");
    expect(await decryptCredential(rotated)).toBe("tok");
  });

  it("with --rotate, skips a value it can't decrypt, names its row and rotates the rest", async () => {
    const underA = await encryptCredential("tok-a");
    resetCredentialCryptoForTests();
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("x"));
    const underX = await encryptCredential("tok-x");
    resetCredentialCryptoForTests();
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("b"));
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, KEY_A);
    const { db, integrationAccount } = makeDb(
      [],
      [
        { id: "int1", accessToken: underX, refreshToken: null },
        { id: "int2", accessToken: "enc:v1:a:not-a-real-value", refreshToken: null },
        { id: "int3", accessToken: underA, refreshToken: null },
      ],
    );
    const lines: string[] = [];

    const stats = await encryptStoredCredentials(db, { rotate: true, log: (line) => lines.push(line) });

    expect(stats.integrationAccount.undecryptable).toBe(2);
    expect(stats.integrationAccount.valuesEncrypted).toBe(1);
    expect(stats.integrationAccount.valuesAlreadyEncrypted).toBe(0);
    expect(integrationAccount.store[0].accessToken).toBe(underX);
    expect(integrationAccount.store[1].accessToken).toBe("enc:v1:a:not-a-real-value");
    const rotated = integrationAccount.store[2].accessToken!;
    expect(credentialKeyId(rotated)).toBe("b");
    expect(await decryptCredential(rotated)).toBe("tok-a");
    expect(lines).toContainEqual(expect.stringContaining("IntegrationAccount int1.accessToken: cannot decrypt"));
    expect(lines).toContainEqual(expect.stringContaining('key "x"'));
    expect(lines).toContainEqual(expect.stringContaining("IntegrationAccount int2.accessToken: cannot decrypt"));
    expect(lines).toContainEqual(expect.stringContaining("2 undecryptable"));
  });

  it("without --rotate, counts an undecryptable value separately from encrypted ones", async () => {
    const { db, account } = makeDb(
      [{ id: "acc1", access_token: "enc:v1:gone:aaaa:bbbb:cccc", refresh_token: "plain", id_token: null }],
      [],
    );

    const stats = await encryptStoredCredentials(db);

    expect(stats.account.undecryptable).toBe(1);
    expect(stats.account.valuesAlreadyEncrypted).toBe(0);
    expect(stats.account.valuesEncrypted).toBe(1);
    expect(account.store[0].access_token).toBe("enc:v1:gone:aaaa:bbbb:cccc");
    expect(await decryptCredential(account.store[0].refresh_token!)).toBe("plain");
  });
});

describe("assertAllDecryptable", () => {
  const clean = { rowsScanned: 1, valuesEncrypted: 0, valuesAlreadyEncrypted: 1, undecryptable: 0, conflicts: 0 };

  it("passes when every value decrypted", () => {
    expect(() => assertAllDecryptable({ account: clean, integrationAccount: clean })).not.toThrow();
  });

  it("throws with the total when either table has undecryptable values", () => {
    expect(() =>
      assertAllDecryptable({
        account: { ...clean, undecryptable: 1 },
        integrationAccount: { ...clean, undecryptable: 2 },
      }),
    ).toThrow(/^3 stored value\(s\) could not be decrypted/);
    expect(() =>
      assertAllDecryptable({ account: clean, integrationAccount: { ...clean, undecryptable: 1 } }),
    ).toThrow(CREDENTIALS_OLD_KEYS_ENV);
  });
});
