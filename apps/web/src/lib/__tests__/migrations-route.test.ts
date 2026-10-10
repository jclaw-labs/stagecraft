/**
 * Tests for POST /api/migrations
 *
 * Validates input checking, integration guards (the same ones POST
 * /api/sites applies), slug uniqueness, and job creation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ── Mocks ─────────────────────────────────────────────────────────────────────

// next/server is not available in the test environment — provide minimal stubs
vi.mock("next/server", () => ({
  NextRequest: Request,
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(data), {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      }),
  },
}));

vi.mock("@stagecraft/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stagecraft/shared")>()),
  isValidHttpUrl: (raw: string) => {
    try {
      const p = new URL(raw);
      return p.protocol === "http:" || p.protocol === "https:";
    } catch {
      return false;
    }
  },
}));

const mockSession = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: mockSession }));

const mockSlugify = vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-"));
vi.mock("@/lib/slugify", () => ({ slugify: mockSlugify }));

const mockDrainAfterResponse = vi.fn();
vi.mock("@/lib/jobs/worker", () => ({ drainAfterResponse: mockDrainAfterResponse }));

const mockFindManyIntegrations = vi.fn();
const mockFindUniqueSite = vi.fn();
const mockCreateSite = vi.fn();
const mockDeleteSite = vi.fn();
const mockCreateJob = vi.fn();

vi.mock("@stagecraft/db", () => ({
  prisma: {
    integrationAccount: { findMany: mockFindManyIntegrations },
    site: {
      findUnique: mockFindUniqueSite,
      create: mockCreateSite,
      delete: mockDeleteSite,
    },
    siteJob: { create: mockCreateJob },
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/migrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function authedSession(userId = "user-1") {
  mockSession.mockResolvedValue({ user: { id: userId } });
}

function withIntegrations(...providers: string[]) {
  const connected = providers.length > 0 ? providers : ["github", "netlify", "resend"];
  mockFindManyIntegrations.mockResolvedValue(connected.map((provider) => ({ provider })));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/migrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUniqueSite.mockResolvedValue(null);
    mockCreateSite.mockResolvedValue({ id: "site-1", slug: "sarah-chen-music" });
    mockCreateJob.mockResolvedValue({ id: "job-1" });
    mockDeleteSite.mockResolvedValue({});
  });

  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(null);
    const { POST } = await import("../../app/api/migrations/route");
    const res = await POST(makeRequest({ url: "https://example.com", name: "Test" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    authedSession();
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "https://example.com" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/name/i);
  });

  it("returns 400 when url is not a valid http/https URL", async () => {
    authedSession();
    withIntegrations();
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "ftp://bad.com", name: "Test" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/url/i);
  });

  it("returns 400 when GitHub is not connected", async () => {
    authedSession();
    withIntegrations("netlify", "resend");
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "https://example.com", name: "Test" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("GitHub must be connected before migrating a site");
    expect(mockCreateSite).not.toHaveBeenCalled();
  });

  it("returns 400 when neither Vercel nor Netlify is connected", async () => {
    authedSession();
    withIntegrations("github", "resend");
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "https://example.com", name: "Test" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("A deploy target must be connected (Vercel or Netlify) before migrating a site");
    expect(mockCreateSite).not.toHaveBeenCalled();
  });

  it("returns 400 when Resend is not connected", async () => {
    authedSession();
    withIntegrations("github", "netlify");
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "https://example.com", name: "Test" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/^Resend must be connected .* before migrating a site$/);
    expect(mockCreateSite).not.toHaveBeenCalled();
  });

  it("accepts Vercel as the deploy target without Netlify", async () => {
    authedSession();
    withIntegrations("github", "vercel", "resend");
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "https://example.com", name: "Test" }));
    expect(res.status).toBe(201);
  });

  it("returns 409 when slug already exists", async () => {
    authedSession();
    withIntegrations();
    mockFindUniqueSite.mockResolvedValue({ id: "existing" });
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "https://example.com", name: "Test" }));
    expect(res.status).toBe(409);
  });

  it("returns 201 with site and jobId on success", async () => {
    authedSession();
    withIntegrations();
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({
      url: "https://sarahchenmusic.com",
      name: "Sarah Chen Music",
    }));
    expect(res.status).toBe(201);
    const body = await res.json() as { site: unknown; jobId: string };
    expect(body.jobId).toBe("job-1");
    expect(body.site).toBeDefined();
    expect(mockCreateJob).toHaveBeenCalledWith({
      data: {
        siteId: "site-1",
        userId: "user-1",
        type: "migrate_site",
        status: "queued",
        requestPayload: {
          url: "https://sarahchenmusic.com",
          name: "Sarah Chen Music",
          slug: "sarah-chen-music",
        },
      },
    });
    expect(mockDrainAfterResponse).toHaveBeenCalledTimes(1);
  });

  it("returns 500 and drops the site when the job can't be queued", async () => {
    authedSession();
    withIntegrations();
    mockCreateJob.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "https://example.com", name: "Test" }));
    expect(res.status).toBe(500);
    expect(mockDeleteSite).toHaveBeenCalledWith({ where: { id: "site-1" } });
    expect(mockDrainAfterResponse).not.toHaveBeenCalled();
  });
});
