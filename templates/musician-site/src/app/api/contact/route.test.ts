import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendContactEmailMock } = vi.hoisted(() => ({ sendContactEmailMock: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendContactEmail: sendContactEmailMock }));

const { readSiteConfigMock } = vi.hoisted(() => ({ readSiteConfigMock: vi.fn() }));
vi.mock("@/lib/content", () => ({ readSiteConfig: readSiteConfigMock }));

import { POST } from "./route";
import { __resetRateLimiterForTests } from "./rate-limit";
import { DEFAULT_SITE_CONFIG } from "@/lib/site-config-types";

const ORIGINAL_ENV = { ...process.env };

const siteWithContact = {
  ...DEFAULT_SITE_CONFIG,
  artistName: "Pumpkin Bread",
  contactEmail: "artist@example.com",
};

beforeEach(() => {
  sendContactEmailMock.mockReset();
  sendContactEmailMock.mockResolvedValue(undefined);
  readSiteConfigMock.mockReset();
  readSiteConfigMock.mockResolvedValue(siteWithContact);
  __resetRateLimiterForTests();
  process.env = { ...ORIGINAL_ENV };
  process.env.RESEND_API_KEY = "re_test";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buildRequest(
  fields: Partial<Record<"name" | "email" | "subject" | "message" | "website", string>>,
  headers: Record<string, string> = { "x-forwarded-for": "1.2.3.4" },
): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") fd.append(k, v);
  }
  return new Request("http://localhost/api/contact", {
    method: "POST",
    body: fd,
    headers,
  });
}

const validBody = {
  name: "Sarah Doe",
  email: "Sarah@Example.com",
  subject: "Booking",
  message: "Can you play our festival?",
};

describe("POST /api/contact", () => {
  it("sends through Resend on a valid submission", async () => {
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendContactEmailMock).toHaveBeenCalledTimes(1);
    const call = sendContactEmailMock.mock.calls[0][0];
    expect(call.to).toBe("artist@example.com");
    // Submitter email is lowercased before forwarding.
    expect(call.replyTo).toBe("sarah@example.com");
    expect(call.fromName).toBe("Sarah Doe");
    expect(call.subject).toBe("[Contact] Booking");
    expect(call.body).toBe("Can you play our festival?");
    expect(call.siteName).toBe("Pumpkin Bread");
  });

  it("falls back to a generic subject when none is provided", async () => {
    await POST(buildRequest({ ...validBody, subject: "" }));
    expect(sendContactEmailMock.mock.calls[0][0].subject).toBe("[Contact] New message");
  });

  it("silently accepts when the honeypot field is filled (no send)", async () => {
    const res = await POST(buildRequest({ ...validBody, website: "spammy" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendContactEmailMock).not.toHaveBeenCalled();
  });

  it("rejects missing required fields", async () => {
    const res = await POST(buildRequest({ name: "", email: "x@y.z", message: "hi" }));
    expect(res.status).toBe(400);
    expect(sendContactEmailMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed submitter email", async () => {
    const res = await POST(buildRequest({ ...validBody, email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(sendContactEmailMock).not.toHaveBeenCalled();
  });

  it("rate-limits a single IP after 3 messages within the window", async () => {
    const req = () => POST(buildRequest(validBody));
    expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(200);
    const fourth = await req();
    expect(fourth.status).toBe(429);
    expect(sendContactEmailMock).toHaveBeenCalledTimes(3);
  });

  it("isolates rate limiting per IP", async () => {
    await POST(buildRequest(validBody, { "x-forwarded-for": "1.1.1.1" }));
    await POST(buildRequest(validBody, { "x-forwarded-for": "1.1.1.1" }));
    await POST(buildRequest(validBody, { "x-forwarded-for": "1.1.1.1" }));
    // Different IP — still under the limit.
    const res = await POST(buildRequest(validBody, { "x-forwarded-for": "2.2.2.2" }));
    expect(res.status).toBe(200);
  });

  it("returns 500 when Resend throws", async () => {
    sendContactEmailMock.mockRejectedValue(new Error("network down"));
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });

  it("returns 503 in production when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(503);
    expect(sendContactEmailMock).not.toHaveBeenCalled();
  });

  it("still attempts to send in dev when RESEND_API_KEY is missing (helper logs locally)", async () => {
    delete process.env.RESEND_API_KEY;
    vi.stubEnv("NODE_ENV", "development");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    // The helper itself decides whether to log vs send; the route hands
    // off the same way it does in production.
    expect(sendContactEmailMock).toHaveBeenCalledTimes(1);
  });
});
