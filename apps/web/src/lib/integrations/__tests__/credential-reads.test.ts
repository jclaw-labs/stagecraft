import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every read site for a stored integration token must decrypt it before
 * it reaches a provider: a ciphertext in an Authorization header would
 * fail at best and leak the stored format at worst. One test per provider
 * module, through a public function that uses the token.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { integrationAccount: { findUnique: vi.fn() } },
}));

vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));

import {
  CREDENTIALS_KEY_ENV,
  encryptCredential,
  resetCredentialCryptoForTests,
} from "../../credential-crypto";
import { findGithubAppInstallation } from "../github";
import { triggerBuild } from "../netlify";
import { getResendCredentials } from "../resend";
import { deleteProject } from "../vercel";

const ORIGINAL_FETCH = globalThis.fetch;
let authHeaders: string[] = [];

function stubFetch(body: unknown, status = 200) {
  authHeaders = [];
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    authHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

async function storeToken(plaintext: string) {
  prismaMock.integrationAccount.findUnique.mockResolvedValue({
    accessToken: await encryptCredential(plaintext),
    metadata: {},
  });
}

beforeEach(() => {
  resetCredentialCryptoForTests();
  vi.stubEnv(CREDENTIALS_KEY_ENV, `k1:${randomBytes(32).toString("base64")}`);
  prismaMock.integrationAccount.findUnique.mockReset();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
});

describe("stored token read sites", () => {
  it("GitHub: sends the decrypted OAuth token", async () => {
    await storeToken("ghp_secret");
    stubFetch({ installations: [] });
    await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(authHeaders).toEqual(["Bearer ghp_secret"]);
  });

  it("Netlify: sends the decrypted OAuth token", async () => {
    await storeToken("netlify_secret");
    stubFetch({ id: "build-1" });
    await triggerBuild("user-1", "site-1");
    expect(authHeaders).toEqual(["Bearer netlify_secret"]);
  });

  it("Vercel: sends the decrypted personal access token", async () => {
    await storeToken("vercel_secret");
    stubFetch(null, 204);
    await deleteProject("user-1", "prj_abc");
    expect(authHeaders).toEqual(["Bearer vercel_secret"]);
  });

  it("Resend: returns the decrypted API key", async () => {
    await storeToken("re_secret");
    expect(await getResendCredentials("user-1")).toEqual({ apiKey: "re_secret" });
  });

  it("still reads legacy plaintext rows", async () => {
    prismaMock.integrationAccount.findUnique.mockResolvedValue({ accessToken: "ghp_legacy" });
    stubFetch({ installations: [] });
    await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(authHeaders).toEqual(["Bearer ghp_legacy"]);
  });

  it("refuses to call the provider with a token it can't decrypt", async () => {
    await storeToken("vercel_secret");
    vi.stubEnv(CREDENTIALS_KEY_ENV, `k2:${randomBytes(32).toString("base64")}`);
    stubFetch(null, 204);
    await expect(deleteProject("user-1", "prj_abc")).rejects.toThrow(/not configured/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
