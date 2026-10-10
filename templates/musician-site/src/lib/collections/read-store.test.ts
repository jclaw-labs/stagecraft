import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@octokit/request-error";

// Mock @octokit/rest at module init so any draft-store path doesn't
// try to make real network calls. The tests that exercise the draft
// branch wire up their own mocks via these handles.
const { getRef, getBlob, reposGetContent } = vi.hoisted(() => ({
  getRef: vi.fn(),
  getBlob: vi.fn(),
  reposGetContent: vi.fn(),
}));
vi.mock("@octokit/rest", () => ({
  Octokit: class {
    git = { getRef, getBlob };
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

import {
  getReadStore,
  getFsReadStore,
  readItemOrSingletonDraft,
  type ReadStore,
} from "./read-store";
import { resetDraftStoreCache } from "./draft-store";
import { PublishError } from "../publish";
import { tourDatesDef } from "./test-fixtures";
import type { Item } from "./schema";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  getRef.mockReset();
  getBlob.mockReset();
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

/** A getContent response for a file past the Contents-API ~1 MB limit. */
function oversizedContentResponse() {
  return {
    data: {
      type: "file" as const,
      encoding: "none",
      content: "",
      size: 2_000_000,
      sha: "big-blob-sha",
    },
  };
}

function blobResponse(content: unknown) {
  return {
    data: {
      content: Buffer.from(JSON.stringify(content)).toString("base64"),
      encoding: "base64",
      sha: "big-blob-sha",
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

  it("falls back to the FS store when the broker is unreachable", async () => {
    // Broker unreachable at token time → fall through to FS for the
    // whole request (same shape as a per-method github-unreachable).
    fetchPublishTokenMock.mockRejectedValue(
      new PublishError("broker-unreachable", "platform down"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    expect(store.mode).toBe("fs");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("re-throws when the broker rejects the request (permanent config error)", async () => {
    // `broker-rejected` typically means bad per-site secret or
    // unknown siteId. Silently falling back would mask the misconfig
    // for the life of the deployment — surface it instead.
    fetchPublishTokenMock.mockRejectedValue(
      new PublishError("broker-rejected", "unknown site"),
    );
    await expect(getReadStore()).rejects.toMatchObject({
      name: "PublishError",
      code: "broker-rejected",
    });
  });

  it("re-throws unexpected (non-PublishError) throws from the broker call", async () => {
    // Programmer error / unexpected throw shape — surface so it's
    // visible rather than degrading to FS silently.
    fetchPublishTokenMock.mockRejectedValue(new Error("kaboom"));
    await expect(getReadStore()).rejects.toThrow("kaboom");
  });
});

describe("getFsReadStore", () => {
  it("returns a FS-mode store even when the platform IS configured", () => {
    // Public-renderer code paths must read the deployed snapshot of
    // `main`, not the artist's draft branch, regardless of whether
    // the broker is reachable. `STAGECRAFT_SITE_ID` is set by the
    // top-level beforeEach.
    const store = getFsReadStore();
    expect(store.mode).toBe("fs");
    expect(fetchPublishTokenMock).not.toHaveBeenCalled();
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
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    const result = await store.readCollectionDef("tour-dates");
    expect(fsReadCollectionDef).toHaveBeenCalledWith("tour-dates");
    expect(result?.slug).toBe("tour-dates");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to FS on `github-unreachable` (network blip)", async () => {
    getRef.mockRejectedValue(new Error("ENOTFOUND")); // generic non-RequestError
    fsListItemSlugs.mockResolvedValue(["a", "b"]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    const result = await store.listItemSlugs("tour-dates");
    expect(fsListItemSlugs).toHaveBeenCalledWith("tour-dates");
    expect(result).toEqual(["a", "b"]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to FS on `rate-limited`", async () => {
    const rateLimitErr = new RequestError("API rate limit exceeded", 429, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 429, url: "x", headers: {}, data: {} },
    });
    getRef.mockRejectedValue(rateLimitErr);
    fsListItemSlugs.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    await store.listItemSlugs("tour-dates");
    expect(fsListItemSlugs).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
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

  it("reads a file over the Contents-API limit live via the Blob API (no FS fallback)", async () => {
    // The live draft file exceeds the Contents-API ~1 MB limit;
    // draft-store re-reads it through the Git Blob API, so the admin
    // sees the current draft — not the stale build snapshot.
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(oversizedContentResponse());
    getBlob.mockResolvedValue(blobResponse({ ...tourDatesDef(), pluralName: "live tour dates" }));
    const store = await getReadStore();
    const result = await store.readCollectionDef("tour-dates");
    expect(result?.pluralName).toBe("live tour dates");
    expect(fsReadCollectionDef).not.toHaveBeenCalled();
  });

  it("re-throws a Blob API failure on an oversized file (no silent stale fallback)", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(oversizedContentResponse());
    getBlob.mockRejectedValue(
      new RequestError("Internal Server Error", 500, {
        request: { method: "GET", url: "x", headers: {} },
        response: { status: 500, url: "x", headers: {}, data: {} },
      }),
    );
    const store = await getReadStore();
    await expect(store.readCollectionDef("tour-dates")).rejects.toMatchObject({
      name: "DraftReadError",
      code: "github-failed",
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

describe("getReadStore — wasDegraded (read-only banner signal)", () => {
  function withToken() {
    fetchPublishTokenMock.mockResolvedValue({
      token: "ghs_test",
      owner: "artist",
      repo: "site",
    });
  }

  it("is false on healthy draft reads", async () => {
    withToken();
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(fileResponse(tourDatesDef()));
    const store = await getReadStore();
    await store.readCollectionDef("tour-dates");
    expect(store.wasDegraded()).toBe(false);
  });

  it("flips true after a github-unreachable fallback", async () => {
    withToken();
    getRef.mockRejectedValue(new Error("ENOTFOUND"));
    fsListItemSlugs.mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    expect(store.wasDegraded()).toBe(false); // not yet read
    await store.listItemSlugs("tour-dates");
    expect(store.wasDegraded()).toBe(true);
  });

  it("flips true after a rate-limited fallback", async () => {
    withToken();
    const rateLimitErr = new RequestError("API rate limit exceeded", 429, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 429, url: "x", headers: {}, data: {} },
    });
    getRef.mockRejectedValue(rateLimitErr);
    fsListItemSlugs.mockResolvedValue([]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    await store.listItemSlugs("tour-dates");
    expect(store.wasDegraded()).toBe(true);
  });

  it("stays false after a branch-missing fallback (fresh site, not an outage)", async () => {
    withToken();
    getRef.mockRejectedValue(notFound()); // 404 → branch-missing
    fsReadCollectionDef.mockResolvedValue(tourDatesDef());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    await store.readCollectionDef("tour-dates");
    expect(store.wasDegraded()).toBe(false);
  });

  it("stays false after reading an oversized file via the Blob API", async () => {
    withToken();
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(oversizedContentResponse());
    getBlob.mockResolvedValue(blobResponse(tourDatesDef()));
    const store = await getReadStore();
    await store.readCollectionDef("tour-dates");
    expect(store.wasDegraded()).toBe(false);
  });

  it("is true when the broker is unreachable (whole-request FS fallback)", async () => {
    fetchPublishTokenMock.mockRejectedValue(
      new PublishError("broker-unreachable", "platform down"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await getReadStore();
    expect(store.wasDegraded()).toBe(true);
  });

  it("is false in unconfigured dev mode (FS by design, not a degradation)", async () => {
    delete process.env.STAGECRAFT_SITE_ID;
    delete process.env.STAGECRAFT_BROKER_SECRET;
    const store = await getReadStore();
    expect(store.wasDegraded()).toBe(false);
  });

  it("is false for the always-FS public store", () => {
    expect(getFsReadStore().wasDegraded()).toBe(false);
  });
});

describe("readItemOrSingletonDraft", () => {
  // The helper only calls `store.readItem`; stub the rest of the facade.
  function stubStore(item: Item | null): ReadStore {
    return {
      readItem: vi.fn(async () => item),
      readCollectionDef: vi.fn(),
      readSingleton: vi.fn(),
      listItemSlugs: vi.fn(),
      listItemsInOrder: vi.fn(),
      readOrder: vi.fn(),
      listCollectionSlugs: vi.fn(),
      mode: "fs",
      wasDegraded: () => false,
    } as unknown as ReadStore;
  }

  const singletonDef = { ...tourDatesDef(), isSingleton: true };
  const multiItemDef = tourDatesDef(); // isSingleton: false

  it("returns the persisted item unchanged when it exists", async () => {
    const existing: Item = {
      id: "item_x",
      slug: "_singleton",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      values: {},
    };
    const out = await readItemOrSingletonDraft(stubStore(existing), "booking", "_singleton", singletonDef);
    expect(out).toBe(existing);
  });

  it("synthesizes an empty draft for a missing singleton item", async () => {
    const out = await readItemOrSingletonDraft(stubStore(null), "booking", "_singleton", singletonDef);
    expect(out).not.toBeNull();
    expect(out!.slug).toBe("_singleton");
    expect(out!.values).toEqual({});
    expect(out!.id.length).toBeGreaterThan(0);
    // Freshly minted, so the two timestamps match.
    expect(out!.createdAt).toBe(out!.updatedAt);
  });

  it("returns null for a missing multi-item item (a genuine 404)", async () => {
    const out = await readItemOrSingletonDraft(stubStore(null), "tour-dates", "some-slug", multiItemDef);
    expect(out).toBeNull();
  });

  it("returns null when a multi-item collection is asked for the singleton slug", async () => {
    const out = await readItemOrSingletonDraft(stubStore(null), "tour-dates", "_singleton", multiItemDef);
    expect(out).toBeNull();
  });
});
