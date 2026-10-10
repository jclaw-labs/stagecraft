import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CREDENTIALS_ACCEPT_V1_ENV,
  CREDENTIALS_KEY_ENV,
  CREDENTIALS_OLD_KEYS_ENV,
  credentialFormat,
  credentialKeyId,
  decryptCredential,
  encryptCredential,
  integrationCredentialField,
  isEncryptedCredential,
  resetCredentialCryptoForTests,
  type AccountCredentialField,
  type AccountTokenColumn,
  type IntegrationCredentialField,
  type IntegrationTokenColumn,
} from "../src/lib/credential-crypto";
import { encryptV1ForTests, newCredentialKey as newKey } from "../src/lib/__tests__/credential-test-helpers";
import {
  assertAllDecryptable,
  encryptStoredCredentials,
  main,
  type CredentialStore,
  type TableStats,
} from "./encrypt-credentials";

const mockDb = vi.hoisted(() => ({ prisma: null as unknown }));
vi.mock("@stagecraft/db", () => mockDb);

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

const KEY_A = newKey("a");

/** An `Account` row for GitHub user `ghId`, tokens as given. */
function accountRow(
  id: string,
  ghId: string,
  tokens: Partial<Record<AccountTokenColumn, string | null>>,
): Row {
  return {
    id,
    provider: "github",
    providerAccountId: ghId,
    access_token: null,
    refresh_token: null,
    id_token: null,
    ...tokens,
  };
}

function accountField(ghId: string, column: AccountTokenColumn): AccountCredentialField {
  return { table: "Account", provider: "github", providerAccountId: ghId, column };
}

/** An `IntegrationAccount` row whose userId is `user-<id>`. */
function integrationRow(
  id: string,
  tokens: Partial<Record<IntegrationTokenColumn, string | null>>,
  provider = "github",
): Row {
  return { id, userId: `user-${id}`, provider, accessToken: null, refreshToken: null, ...tokens };
}

function integrationField(
  id: string,
  column: IntegrationTokenColumn = "accessToken",
): IntegrationCredentialField {
  return integrationCredentialField(`user-${id}`, "github", column);
}

function makeDb(accounts: Row[], integrations: Row[]) {
  const account = fakeTable(accounts);
  const integrationAccount = fakeTable(integrations);
  const db = { account, integrationAccount } as unknown as CredentialStore;
  return { db, account, integrationAccount };
}

const ZERO: TableStats = {
  rowsScanned: 0,
  valuesEncrypted: 0,
  valuesUpgraded: 0,
  valuesRotated: 0,
  valuesAlreadyEncrypted: 0,
  v1LeftAsIs: 0,
  undecryptable: 0,
  unbindable: 0,
  conflicts: 0,
};

