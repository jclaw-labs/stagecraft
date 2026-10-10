import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock, exchangeMock, cookieStore } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: { integrationAccount: { upsert: vi.fn() } },
  exchangeMock: vi.fn(),
  cookieStore: { get: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/integrations/oauth", () => ({ exchangeNetlifyCode: exchangeMock }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

import { GET } from "../route";
import {
  CREDENTIALS_KEY_ENV,
  decryptCredential,
  integrationCredentialField,
  isEncryptedCredential,
  resetCredentialCryptoForTests,
} from "@/lib/credential-crypto";

const ORIGINAL_FETCH = globalThis.fetch;
const NETLIFY_FIELD = integrationCredentialField("user-1", "netlify");

function callback(query: string): NextRequest {
  return new NextRequest(`http://platform.test/api/integrations/netlify/callback?${query}`);
}

beforeEach(() => {
  resetCredentialCryptoForTests();
  vi.stubEnv(CREDENTIALS_KEY_ENV, `k1:${randomBytes(32).toString("base64")}`);
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  cookieStore.get.mockReturnValue({ value: "state-1" });
  cookieStore.delete.mockReset();
  exchangeMock.mockReset();
  exchangeMock.mockResolvedValue("netlify_secret");
  prismaMock.integrationAccount.upsert.mockReset();
  prismaMock.integrationAccount.upsert.mockResolvedValue({});
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ id: "nl-1", email: "a@example.com", full_name: "A" })),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
});

describe("GET /api/integrations/netlify/callback", () => {
  it("stores the exchanged token encrypted and uses the plaintext for the user lookup", async () => {
    const res = await GET(callback("code=c&state=state-1"));

    expect(res.headers.get("location")).toContain("success=netlify_connected");
    const fetchInit = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(new Headers(fetchInit?.headers).get("authorization")).toBe("Bearer netlify_secret");

    const { update, create } = prismaMock.integrationAccount.upsert.mock.calls[0][0];
    expect(isEncryptedCredential(create.accessToken)).toBe(true);
    expect(update.accessToken).toBe(create.accessToken);
    expect(await decryptCredential(create.accessToken, NETLIFY_FIELD)).toBe("netlify_secret");
    // Bound to user-1's Netlify row: it won't decrypt as another user's.
    await expect(
      decryptCredential(create.accessToken, integrationCredentialField("user-2", "netlify")),
    ).rejects.toThrow(/failed to decrypt/);
    expect(create).toMatchObject({ provider: "netlify", providerAccountId: "nl-1" });
  });

  it("rejects a mismatched state without storing anything", async () => {
    const res = await GET(callback("code=c&state=other"));

    expect(res.headers.get("location")).toContain("error=netlify_invalid_state");
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(prismaMock.integrationAccount.upsert).not.toHaveBeenCalled();
  });
});
