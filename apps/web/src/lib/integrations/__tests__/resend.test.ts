import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { integrationAccount: { findUnique: vi.fn() } },
}));

vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));

import { getResendCredentials, validateResendToken } from "../resend";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  prismaMock.integrationAccount.findUnique.mockReset();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("validateResendToken", () => {
  it("calls /domains with the bearer + returns the domains array", async () => {
    let capturedAuth = "";
    mockFetch((url, init) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? "";
      expect(url).toBe("https://api.resend.com/domains");
      return {
        status: 200,
        body: {
          data: [
            { id: "d1", name: "stagecraft.website", status: "verified" },
            { id: "d2", name: "pending.test", status: "pending" },
          ],
        },
      };
    });

    const info = await validateResendToken("re_test");
    expect(capturedAuth).toBe("Bearer re_test");
    expect(info.domains).toHaveLength(2);
    expect(info.domains[0].status).toBe("verified");
  });

  it("returns empty domains array when Resend account has none", async () => {
    mockFetch(() => ({ status: 200, body: { data: [] } }));
    const info = await validateResendToken("re_x");
    expect(info.domains).toEqual([]);
  });

  it("throws on a 401 from Resend that isn't a restricted-key signal", async () => {
    mockFetch(() => ({ status: 401, body: { name: "validation_error", message: "invalid api key" } }));
    await expect(validateResendToken("bad")).rejects.toThrow(/Resend API error \(401\)/);
  });

  it("returns {restricted:true, domains:[]} when the key is send-only (Resend's signup default)", async () => {
    mockFetch(() => ({
      status: 401,
      body: {
        statusCode: 401,
        message: "This API key is restricted to only send emails",
        name: "restricted_api_key",
      },
    }));
    const info = await validateResendToken("re_send_only");
    expect(info.restricted).toBe(true);
    expect(info.domains).toEqual([]);
  });

  it("returns {restricted:false} on a successful /domains call", async () => {
    mockFetch(() => ({ status: 200, body: { data: [] } }));
    const info = await validateResendToken("re_full");
    expect(info.restricted).toBe(false);
  });

  it("throws on 500 errors", async () => {
    mockFetch(() => ({ status: 500, body: { error: "internal" } }));
    await expect(validateResendToken("re_x")).rejects.toThrow(/Resend API error \(500\)/);
  });
});

describe("getResendCredentials", () => {
  it("returns null when artist hasn't connected Resend", async () => {
    prismaMock.integrationAccount.findUnique.mockResolvedValue(null);
    const result = await getResendCredentials("user-1");
    expect(result).toBeNull();
  });

  it("returns null when row exists but accessToken is missing", async () => {
    prismaMock.integrationAccount.findUnique.mockResolvedValue({
      accessToken: null,
      metadata: {},
    });
    expect(await getResendCredentials("user-1")).toBeNull();
  });

  it("returns {apiKey} when present (sender is hardcoded; adminEmail lives on User.email)", async () => {
    prismaMock.integrationAccount.findUnique.mockResolvedValue({
      accessToken: "re_x",
      metadata: {},
    });
    const result = await getResendCredentials("user-1");
    expect(result).toEqual({
      apiKey: "re_x",
    });
  });
});