beforeEach(() => {
  resetCredentialCryptoForTests();
  vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_A);
  vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, "");
  vi.stubEnv(CREDENTIALS_ACCEPT_V1_ENV, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("encryptStoredCredentials", () => {
  it("encrypts plaintext tokens in both tables as v2, bound to their rows, leaving nulls alone", async () => {
    const { db, account, integrationAccount } = makeDb(
      [accountRow("acc1", "42", { access_token: "gho_1", id_token: "idt" })],
      [
        integrationRow("int1", { accessToken: "ghp_x" }),
        integrationRow("int2", { accessToken: "re_y", refreshToken: "rt" }),
      ],
    );

    const stats = await encryptStoredCredentials(db);

    expect(stats.account).toEqual({ ...ZERO, rowsScanned: 1, valuesEncrypted: 2 });
    expect(stats.integrationAccount.valuesEncrypted).toBe(3);
    const [acc] = account.store;
    expect(credentialFormat(acc.access_token!)).toBe("v2");
    expect(await decryptCredential(acc.access_token!, accountField("42", "access_token"))).toBe("gho_1");
    expect(acc.refresh_token).toBeNull();
    expect(await decryptCredential(acc.id_token!, accountField("42", "id_token"))).toBe("idt");
    expect(
      await decryptCredential(
        integrationAccount.store[1].refreshToken!,
        integrationField("int2", "refreshToken"),
      ),
    ).toBe("rt");
    expect(integrationAccount.store[0].refreshToken).toBeNull();
    // Bound: int1's token doesn't decrypt as int2's.
    await expect(
      decryptCredential(integrationAccount.store[0].accessToken!, integrationField("int2")),
    ).rejects.toThrow(/failed to decrypt/);
  });

  it("upgrades v1 values to v2 under the current key with --upgrade-v1, without --rotate", async () => {
    const v1Access = encryptV1ForTests("gho_old", KEY_A);
    const v1Integration = encryptV1ForTests("ghp_old", KEY_A);
    const { db, account, integrationAccount } = makeDb(
      [accountRow("acc1", "42", { access_token: v1Access })],
      [integrationRow("int1", { accessToken: v1Integration })],
    );

    const stats = await encryptStoredCredentials(db, { upgradeV1: true });

    expect(stats.account).toEqual({ ...ZERO, rowsScanned: 1, valuesUpgraded: 1 });
    expect(stats.integrationAccount).toEqual({ ...ZERO, rowsScanned: 1, valuesUpgraded: 1 });
    const upgraded = integrationAccount.store[0].accessToken!;
    expect(credentialFormat(upgraded)).toBe("v2");
    expect(await decryptCredential(upgraded, integrationField("int1"))).toBe("ghp_old");
    await expect(decryptCredential(upgraded, integrationField("other"))).rejects.toThrow(
      /failed to decrypt/,
    );
    const upgradedAccess = account.store[0].access_token!;
    expect(credentialFormat(upgradedAccess)).toBe("v2");
    expect(await decryptCredential(upgradedAccess, accountField("42", "access_token"))).toBe("gho_old");
  });

  it("upgrades v1 values under an old key to v2 under the current key", async () => {
    const v1 = encryptV1ForTests("tok", KEY_A);
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("b"));
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, KEY_A);
    const { db, integrationAccount } = makeDb([], [integrationRow("int1", { accessToken: v1 })]);

    await encryptStoredCredentials(db, { upgradeV1: true });

    const upgraded = integrationAccount.store[0].accessToken!;
    expect(credentialFormat(upgraded)).toBe("v2");
    expect(credentialKeyId(upgraded)).toBe("b");
    expect(await decryptCredential(upgraded, integrationField("int1"))).toBe("tok");
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { db, account, integrationAccount } = makeDb(
      [accountRow("acc1", "42", { access_token: "gho_1", refresh_token: encryptV1ForTests("r", KEY_A) })],
      [integrationRow("int1", { accessToken: "ghp_x" })],
    );
    await encryptStoredCredentials(db, { upgradeV1: true });
    const afterFirst = JSON.stringify([account.store, integrationAccount.store]);
    account.updateMany.mockClear();
    integrationAccount.updateMany.mockClear();

    const stats = await encryptStoredCredentials(db);

    expect(JSON.stringify([account.store, integrationAccount.store])).toBe(afterFirst);
    expect(account.updateMany).not.toHaveBeenCalled();
    expect(integrationAccount.updateMany).not.toHaveBeenCalled();
    expect(stats.account.valuesAlreadyEncrypted).toBe(2);
    expect(stats.integrationAccount.valuesAlreadyEncrypted).toBe(1);
  });

  it("only updates the columns that need it in a partly encrypted row", async () => {
    const encrypted = await encryptCredential("already", integrationField("int1"));
    const { db, integrationAccount } = makeDb(
      [],
      [integrationRow("int1", { accessToken: encrypted, refreshToken: "plain" })],
    );

    await encryptStoredCredentials(db);

    expect(integrationAccount.updateMany).toHaveBeenCalledTimes(1);
    const { data, where } = integrationAccount.updateMany.mock.calls[0][0];
    expect(Object.keys(data)).toEqual(["refreshToken"]);
    expect(where).toEqual({ id: "int1", refreshToken: "plain" });
    expect(integrationAccount.store[0].accessToken).toBe(encrypted);
  });

  it("counts a v2 value copied from another row as undecryptable and leaves it", async () => {
    const fromOtherRow = await encryptCredential("tok", integrationField("int2"));
    const { db, integrationAccount } = makeDb([], [integrationRow("int1", { accessToken: fromOtherRow })]);
    const lines: string[] = [];

    const stats = await encryptStoredCredentials(db, { log: (line) => lines.push(line) });

    expect(stats.integrationAccount.undecryptable).toBe(1);
    expect(integrationAccount.store[0].accessToken).toBe(fromOtherRow);
    expect(lines).toContainEqual(
      expect.stringContaining("IntegrationAccount int1.accessToken: cannot decrypt"),
    );
  });

  it("skips and reports token values in rows whose provider isn't known", async () => {
    const { db, integrationAccount } = makeDb(
      [],
      [
        integrationRow("int1", { accessToken: "plain" }, "myspace"),
        integrationRow("int2", {}, "myspace"),
      ],
    );
    const lines: string[] = [];

    const stats = await encryptStoredCredentials(db, { log: (line) => lines.push(line) });

    expect(stats.integrationAccount.unbindable).toBe(1);
    expect(integrationAccount.store[0].accessToken).toBe("plain");
    expect(lines).toContainEqual(expect.stringContaining("int1.accessToken: unknown provider"));
    expect(() => assertAllDecryptable(stats)).toThrow(/unknown provider/);
  });

  it("pages through rows in batches", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => integrationRow(`int${i}`, { accessToken: `tok${i}` }));
    const { db, integrationAccount } = makeDb([], rows);

    const stats = await encryptStoredCredentials(db, { batchSize: 2 });

    expect(stats.integrationAccount.rowsScanned).toBe(5);
    expect(integrationAccount.findMany).toHaveBeenCalledTimes(3);
    for (const row of integrationAccount.store) {
      expect(isEncryptedCredential(row.accessToken!)).toBe(true);
    }
  });

  it("leaves a row alone if it changed between read and write", async () => {
    const { db, integrationAccount } = makeDb(
      [],
      [integrationRow("int1", { accessToken: "old", refreshToken: encryptV1ForTests("r", KEY_A) })],
    );
    const realFind = integrationAccount.findMany.getMockImplementation()!;
    integrationAccount.findMany.mockImplementationOnce(async (args) => {
      const result = await realFind(args);
      integrationAccount.store[0].accessToken = "rewritten-by-sign-in";
      return result;
    });

    const stats = await encryptStoredCredentials(db, { upgradeV1: true });

    expect(stats.integrationAccount.conflicts).toBe(1);
    expect(stats.integrationAccount.valuesEncrypted).toBe(0);
    expect(stats.integrationAccount.valuesUpgraded).toBe(0);
    expect(integrationAccount.store[0].accessToken).toBe("rewritten-by-sign-in");
  });

  it("writes nothing on a dry run", async () => {
    const v1 = encryptV1ForTests("r", KEY_A);
    const { db, integrationAccount } = makeDb(
      [],
      [integrationRow("int1", { accessToken: "plain", refreshToken: v1 })],
    );
    const lines: string[] = [];

    const stats = await encryptStoredCredentials(db, {
      dryRun: true,
      upgradeV1: true,
      log: (line) => lines.push(line),
    });

    expect(stats.integrationAccount.valuesEncrypted).toBe(1);
    expect(stats.integrationAccount.valuesUpgraded).toBe(1);
    expect(integrationAccount.updateMany).not.toHaveBeenCalled();
    expect(integrationAccount.store[0]).toMatchObject({ accessToken: "plain", refreshToken: v1 });
    expect(lines).toContainEqual(expect.stringContaining("dry run"));
  });

  it("refuses to run without a key", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    const { db, integrationAccount } = makeDb([], [integrationRow("int1", { accessToken: "plain" })]);

    await expect(encryptStoredCredentials(db)).rejects.toThrow(CREDENTIALS_KEY_ENV);
    expect(integrationAccount.findMany).not.toHaveBeenCalled();
  });

  it("re-encrypts v2 values under an old key with --rotate only", async () => {
    const underA = await encryptCredential("tok", integrationField("int1"));
    const KEY_B = newKey("b");
    vi.stubEnv(CREDENTIALS_KEY_ENV, KEY_B);
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, KEY_A);
    const underB = await encryptCredential("tok-b", integrationField("int2"));
    const { db, integrationAccount } = makeDb(
      [],
      [
        integrationRow("int1", { accessToken: underA }),
        integrationRow("int2", { accessToken: underB }),
      ],
    );

    await encryptStoredCredentials(db);
    expect(integrationAccount.store[0].accessToken).toBe(underA);

    integrationAccount.updateMany.mockClear();
    const stats = await encryptStoredCredentials(db, { rotate: true });
    expect(stats.integrationAccount.valuesRotated).toBe(1);
    const rotated = integrationAccount.store[0].accessToken!;
    expect(credentialKeyId(rotated)).toBe("b");
    expect(await decryptCredential(rotated, integrationField("int1"))).toBe("tok");
    // A value already under the current key is left exactly as it was.
    expect(stats.integrationAccount.valuesAlreadyEncrypted).toBe(1);
    expect(integrationAccount.store[1].accessToken).toBe(underB);
    expect(integrationAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(integrationAccount.updateMany.mock.calls[0][0].where.id).toBe("int1");
  });

  it("with --rotate, skips a value it can't decrypt, names its row and rotates the rest", async () => {
    const underA = await encryptCredential("tok-a", integrationField("int3"));
    resetCredentialCryptoForTests();
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("x"));
    const underX = await encryptCredential("tok-x", integrationField("int1"));
    resetCredentialCryptoForTests();
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("b"));
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, KEY_A);
    const { db, integrationAccount } = makeDb(
      [],
      [
        integrationRow("int1", { accessToken: underX }),
        integrationRow("int2", { accessToken: "enc:v2:a:not-a-real-value" }),
        integrationRow("int3", { accessToken: underA }),
      ],
    );
    const lines: string[] = [];

    const stats = await encryptStoredCredentials(db, { rotate: true, log: (line) => lines.push(line) });

    expect(stats.integrationAccount.undecryptable).toBe(2);
    expect(stats.integrationAccount.valuesRotated).toBe(1);
    expect(stats.integrationAccount.valuesAlreadyEncrypted).toBe(0);
    expect(integrationAccount.store[0].accessToken).toBe(underX);
    expect(integrationAccount.store[1].accessToken).toBe("enc:v2:a:not-a-real-value");
    const rotated = integrationAccount.store[2].accessToken!;
    expect(credentialKeyId(rotated)).toBe("b");
    expect(await decryptCredential(rotated, integrationField("int3"))).toBe("tok-a");
    expect(lines).toContainEqual(
      expect.stringContaining("IntegrationAccount int1.accessToken: cannot decrypt"),
    );
    expect(lines).toContainEqual(expect.stringContaining('key "x"'));
    expect(lines).toContainEqual(
      expect.stringContaining("IntegrationAccount int2.accessToken: cannot decrypt"),
    );
    expect(lines).toContainEqual(expect.stringContaining("2 undecryptable"));
  });

  it("counts an undecryptable v1 value separately from encrypted ones", async () => {
    const { db, account } = makeDb(
      [accountRow("acc1", "42", { access_token: "enc:v1:gone:aaaa:bbbb:cccc", refresh_token: "plain" })],
      [],
    );

    const stats = await encryptStoredCredentials(db, { upgradeV1: true });

    expect(stats.account.undecryptable).toBe(1);
    expect(stats.account.valuesAlreadyEncrypted).toBe(0);
    expect(stats.account.valuesUpgraded).toBe(0);
    expect(stats.account.valuesEncrypted).toBe(1);
    expect(account.store[0].access_token).toBe("enc:v1:gone:aaaa:bbbb:cccc");
    expect(
      await decryptCredential(account.store[0].refresh_token!, accountField("42", "refresh_token")),
    ).toBe("plain");
  });
});

