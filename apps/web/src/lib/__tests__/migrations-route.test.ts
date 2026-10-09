/**
 * Tests for POST /api/migrations
 *
 * Validates input checking, integration guards,
 * slug uniqueness, and successful job creation.
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

const mockFindManyIntegrations = vi.fn();
const mockFindUniqueSite = vi.fn();
const mockCreateSite = vi.fn();
const mockCreateJob = vi.fn();

vi.mock("@stagecraft/db", () => ({
  prisma: {
    integrationAccount: { findMany: mockFindManyIntegrations },
    site: {
      findUnique: mockFindUniqueSite,
      create: mockCreateSite,
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

function withIntegrations(github = true, netlify = true) {
  const accounts = [];
  if (github) accounts.push({ provider: "github" });
  if (netlify) accounts.push({ provider: "netlify" });
  mockFindManyIntegrations.mockResolvedValue(accounts);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/migrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUniqueSite.mockResolvedValue(null);
    mockCreateSite.mockResolvedValue({ id: "site-1", slug: "sarah-chen-music" });
    mockCreateJob.mockResolvedValue({ id: "job-1" });
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
    withIntegrations(false, true);
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "https://example.com", name: "Test" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/GitHub/i);
  });

  it("returns 400 when Netlify is not connected", async () => {
    authedSession();
    withIntegrations(true, false);
    const { POST } = await import("../../app/api/migrations/route");

    const res = await POST(makeRequest({ url: "https://example.com", name: "Test" }));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Netlify/i);
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
  });
});
