import { randomBytes } from "node:crypto";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { integrationAccount: { upsert: vi.fn() } },
}));

vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));

import { upsertGithubIntegration, withEncryptedAccountTokens } from "../auth-credentials";
import {
  CREDENTIALS_KEY_ENV,
  CREDENTIALS_REQUIRED_ENV,
  decryptCredential,
  integrationCredentialField,
  isEncryptedCredential,
  resetCredentialCryptoForTests,
  type AccountCredentialField,
  type AccountTokenColumn,
} from "../credential-crypto";

function accountField(column: AccountTokenColumn, providerAccountId = "123"): AccountCredentialField {
  return { table: "Account", provider: "github", providerAccountId, column };
}

const ACCOUNT: AdapterAccount = {
  userId: "user-1",
  type: "oauth",
  provider: "github",
  providerAccountId: "123",
  access_token: "gho_access",
  refresh_token: "ghr_refresh",
  id_token: undefined,
  token_type: "bearer",
  scope: "repo",
};

beforeEach(() => {
  resetCredentialCryptoForTests();
  vi.stubEnv(CREDENTIALS_KEY_ENV, `k1:${randomBytes(32).toString("base64")}`);
  prismaMock.integrationAccount.upsert.mockReset();
  prismaMock.integrationAccount.upsert.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("withEncryptedAccountTokens", () => {
  it("encrypts access, refresh and id tokens before linkAccount stores them", async () => {
    const linkAccount = vi.fn(async (account: AdapterAccount) => account);
    const adapter = withEncryptedAccountTokens({ linkAccount } as Adapter);

    await adapter.linkAccount!({ ...ACCOUNT, id_token: "idt" });

    const stored = linkAccount.mock.calls[0][0];
    for (const field of ["access_token", "refresh_token", "id_token"] as const) {
      expect(isEncryptedCredential(stored[field]!)).toBe(true);
    }
    expect(await decryptCredential(stored.access_token!, accountField("access_token"))).toBe("gho_access");
    expect(await decryptCredential(stored.refresh_token!, accountField("refresh_token"))).toBe("ghr_refresh");
    expect(await decryptCredential(stored.id_token!, accountField("id_token"))).toBe("idt");
    // Each value is bound to its own column and row.
    await expect(decryptCredential(stored.access_token!, accountField("refresh_token"))).rejects.toThrow(
      /failed to decrypt/,
    );
    await expect(
      decryptCredential(stored.access_token!, accountField("access_token", "999")),
    ).rejects.toThrow(/failed to decrypt/);
    // Everything else passes through untouched.
    expect(stored).toMatchObject({ userId: "user-1", provider: "github", scope: "repo" });
  });

  it("leaves absent tokens absent and doesn't mutate the caller's account", async () => {
    const linkAccount = vi.fn(async (account: AdapterAccount) => account);
    const adapter = withEncryptedAccountTokens({ linkAccount } as Adapter);
    const account = { ...ACCOUNT };

    await adapter.linkAccount!(account);

    expect(linkAccount.mock.calls[0][0].id_token).toBeUndefined();
    expect(account.access_token).toBe("gho_access");
  });

  it("keeps the other adapter methods", () => {
    const getUser = vi.fn();
    const adapter = withEncryptedAccountTokens({ getUser, linkAccount: vi.fn() } as unknown as Adapter);
    expect(adapter.getUser).toBe(getUser);
  });

  it("returns an adapter without linkAccount unchanged", () => {
    const base = { getUser: vi.fn() } as unknown as Adapter;
    expect(withEncryptedAccountTokens(base)).toBe(base);
  });
});

describe("upsertGithubIntegration", () => {
  it("stores the GitHub token encrypted on create and update", async () => {
    await upsertGithubIntegration({
      userId: "user-1",
      accessToken: "gho_access",
      githubUser: { id: 42, login: "jclaw" },
    });

    const args = prismaMock.integrationAccount.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId_provider: { userId: "user-1", provider: "github" } });
    expect(isEncryptedCredential(args.create.accessToken)).toBe(true);
    expect(args.update.accessToken).toBe(args.create.accessToken);
    expect(
      await decryptCredential(args.create.accessToken, integrationCredentialField("user-1", "github")),
    ).toBe("gho_access");
    expect(args.create).toMatchObject({
      provider: "github",
      providerAccountId: "42",
      scopes: "repo workflow",
      metadata: { login: "jclaw" },
    });
  });

  it("stores plaintext (with a warning) when no key is set, so sign-in keeps working", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await upsertGithubIntegration({
      userId: "user-1",
      accessToken: "gho_access",
      githubUser: { id: 42, login: "jclaw" },
    });

    expect(prismaMock.integrationAccount.upsert.mock.calls[0][0].create.accessToken).toBe("gho_access");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses to store plaintext when credentials are required and no key is set", async () => {
    vi.stubEnv(CREDENTIALS_KEY_ENV, "");
    vi.stubEnv(CREDENTIALS_REQUIRED_ENV, "true");

    await expect(
      upsertGithubIntegration({
        userId: "user-1",
        accessToken: "gho_access",
        githubUser: { id: 42, login: "jclaw" },
      }),
    ).rejects.toThrow(CREDENTIALS_KEY_ENV);
    expect(prismaMock.integrationAccount.upsert).not.toHaveBeenCalled();
  });
});
