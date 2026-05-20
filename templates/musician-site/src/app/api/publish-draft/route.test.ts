import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishDraftToMainMock, getSessionMock } = vi.hoisted(() => ({
  publishDraftToMainMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@/lib/publish", async () => {
  const actual = await vi.importActual<typeof import("./../../../lib/publish")>(
    "@/lib/publish",
  );
  return { ...actual, publishDraftToMain: publishDraftToMainMock };
});
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

import { POST } from "./route";
import { PublishError } from "@/lib/publish";

beforeEach(() => {
  publishDraftToMainMock.mockReset();
  getSessionMock.mockReset();
});

function req(body: unknown | null = null): Request {
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  if (body !== null) init.body = JSON.stringify(body);
  return new Request("http://localhost/api/publish-draft", init);
}

describe("POST /api/publish-draft", () => {
  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(publishDraftToMainMock).not.toHaveBeenCalled();
  });

  it("tolerates an empty body (no commitSubject)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishDraftToMainMock.mockResolvedValue({
      commitSha: "sha",
      mode: "github",
      alreadyInSync: false,
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(publishDraftToMainMock).toHaveBeenCalledWith(
      expect.objectContaining({ authorEmail: "a@e.com", commitSubject: undefined }),
    );
  });

  it("forwards a custom commitSubject", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishDraftToMainMock.mockResolvedValue({
      commitSha: "sha",
      mode: "github",
      alreadyInSync: false,
    });
    await POST(req({ commitSubject: "Ship the spring tour" }));
    expect(publishDraftToMainMock).toHaveBeenCalledWith(
      expect.objectContaining({ commitSubject: "Ship the spring tour" }),
    );
  });

  it("rejects an invalid body shape", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    const res = await POST(req({ commitSubject: 42 }));
    expect(res.status).toBe(400);
    expect(publishDraftToMainMock).not.toHaveBeenCalled();
  });

  it("returns alreadyInSync in the success envelope", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishDraftToMainMock.mockResolvedValue({
      commitSha: "main-sha",
      mode: "github",
      alreadyInSync: true,
    });
    const res = await POST(req());
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      mode: "github",
      commitSha: "main-sha",
      alreadyInSync: true,
    });
  });

  it("returns 502 on broker-rejected PublishError", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishDraftToMainMock.mockRejectedValue(
      new PublishError("broker-rejected", "denied"),
    );
    const res = await POST(req());
    expect(res.status).toBe(502);
  });

  it("returns 500 on github-failed PublishError", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishDraftToMainMock.mockRejectedValue(
      new PublishError("github-failed", "boom"),
    );
    const res = await POST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("github-failed");
  });

  it("dev fallback returns mode=local and alreadyInSync=true", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    publishDraftToMainMock.mockResolvedValue({
      commitSha: null,
      mode: "local",
      alreadyInSync: true,
    });
    const res = await POST(req());
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      mode: "local",
      commitSha: null,
      alreadyInSync: true,
    });
  });
});
