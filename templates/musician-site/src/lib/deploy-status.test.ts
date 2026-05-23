import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeployStatusError, fetchDeployStatus } from "./deploy-status";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.STAGECRAFT_PLATFORM_URL;
  delete process.env.STAGECRAFT_SITE_ID;
  delete process.env.STAGECRAFT_BROKER_SECRET;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = ORIGINAL_ENV;
});

function configurePlatform() {
  process.env.STAGECRAFT_PLATFORM_URL = "https://platform.test";
  process.env.STAGECRAFT_SITE_ID = "site-1";
  process.env.STAGECRAFT_BROKER_SECRET = "secret-xyz";
}

describe("fetchDeployStatus", () => {
  it("throws no-platform-configured when env vars are missing", async () => {
    let thrown: unknown = null;
    try {
      await fetchDeployStatus();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DeployStatusError);
    expect((thrown as DeployStatusError).code).toBe("no-platform-configured");
  });

  it("POSTs siteId + bearer secret and returns deploy on ok response", async () => {
    configurePlatform();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe("https://platform.test/api/broker/deploy-status");
      expect(init?.method).toBe("POST");
      expect(
        (init?.headers as Record<string, string>).authorization,
      ).toBe("Bearer secret-xyz");
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ siteId: "site-1" });
      return new Response(
        JSON.stringify({
          ok: true,
          deploy: {
            id: "dpl_1",
            state: "building",
            url: "https://x.vercel.app",
            errorMessage: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const deploy = await fetchDeployStatus();
    expect(deploy.id).toBe("dpl_1");
    expect(deploy.state).toBe("building");
  });

  it("strips trailing slash from STAGECRAFT_PLATFORM_URL", async () => {
    configurePlatform();
    process.env.STAGECRAFT_PLATFORM_URL = "https://platform.test/";
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(
        JSON.stringify({ ok: true, deploy: { id: null, state: "queued", url: null, createdAt: null } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await fetchDeployStatus();
    expect(capturedUrl).toBe("https://platform.test/api/broker/deploy-status");
  });

  it("disables Next.js fetch caching on the broker call", async () => {
    configurePlatform();
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({ ok: true, deploy: { id: null, state: "queued", url: null, createdAt: null } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await fetchDeployStatus();
    expect(capturedInit?.cache).toBe("no-store");
  });

  it("throws broker-rejected on non-2xx responses", async () => {
    configurePlatform();
    globalThis.fetch = vi.fn(async () => new Response("Bad", { status: 502 })) as unknown as typeof fetch;
    let thrown: unknown = null;
    try {
      await fetchDeployStatus();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DeployStatusError);
    expect((thrown as DeployStatusError).code).toBe("broker-rejected");
  });

  it("throws broker-rejected when body has ok:false", async () => {
    configurePlatform();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, code: "internal" }), { status: 200 }),
    ) as unknown as typeof fetch;
    let thrown: unknown = null;
    try {
      await fetchDeployStatus();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DeployStatusError);
    expect((thrown as DeployStatusError).code).toBe("broker-rejected");
  });

  it("throws broker-unreachable when fetch itself rejects", async () => {
    configurePlatform();
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    let thrown: unknown = null;
    try {
      await fetchDeployStatus();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DeployStatusError);
    expect((thrown as DeployStatusError).code).toBe("broker-unreachable");
  });
});
