import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, vercelLatestMock, netlifyLatestMock } = vi.hoisted(() => ({
  prismaMock: { site: { findUnique: vi.fn() } },
  vercelLatestMock: vi.fn(),
  netlifyLatestMock: vi.fn(),
}));

vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/integrations/vercel", () => ({ getLatestDeployment: vercelLatestMock }));
vi.mock("@/lib/integrations/netlify", () => ({ getLatestDeploy: netlifyLatestMock }));

import { POST } from "../route";
import { generateBrokerSecret, hashBrokerSecret } from "@/lib/broker-secret";

beforeEach(() => {
  prismaMock.site.findUnique.mockReset();
  vercelLatestMock.mockReset();
  netlifyLatestMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buildRequest(opts: { bearer?: string; rawBody?: string; body?: unknown } = {}) {
  return new Request("http://platform.test/api/broker/deploy-status", {
    method: "POST",
    headers: {
      ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
      "content-type": "application/json",
    },
    body: opts.rawBody ?? JSON.stringify(opts.body ?? {}),
  });
}

function makeSite(overrides: Partial<{
  userId: string;
  brokerSecretHash: string | null;
  deployTarget: string;
  vercelProjectId: string | null;
  vercelTeamId: string | null;
  netlifySiteId: string | null;
}> = {}) {
  const { hash } = generateBrokerSecret();
  return {
    userId: "user-1",
    brokerSecretHash: hash,
    deployTarget: "vercel",
    vercelProjectId: "prj_abc",
    vercelTeamId: null,
    netlifySiteId: null,
    ...overrides,
  };
}

describe("POST /api/broker/deploy-status", () => {
  it("401 missing-bearer when no Authorization header", async () => {
    const res = await POST(buildRequest({ body: { siteId: "site-1" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "missing-bearer" });
  });

  it("400 invalid-body on non-JSON", async () => {
    const res = await POST(buildRequest({ bearer: "x", rawBody: "not json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: "invalid-body" });
  });

  it("400 invalid-body when siteId is missing", async () => {
    const res = await POST(buildRequest({ bearer: "x", body: {} }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: "invalid-body" });
  });

  it("404 site-not-found when no Site row matches", async () => {
    prismaMock.site.findUnique.mockResolvedValue(null);
    const res = await POST(buildRequest({ bearer: "x", body: { siteId: "missing" } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, code: "site-not-found" });
  });

  it("401 invalid-secret when bearer doesn't match the stored hash", async () => {
    prismaMock.site.findUnique.mockResolvedValue(makeSite());
    const res = await POST(buildRequest({ bearer: "wrong", body: { siteId: "site-1" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "invalid-secret" });
  });

  it("401 invalid-secret when site has no brokerSecretHash on file", async () => {
    prismaMock.site.findUnique.mockResolvedValue(
      makeSite({ brokerSecretHash: null as unknown as string }),
    );
    const res = await POST(buildRequest({ bearer: "anything", body: { siteId: "site-1" } }));
    expect(res.status).toBe(401);
  });

  it("returns Vercel deploy when deployTarget=vercel", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(
      makeSite({ brokerSecretHash: hash, deployTarget: "vercel", vercelProjectId: "prj_abc" }),
    );
    vercelLatestMock.mockResolvedValue({
      id: "dpl_1",
      state: "building",
      url: "https://stagecraft-site-foo-abc.vercel.app",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      deploy: { id: "dpl_1", state: "building" },
    });
    expect(vercelLatestMock).toHaveBeenCalledWith("user-1", "prj_abc", undefined);
  });

  it("returns Netlify deploy when deployTarget=netlify", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(
      makeSite({
        brokerSecretHash: hash,
        deployTarget: "netlify",
        vercelProjectId: null,
        netlifySiteId: "ntl_xyz",
      }),
    );
    netlifyLatestMock.mockResolvedValue({
      id: "dep_1",
      state: "ready",
      url: "https://stagecraft-site-foo.netlify.app",
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00Z",
    });
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      deploy: { state: "ready" },
    });
    expect(netlifyLatestMock).toHaveBeenCalledWith("user-1", "ntl_xyz");
  });

  it("returns unknown state when site has no deploy target IDs configured yet", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(
      makeSite({
        brokerSecretHash: hash,
        deployTarget: "netlify",
        vercelProjectId: null,
        netlifySiteId: null,
      }),
    );
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      deploy: { state: "unknown" },
    });
    expect(vercelLatestMock).not.toHaveBeenCalled();
    expect(netlifyLatestMock).not.toHaveBeenCalled();
  });

  it("502 provider-failed when the upstream throws", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(makeSite({ brokerSecretHash: hash }));
    vercelLatestMock.mockRejectedValue(new Error("Vercel API error (500)"));
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, code: "provider-failed" });
  });

  it("works with the published broker secret hash format", async () => {
    // Defense-in-depth: an attacker who learned the *hash* from the DB
    // shouldn't be able to authenticate by sending it as the bearer.
    const { plaintext } = generateBrokerSecret();
    const hashOfPlaintext = hashBrokerSecret(plaintext);
    prismaMock.site.findUnique.mockResolvedValue(
      makeSite({ brokerSecretHash: hashOfPlaintext }),
    );
    const res = await POST(
      buildRequest({ bearer: hashOfPlaintext, body: { siteId: "site-1" } }),
    );
    expect(res.status).toBe(401);
  });
});
