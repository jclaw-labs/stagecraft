import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@octokit/request-error";

// Mock @octokit/rest at module init so any draft-store path doesn't
// try to make real network calls. The tests that exercise the draft
// branch wire up their own mocks via these handles.
const { getRef, reposGetContent } = vi.hoisted(() => ({
  getRef: vi.fn(),
  reposGetContent: vi.fn(),
}));
vi.mock("@octokit/rest", () => ({
  Octokit: class {
    git = { getRef };
    repos = { getContent: reposGetContent };
  },
}));

// Stub the broker fetch so the facade's production path doesn't try
// to call the real platform.
const { fetchPublishTokenMock } = vi.hoisted(() => ({
  fetchPublishTokenMock: vi.fn(),
}));
vi.mock("../publish", async () => {
  const actual = await vi.importActual<typeof import("../publish")>("../publish");
  return { ...actual, fetchPublishToken: fetchPublishTokenMock };
});

// Stub the FS store so we can assert fallback paths fire without
// touching disk.
const {
  fsReadCollectionDef,
  fsReadItem,
  fsReadSingleton,
  fsListItemSlugs,
  fsListItemsInOrder,
  fsReadOrder,
  fsListCollectionSlugs,
} = vi.hoisted(() => ({
  fsReadCollectionDef: vi.fn(),
  fsReadItem: vi.fn(),
  fsReadSingleton: vi.fn(),
  fsListItemSlugs: vi.fn(),
  fsListItemsInOrder: vi.fn(),
  fsReadOrder: vi.fn(),
  fsListCollectionSlugs: vi.fn(),
}));
vi.mock("./store", async () => {
  const actual = await vi.importActual<typeof import("./store")>("./store");
  return {
    ...actual,
    readCollectionDef: fsReadCollectionDef,
    readItem: fsReadItem,
    readSingleton: fsReadSingleton,
    listItemSlugs: fsListItemSlugs,
    listItemsInOrder: fsListItemsInOrder,
    readOrder: fsReadOrder,
    listCollectionSlugs: fsListCollectionSlugs,
  };
});

import { getReadStore } from "./read-store";
import { resetDraftStoreCache } from "./draft-store";
import { tourDatesDef } from "./test-fixtures";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  getRef.mockReset();
  reposGetContent.mockReset();
  fetchPublishTokenMock.mockReset();
  fsReadCollectionDef.mockReset();
  fsReadItem.mockReset();
  fsReadSingleton.mockReset();
  fsListItemSlugs.mockReset();
  fsListItemsInOrder.mockReset();
  fsReadOrder.mockReset();
  fsListCollectionSlugs.mockReset();
  resetDraftStoreCache();
  // Default to a configured platform; individual tests delete env
  // vars when they want the dev / unconfigured path.
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

function fileResponse(content: unknown) {
  return {
    data: {
      type: "file" as const,
      content: Buffer.from(JSON.stringify(content)).toString("base64"),
      encoding: "base64",
      sha: "blob-sha",
    },
  };
}

function notFound(): RequestError {
  return new RequestError("Not Found", 404, {
    request: { method: "GET", url: "x", headers: {} },
    response: { status: 404, url: "x", headers: {}, data: {} },
  });
}