describe("encryptStoredCredentials without --upgrade-v1", () => {
  it("doesn't re-bind a v1 copy pasted into another row during a --rotate, with the flag unset in the shell", async () => {
    // The victim's v1 value from a pre-backfill dump, written under the old key.
    const victimsV1 = encryptV1ForTests("re_victim", KEY_A);
    vi.stubEnv(CREDENTIALS_KEY_ENV, newKey("b"));
    vi.stubEnv(CREDENTIALS_OLD_KEYS_ENV, KEY_A);
    const { db, integrationAccount } = makeDb(
      [],
      [integrationRow("attacker", { accessToken: victimsV1 }, "resend")],
    );
    const lines: string[] = [];

    const stats = await encryptStoredCredentials(db, { rotate: true, log: (line) => lines.push(line) });

    expect(stats.integrationAccount).toEqual({ ...ZERO, rowsScanned: 1, v1LeftAsIs: 1 });
    expect(integrationAccount.store[0].accessToken).toBe(victimsV1);
    expect(integrationAccount.updateMany).not.toHaveBeenCalled();
    expect(lines).toContainEqual(
      expect.stringContaining("IntegrationAccount attacker.accessToken: legacy v1 value, left as is"),
    );
    expect(() => assertAllDecryptable(stats)).toThrow(/^1 legacy v1 value\(s\) were left as they are/);
  });

  it("doesn't word the per-row line as an instruction to re-run with --upgrade-v1", async () => {
    const v1 = encryptV1ForTests("r", KEY_A);
    const { db } = makeDb([], [integrationRow("int1", { accessToken: v1 })]);
    const lines: string[] = [];

    await encryptStoredCredentials(db, { log: (line) => lines.push(line) });

    const rowLine = lines.find((line) => line.startsWith("IntegrationAccount int1.accessToken"));
    expect(rowLine).toBeDefined();
    expect(rowLine).not.toContain("--upgrade-v1");
    expect(rowLine).toMatch(/after step 5, have the user reconnect/);
  });

  it("counts v1 values apart from undecryptable ones in the summary", async () => {
    const v1 = encryptV1ForTests("r", KEY_A);
    const { db } = makeDb(
      [],
      [
        integrationRow("int1", { accessToken: v1 }),
        integrationRow("int2", { accessToken: "enc:v2:gone:aaaa:bbbb:cccc" }),
      ],
    );
    const lines: string[] = [];

    const stats = await encryptStoredCredentials(db, { log: (line) => lines.push(line) });

    expect(stats.integrationAccount).toEqual({ ...ZERO, rowsScanned: 2, v1LeftAsIs: 1, undecryptable: 1 });
    expect(lines).toContainEqual(expect.stringContaining("1 v1 left as is, 1 undecryptable"));
  });

  it("lists a v1 value on a dry run too", async () => {
    const v1 = encryptV1ForTests("r", KEY_A);
    const { db } = makeDb([], [integrationRow("int1", { accessToken: v1, refreshToken: "plain" })]);

    const stats = await encryptStoredCredentials(db, { dryRun: true });

    expect(stats.integrationAccount).toEqual({ ...ZERO, rowsScanned: 1, valuesEncrypted: 1, v1LeftAsIs: 1 });
  });
});

