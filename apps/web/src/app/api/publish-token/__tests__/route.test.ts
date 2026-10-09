import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, mintMock } = vi.hoisted(() => ({
  prismaMock: { site: { findUnique: vi.fn() } },
  mintMock: vi.fn(),
}));

vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/github-app-token", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/github-app-token")>(
    "@/lib/github-app-token",
  );
  return { ...actual, mintInstallationToken: mintMock };
});

import { POST } from "../route";
import { generateBrokerSecret } from "@/lib/broker-secret";
import {
  publishTokenErrorSchema,
  publishTokenResponseSchema,
} from "@/lib/publish-token-types";
import { clearSiteTokenCache } from "@/lib/site-installation-token";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  prismaMock.site.findUnique.mockReset();
  mintMock.mockReset();
  clearSiteTokenCache();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function buildRequest(opts: {
  bearer?: string;
  body?: unknown;
  rawBody?: string;
} = {}) {
  return new Request("http://platform.test/api/publish-token", {
    method: "POST",
    headers: {
      ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
      "content-type": "application/json",
    },
    body: opts.rawBody ?? JSON.stringify(opts.body ?? {}),
  });
}

function makeSite(overrides = {}) {
  const { hash } = generateBrokerSecret();
  return {
    id: "site-1",
    brokerSecretHash: hash,
    githubInstallationId: 12345,
    githubAppSuspended: false,
    githubRepoOwner: "artist",
    githubRepoName: "site",
    ...overrides,
  };
}

describe("POST /api/publish-token", () => {
  it("401 when Authorization header is missing", async () => {
    const res = await POST(buildRequest({ body: { siteId: "x" } }));
    expect(res.status).toBe(401);
    const parsed = publishTokenErrorSchema.parse(await res.json());
    expect(parsed.code).toBe("missing-bearer");
  });

  it("400 when body is not JSON", async () => {
    const res = await POST(buildRequest({ bearer: "x", rawBody: "not json" }));
    expect(res.status).toBe(400);
  });

  it("400 when siteId is missing", async () => {
    const res = await POST(buildRequest({ bearer: "x", body: {} }));
    expect(res.status).toBe(400);
  });

  it("404 when site not found", async () => {
    prismaMock.site.findUnique.mockResolvedValue(null);
    const res = await POST(buildRequest({ bearer: "x", body: { siteId: "no" } }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("site-not-found");
  });

  it("401 when bearer secret doesn't match the site hash", async () => {
    prismaMock.site.findUnique.mockResolvedValue(makeSite());
    const res = await POST(buildRequest({ bearer: "wrong", body: { siteId: "site-1" } }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("invalid-secret");
  });

  it("423 when the GitHub App installation is suspended", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(
      makeSite({ brokerSecretHash: hash, githubAppSuspended: true }),
    );
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(423);
    expect((await res.json()).code).toBe("app-suspended");
  });

  it("409 when no installationId yet (pre-install)", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(
      makeSite({ brokerSecretHash: hash, githubInstallationId: null }),
    );
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("app-not-installed");
  });

  it("409 when repo isn't configured", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(
      makeSite({ brokerSecretHash: hash, githubRepoOwner: null }),
    );
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("repo-not-configured");
  });

  it("500 with github-app-misconfigured when minting fails on env", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(makeSite({ brokerSecretHash: hash }));
    const { GitHubAppMisconfiguredError } = await import("@/lib/github-app-token");
    mintMock.mockRejectedValue(new GitHubAppMisconfiguredError("missing"));
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("github-app-misconfigured");
  });

  it("happy path: returns valid PublishTokenResponse", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(makeSite({ brokerSecretHash: hash }));
    mintMock.mockResolvedValue({ token: "ghs_abc", expiresAt: "2099-01-01T00:00:00.000Z" });

    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(200);
    const parsed = publishTokenResponseSchema.parse(await res.json());
    expect(parsed.token).toBe("ghs_abc");
    expect(parsed.repo).toEqual({ owner: "artist", name: "site" });
  });

  it("mints for the Site row's installation, scoped to its repo", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(
      makeSite({ brokerSecretHash: hash, githubInstallationId: 99999 }),
    );
    mintMock.mockResolvedValue({ token: "t", expiresAt: "2099-01-01T00:00:00.000Z" });
    await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(mintMock).toHaveBeenCalledWith(99999, {
      repositoryNames: ["site"],
      permissions: { contents: "write", metadata: "read" },
    });
  });

  it("serves a repeat request from the cache", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(makeSite({ brokerSecretHash: hash }));
    mintMock.mockResolvedValue({ token: "ghs_cached", expiresAt: "2099-01-01T00:00:00.000Z" });

    await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));

    expect(res.status).toBe(200);
    expect((await res.json()).token).toBe("ghs_cached");
    expect(mintMock).toHaveBeenCalledTimes(1);
  });

  it("500 with internal when minting fails for another reason", async () => {
    const { plaintext, hash } = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(makeSite({ brokerSecretHash: hash }));
    mintMock.mockRejectedValue(new Error("422 repository not in installation"));
    const res = await POST(buildRequest({ bearer: plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("internal");
  });

  it("rejects a different site's secret (no cross-site reuse)", async () => {
    const a = generateBrokerSecret();
    const b = generateBrokerSecret();
    prismaMock.site.findUnique.mockResolvedValue(makeSite({ brokerSecretHash: a.hash }));
    const res = await POST(buildRequest({ bearer: b.plaintext, body: { siteId: "site-1" } }));
    expect(res.status).toBe(401);
  });
});