describe("getReadStore — backend selection", () => {
  it("returns the FS store when the platform isn't configured (dev mode)", async () => {
    delete process.env.STAGECRAFT_SITE_ID;
    delete process.env.STAGECRAFT_BROKER_SECRET;
    const store = await getReadStore();
    expect(store.mode).toBe("fs");
    expect(fetchPublishTokenMock).not.toHaveBeenCalled();
  });

  it("returns the draft+fallback store when the platform IS configured", async () => {
    fetchPublishTokenMock.mockResolvedValue({
      token: "ghs_test",
      owner: "artist",
      repo: "site",
    });
    const store = await getReadStore();
    expect(store.mode).toBe("draft+fs-fallback");
    expect(fetchPublishTokenMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the FS store when the broker token mint fails", async () => {
    // Broker unreachable at token time → fall through to FS for the
    // whole request (same shape as a per-method github-unreachable).
    fetchPublishTokenMock.mockRejectedValue(new Error("broker dead"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    expect(store.mode).toBe("fs");
  });
});

describe("getReadStore — FS store proxies to ./store", () => {
  beforeEach(() => {
    delete process.env.STAGECRAFT_SITE_ID;
    delete process.env.STAGECRAFT_BROKER_SECRET;
  });

  it("readCollectionDef calls through to store.readCollectionDef", async () => {
    fsReadCollectionDef.mockResolvedValue(tourDatesDef());
    const store = await getReadStore();
    const result = await store.readCollectionDef("tour-dates");
    expect(fsReadCollectionDef).toHaveBeenCalledWith("tour-dates");
    expect(result?.slug).toBe("tour-dates");
  });

  it("listItemsInOrder calls through with the def", async () => {
    fsListItemsInOrder.mockResolvedValue([]);
    const store = await getReadStore();
    await store.listItemsInOrder("tour-dates", tourDatesDef());
    expect(fsListItemsInOrder).toHaveBeenCalledWith("tour-dates", tourDatesDef());
  });
});

describe("getReadStore — draft store with FS fallback", () => {
  beforeEach(() => {
    fetchPublishTokenMock.mockResolvedValue({
      token: "ghs_test",
      owner: "artist",
      repo: "site",
    });
  });

  it("draft success returns the GitHub-fetched value (no FS fallback)", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(fileResponse(tourDatesDef()));
    const store = await getReadStore();
    const result = await store.readCollectionDef("tour-dates");
    expect(result?.slug).toBe("tour-dates");
    expect(fsReadCollectionDef).not.toHaveBeenCalled();
  });

  it("draft null (file missing on draft) does NOT trigger fallback", async () => {
    // A genuine `null` return is the truth — masking it with the FS
    // snapshot would hide a deletion the artist intentionally made.
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValue(notFound()); // 404 → null in draft-store
    const store = await getReadStore();
    const result = await store.readCollectionDef("tour-dates");
    expect(result).toBeNull();
    expect(fsReadCollectionDef).not.toHaveBeenCalled();
  });

  it("falls back to FS on `branch-missing` (fresh site without draft branch)", async () => {
    // getRef 404 → DraftReadError("branch-missing") → fallback
    getRef.mockRejectedValue(notFound());
    fsReadCollectionDef.mockResolvedValue(tourDatesDef());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    const result = await store.readCollectionDef("tour-dates");
    expect(fsReadCollectionDef).toHaveBeenCalledWith("tour-dates");
    expect(result?.slug).toBe("tour-dates");
  });

  it("falls back to FS on `github-unreachable` (network blip)", async () => {
    getRef.mockRejectedValue(new Error("ENOTFOUND")); // generic non-RequestError
    fsListItemSlugs.mockResolvedValue(["a", "b"]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    const result = await store.listItemSlugs("tour-dates");
    expect(fsListItemSlugs).toHaveBeenCalledWith("tour-dates");
    expect(result).toEqual(["a", "b"]);
  });

  it("falls back to FS on `rate-limited`", async () => {
    const rateLimitErr = new RequestError("API rate limit exceeded", 429, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 429, url: "x", headers: {}, data: {} },
    });
    getRef.mockRejectedValue(rateLimitErr);
    fsListItemSlugs.mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    await store.listItemSlugs("tour-dates");
    expect(fsListItemSlugs).toHaveBeenCalled();
  });

  it("re-throws `auth-failed` (bug, not transient — surface to caller)", async () => {
    const authErr = new RequestError("Bad credentials", 401, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 401, url: "x", headers: {}, data: {} },
    });
    getRef.mockRejectedValue(authErr);
    const store = await getReadStore();
    await expect(store.readCollectionDef("tour-dates")).rejects.toMatchObject({
      name: "DraftReadError",
      code: "auth-failed",
    });
    expect(fsReadCollectionDef).not.toHaveBeenCalled();
  });

  it("re-throws `github-failed` (e.g. malformed _order.json)", async () => {
    // Construct a DraftReadError directly with the github-failed code
    // by faking a getContent that throws after getRef succeeded — the
    // wrapper still surfaces RequestError as github-failed for non-404
    // RequestErrors. Use a 500.
    getRef.mockResolvedValue(refResponse("sha-1"));
    const serverErr = new RequestError("Internal Server Error", 500, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 500, url: "x", headers: {}, data: {} },
    });
    reposGetContent.mockRejectedValue(serverErr);
    const store = await getReadStore();
    await expect(store.readCollectionDef("tour-dates")).rejects.toMatchObject({
      name: "DraftReadError",
      code: "github-failed",
    });
    expect(fsReadCollectionDef).not.toHaveBeenCalled();
  });

  it("re-throws `too-large` (file over Contents-API limit needs Blob API)", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue({
      data: {
        type: "file" as const,
        encoding: "none",
        content: "",
        size: 2_000_000,
        sha: "blob-sha",
      },
    });
    const store = await getReadStore();
    await expect(store.readCollectionDef("tour-dates")).rejects.toMatchObject({
      name: "DraftReadError",
      code: "too-large",
    });
    expect(fsReadCollectionDef).not.toHaveBeenCalled();
  });

  it("threads the draft context through every method (token + draft branch)", async () => {
    // Smoke-test that the draft store's getContent calls go to the
    // `draft` branch via the broker-minted token, not some other
    // branch / token.
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(fileResponse(tourDatesDef()));
    const store = await getReadStore();
    await store.readCollectionDef("tour-dates");
    expect(getRef).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "artist",
        repo: "site",
        ref: "heads/draft",
      }),
    );
    expect(reposGetContent).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "draft" }),
    );
  });
});
