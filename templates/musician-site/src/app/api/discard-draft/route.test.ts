import { beforeEach, describe, expect, it, vi } from "vitest";

const { discardDraftMock, getSessionMock } = vi.hoisted(() => ({
  discardDraftMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock("@/lib/publish", async () => {
  const actual = await vi.importActual<typeof import("./../../../lib/publish")>(
    "@/lib/publish",
  );
  return { ...actual, discardDraft: discardDraftMock };
});
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

import { POST } from "./route";
import { PublishError } from "@/lib/publish";

beforeEach(() => {
  discardDraftMock.mockReset();
  getSessionMock.mockReset();
});

describe("POST /api/discard-draft", () => {
  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(discardDraftMock).not.toHaveBeenCalled();
  });

  it("calls discardDraft with the session email", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    discardDraftMock.mockResolvedValue({
      mode: "github",
      discardedFromSha: "old-sha",
      mainSha: "main-sha",
      alreadyInSync: false,
    });
    await POST();
    expect(discardDraftMock).toHaveBeenCalledWith({ authorEmail: "a@e.com" });
  });

  it("returns the success envelope on a real discard", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    discardDraftMock.mockResolvedValue({
      mode: "github",
      discardedFromSha: "old-sha",
      mainSha: "main-sha",
      alreadyInSync: false,
    });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      mode: "github",
      alreadyInSync: false,
      discardedFromSha: "old-sha",
      mainSha: "main-sha",
    });
  });

  it("surfaces alreadyInSync when nothing was pending", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    discardDraftMock.mockResolvedValue({
      mode: "github",
      discardedFromSha: "same-sha",
      mainSha: "same-sha",
      alreadyInSync: true,
    });
    const res = await POST();
    const body = await res.json();
    expect(body.alreadyInSync).toBe(true);
  });

  it("dev fallback returns mode=local and alreadyInSync=true", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    discardDraftMock.mockResolvedValue({ mode: "local" });
    const res = await POST();
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      mode: "local",
      alreadyInSync: true,
      discardedFromSha: null,
      mainSha: null,
    });
  });

  it("returns 502 on broker-rejected PublishError", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    discardDraftMock.mockRejectedValue(new PublishError("broker-rejected", "denied"));
    const res = await POST();
    expect(res.status).toBe(502);
  });

  it("returns 500 on github-failed PublishError", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    discardDraftMock.mockRejectedValue(new PublishError("github-failed", "boom"));
    const res = await POST();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("github-failed");
  });
});
