import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publishPageMock, getSessionMock } = vi.hoisted(() => ({
  publishPageMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@/lib/save-content", async () => {
  const actual = await vi.importActual<typeof import("./../../../lib/save-content")>(
    "@/lib/save-content",
  );
  return { ...actual, publishPage: publishPageMock };
});
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

import { POST } from "./route";

beforeEach(() => {
  publishPageMock.mockReset();
  getSessionMock.mockReset();
});

afterEach(async () => {
  await fs.rm(path.join(process.cwd(), "src/content/pages", "smoke.json"), { force: true });
});

function buildRequest(body: unknown): Request {
  return new Request("http://localhost/api/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/publish", () => {
  it("returns 401 when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST(buildRequest({ pageSlug: "smoke", data: {} }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "unauthorized" });
  });

  it("returns 400 when body fails validation", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    const res = await POST(buildRequest({ pageSlug: "Bad Slug!", data: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("validation-failed");
  });

  it("returns 200 + commit sha on success", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishPageMock.mockResolvedValue({ commitSha: "deadbeef", mode: "github" });
    const res = await POST(buildRequest({ pageSlug: "smoke", data: { x: 1 } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, commitSha: "deadbeef" });
  });

  it("returns null commit sha for local mode", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishPageMock.mockResolvedValue({ commitSha: null, mode: "local" });
    const res = await POST(buildRequest({ pageSlug: "smoke", data: {} }));
    const body = await res.json();
    expect(body).toEqual({ ok: true, commitSha: null });
  });

  it("forwards artist email from session as authorEmail", async () => {
    getSessionMock.mockResolvedValue({ email: "artist@example.com" });
    publishPageMock.mockResolvedValue({ commitSha: "x", mode: "github" });
    await POST(buildRequest({ pageSlug: "smoke", data: {} }));
    expect(publishPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ authorEmail: "artist@example.com" }),
    );
  });

  it("maps broker-rejected errors to 502", async () => {
    const { PublishError } = await import("@/lib/publish");
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishPageMock.mockRejectedValue(new PublishError("broker-rejected", "401"));
    const res = await POST(buildRequest({ pageSlug: "smoke", data: {} }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("broker-rejected");
  });

  it("maps github-failed errors to 500", async () => {
    const { PublishError } = await import("@/lib/publish");
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishPageMock.mockRejectedValue(new PublishError("github-failed", "boom"));
    const res = await POST(buildRequest({ pageSlug: "smoke", data: {} }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("github-failed");
  });
});