describe(`encryptStoredCredentials with ${CREDENTIALS_ACCEPT_V1_ENV}=false`, () => {
  it("doesn't upgrade a v1 value even with --upgrade-v1: it lists it as a v1 value and leaves it", async () => {
    vi.stubEnv(CREDENTIALS_ACCEPT_V1_ENV, "false");
    const v1 = encryptV1ForTests("ghp_old", KEY_A);
    const { db, integrationAccount } = makeDb(
      [],
      [integrationRow("int1", { accessToken: v1, refreshToken: "plain" })],
    );
    const lines: string[] = [];

    const stats = await encryptStoredCredentials(db, { upgradeV1: true, log: (line) => lines.push(line) });

    expect(stats.integrationAccount).toEqual({
      ...ZERO,
      rowsScanned: 1,
      valuesEncrypted: 1,
      v1LeftAsIs: 1,
    });
    expect(integrationAccount.store[0].accessToken).toBe(v1);
    expect(lines).toContainEqual(
      expect.stringContaining(
        `IntegrationAccount int1.accessToken: legacy v1 value, left as is: ${CREDENTIALS_ACCEPT_V1_ENV}=false`,
      ),
    );
    expect(() => assertAllDecryptable(stats)).toThrow(/legacy v1 value\(s\) were left as they are/);
  });

  it("fails up front on a value other than true or false, instead of blaming a missing key", async () => {
    vi.stubEnv(CREDENTIALS_ACCEPT_V1_ENV, "flase");
    const v1 = encryptV1ForTests("ghp_old", KEY_A);
    const { db, integrationAccount } = makeDb([], [integrationRow("int1", { accessToken: v1 })]);

    await expect(encryptStoredCredentials(db, { upgradeV1: true })).rejects.toThrow(
      `${CREDENTIALS_ACCEPT_V1_ENV} must be "true" or "false"`,
    );
    expect(integrationAccount.store[0].accessToken).toBe(v1);
  });

  it.each([
    ["a --rotate run", { rotate: true }],
    ["a plain run", {}],
  ])("fails up front on a value other than true or false in %s too, before any row is touched", async (_, options) => {
    vi.stubEnv(CREDENTIALS_ACCEPT_V1_ENV, "flase");
    const { db, account, integrationAccount } = makeDb(
      [accountRow("acc1", "42", { access_token: "plain" })],
      [integrationRow("int1", { accessToken: "plain" })],
    );

    await expect(encryptStoredCredentials(db, options)).rejects.toThrow(
      `${CREDENTIALS_ACCEPT_V1_ENV} must be "true" or "false"`,
    );
    expect(account.store[0].access_token).toBe("plain");
    expect(integrationAccount.store[0].accessToken).toBe("plain");
  });
});

