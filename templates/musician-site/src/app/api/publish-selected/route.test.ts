import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishSelectedToMainMock, resolveSelectedChangePathsMock, getSessionMock } = vi.hoisted(
  () => ({
    publishSelectedToMainMock: vi.fn(),
    resolveSelectedChangePathsMock: vi.fn(),
    getSessionMock: vi.fn(),
  }),
);

vi.mock("@/lib/publish", async () => {
  const actual = await vi.importActual<typeof import("./../../../lib/publish")>("@/lib/publish");
  return { ...actual, publishSelectedToMain: publishSelectedToMainMock };
});
vi.mock("@/lib/draft-changes", async () => {
  const actual =
    await vi.importActual<typeof import("./../../../lib/draft-changes")>("@/lib/draft-changes");
  return { ...actual, resolveSelectedChangePaths: resolveSelectedChangePathsMock };
});
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

import { POST } from "./route";
import { PublishError } from "@/lib/publish";
import { DraftChangesError } from "@/lib/draft-changes";

beforeEach(() => {
  publishSelectedToMainMock.mockReset();
  resolveSelectedChangePathsMock.mockReset();
  getSessionMock.mockReset();
});

function req(body: unknown | null = null): Request {
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  if (body !== null) init.body = JSON.stringify(body);
  return new Request("http://localhost/api/publish-selected", init);
}

describe("POST /api/publish-selected", () => {
  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST(req({ selectedKeys: ["item:pages/about"] }));
    expect(res.status).toBe(401);
    expect(resolveSelectedChangePathsMock).not.toHaveBeenCalled();
    expect(publishSelectedToMainMock).not.toHaveBeenCalled();
  });

  it("returns 400 when selectedKeys is missing or empty", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ selectedKeys: [] }))).status).toBe(400);
    expect(publishSelectedToMainMock).not.toHaveBeenCalled();
  });

  it("expands the selection server-side and publishes the resolved copy/delete paths", async () => {
    getSessionMock.mockResolvedValue({ email: "artist@example.com" });
    resolveSelectedChangePathsMock.mockResolvedValue({
      copyPaths: ["src/content/collections/pages/items/about.json"],
      deletePaths: ["src/content/collections/pages/items/old.json"],
    });
    publishSelectedToMainMock.mockResolvedValue({
      commitSha: "sha",
      mode: "github",
      alreadyInSync: false,
    });

    const res = await POST(
      req({ selectedKeys: ["item:pages/about", "item:pages/old"], commitSubject: "Ship about" }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      mode: "github",
      commitSha: "sha",
      alreadyInSync: false,
    });
    expect(resolveSelectedChangePathsMock).toHaveBeenCalledWith([
      "item:pages/about",
      "item:pages/old",
    ]);
    expect(publishSelectedToMainMock).toHaveBeenCalledWith({
      authorEmail: "artist@example.com",
      copyPaths: ["src/content/collections/pages/items/about.json"],
      deletePaths: ["src/content/collections/pages/items/old.json"],
      commitSubject: "Ship about",
    });
  });

  it("maps a DraftChangesError from the expansion to its HTTP status", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    resolveSelectedChangePathsMock.mockRejectedValue(
      new DraftChangesError("broker-rejected", "bad secret"),
    );
    const res = await POST(req({ selectedKeys: ["item:pages/about"] }));
    expect(res.status).toBe(502);
    expect(publishSelectedToMainMock).not.toHaveBeenCalled();
  });

  it("maps a PublishError from the publish to its structured code", async () => {
    getSessionMock.mockResolvedValue({ email: "a@e.com" });
    resolveSelectedChangePathsMock.mockResolvedValue({ copyPaths: ["x"], deletePaths: [] });
    publishSelectedToMainMock.mockRejectedValue(
      new PublishError("concurrent-edit", "someone else just saved"),
    );
    const res = await POST(req({ selectedKeys: ["item:pages/about"] }));
    await expect(res.json()).resolves.toMatchObject({ ok: false, code: "concurrent-edit" });
  });
});
