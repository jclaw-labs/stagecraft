import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@octokit/request-error";

const { getRef } = vi.hoisted(() => ({ getRef: vi.fn() }));
vi.mock("@octokit/rest", () => ({
  Octokit: class {
    git = { getRef };
  },
}));

const { fetchPublishTokenMock } = vi.hoisted(() => ({
  fetchPublishTokenMock: vi.fn(),
}));
vi.mock("./publish", async () => {
  const actual = await vi.importActual<typeof import("./publish")>("./publish");
  return { ...actual, fetchPublishToken: fetchPublishTokenMock };
});

import { getDraftStatus } from "./draft-status";
import { PublishError } from "./publish";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  getRef.mockReset();
  fetchPublishTokenMock.mockReset();
  fetchPublishTokenMock.mockResolvedValue({
    token: "ghs_test",
    owner: "artist",
    repo: "site",
  });
  process.env = {
    ...ORIGINAL_ENV,
    STAGECRAFT_SITE_ID: "site_abc",
    STAGECRAFT_BROKER_SECRET: "secret_xyz",
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function refResponse(sha: string) {
  return { data: { object: { sha } } };
}

function notFound(): RequestError {
  return new RequestError("Not Found", 404, {
    request: { method: "GET", url: "x", headers: {} },
    response: { status: 404, url: "x", headers: {}, data: {} },
  });
}

describe("getDraftStatus", () => {
  it("returns local + hasPending=false when the platform isn't configured", async () => {
    delete process.env.STAGECRAFT_SITE_ID;
    delete process.env.STAGECRAFT_BROKER_SECRET;
    const status = await getDraftStatus();
    expect(status).toEqual({ hasPending: false, mode: "local" });
    expect(fetchPublishTokenMock).not.toHaveBeenCalled();
  });

  it("returns hasPending=true when draft.sha differs from main.sha", async () => {
    getRef.mockImplementation(({ ref }) => {
      if (ref === "heads/draft") return refResponse("draft-sha");
      return refResponse("main-sha");
    });
    const status = await getDraftStatus();
    expect(status).toEqual({ hasPending: true, mode: "github" });
  });

  it("returns hasPending=false when draft.sha equals main.sha (just-published)", async () => {
    getRef.mockResolvedValue(refResponse("same-sha"));
    const status = await getDraftStatus();
    expect(status).toEqual({ hasPending: false, mode: "github" });
  });

  it("returns hasPending=false when the draft branch doesn't exist yet (fresh site)", async () => {
    // First save is what creates the draft branch — until then there's
    // nothing to publish, by definition. Don't surface the 404 as an
    // error.
    getRef.mockRejectedValueOnce(notFound());
    const status = await getDraftStatus();
    expect(status).toEqual({ hasPending: false, mode: "github" });
  });

  it("re-throws as DraftStatusError(github-failed) on non-404 GitHub errors", async () => {
    const serverErr = new RequestError("Internal Server Error", 500, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 500, url: "x", headers: {}, data: {} },
    });
    getRef.mockRejectedValueOnce(serverErr);
    await expect(getDraftStatus()).rejects.toMatchObject({
      name: "DraftStatusError",
      code: "github-failed",
    });
  });

  it("re-throws as DraftStatusError(broker-unreachable) when the broker is offline", async () => {
    fetchPublishTokenMock.mockRejectedValue(
      new PublishError("broker-unreachable", "platform down"),
    );
    await expect(getDraftStatus()).rejects.toMatchObject({
      name: "DraftStatusError",
      code: "broker-unreachable",
    });
    expect(getRef).not.toHaveBeenCalled();
  });

  it("re-throws as DraftStatusError(broker-rejected) on bad per-site secret", async () => {
    fetchPublishTokenMock.mockRejectedValue(
      new PublishError("broker-rejected", "unknown site"),
    );
    await expect(getDraftStatus()).rejects.toMatchObject({
      name: "DraftStatusError",
      code: "broker-rejected",
    });
  });
});