describe("assertAllDecryptable", () => {
  const clean: TableStats = { ...ZERO, rowsScanned: 1, valuesAlreadyEncrypted: 1 };

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

  it("throws on v1 values left as they are without blaming a missing key", () => {
    const check = () =>
      assertAllDecryptable({
        account: { ...clean, v1LeftAsIs: 1 },
        integrationAccount: { ...clean, v1LeftAsIs: 1 },
      });
    expect(check).toThrow(/^2 legacy v1 value\(s\) were left as they are/);
    expect(check).not.toThrow(CREDENTIALS_OLD_KEYS_ENV);
    expect(check).not.toThrow("--upgrade-v1");
  });
});

describe("main", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits with an error after the run when a stored value can't be decrypted", async () => {
    const { db, integrationAccount } = makeDb(
      [],
      [
        integrationRow("int1", { accessToken: "enc:v1:gone:aaaa:bbbb:cccc" }),
        integrationRow("int2", { accessToken: "plain" }),
      ],
    );
    const $disconnect = vi.fn(async () => {});
    mockDb.prisma = { ...db, $disconnect };
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["--upgrade-v1"])).rejects.toThrow(/^1 stored value\(s\) could not be decrypted/);
    expect(isEncryptedCredential(integrationAccount.store[1].accessToken!)).toBe(true);
    expect($disconnect).toHaveBeenCalledTimes(1);
  });

  it("succeeds when every value decrypts", async () => {
    const { db } = makeDb([], [integrationRow("int1", { accessToken: "plain" })]);
    mockDb.prisma = { ...db, $disconnect: vi.fn(async () => {}) };
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main([])).resolves.toBeUndefined();
  });

  it("upgrades v1 values only when given --upgrade-v1", async () => {
    const v1 = encryptV1ForTests("ghp_old", KEY_A);
    const { db, integrationAccount } = makeDb([], [integrationRow("int1", { accessToken: v1 })]);
    mockDb.prisma = { ...db, $disconnect: vi.fn(async () => {}) };
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["--rotate"])).rejects.toThrow(/^1 legacy v1 value\(s\) were left as they are/);
    expect(integrationAccount.store[0].accessToken).toBe(v1);

    await expect(main(["--upgrade-v1"])).resolves.toBeUndefined();
    const upgraded = integrationAccount.store[0].accessToken!;
    expect(credentialFormat(upgraded)).toBe("v2");
    expect(await decryptCredential(upgraded, integrationField("int1"))).toBe("ghp_old");
  });

  it("rejects unknown flags before touching the database", async () => {
    const { db, integrationAccount } = makeDb([], [integrationRow("int1", { accessToken: "plain" })]);
    mockDb.prisma = { ...db, $disconnect: vi.fn(async () => {}) };

    await expect(main(["--rotat"])).rejects.toThrow("Unknown argument(s): --rotat");
    expect(integrationAccount.findMany).not.toHaveBeenCalled();
    expect(integrationAccount.store[0].accessToken).toBe("plain");
  });
});
