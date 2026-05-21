import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@octokit/request-error";

const getRef = vi.fn();
const reposGetContent = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    git = { getRef };
    repos = { getContent: reposGetContent };
  },
}));

import {
  listCollectionSlugsFromDraft,
  listItemSlugsFromDraft,
  listItemsInOrderFromDraft,
  readCollectionDefFromDraft,
  readItemFromDraft,
  readOrderFromDraft,
  readSingletonFromDraft,
  resetDraftStoreCache,
  type DraftStoreContext,
} from "./draft-store";
import { tourDatesDef } from "./test-fixtures";
import type { CollectionDef } from "./schema";

const CTX: DraftStoreContext = {
  token: "t",
  owner: "o",
  repo: "r",
  branch: "draft",
};

beforeEach(() => {
  getRef.mockReset();
  reposGetContent.mockReset();
  resetDraftStoreCache();
});

function refResponse(sha: string) {
  return { data: { object: { sha } } };
}

function fileResponse(content: unknown) {
  return {
    data: {
      type: "file",
      content: Buffer.from(JSON.stringify(content)).toString("base64"),
      encoding: "base64",
      sha: "blob-sha",
    },
  };
}

function dirResponse(entries: Array<{ name: string; type: "file" | "dir" }>) {
  return { data: entries };
}

function notFound(): RequestError {
  return new RequestError("Not Found", 404, {
    request: { method: "GET", url: "x", headers: {} },
    response: { status: 404, url: "x", headers: {}, data: {} },
  });
}

const PARIS_ITEM_FILE = {
  id: "item_paris",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  values: {
    f_date: { type: "date", value: "2026-07-15" },
    f_venue: { type: "text", value: "La Cigale" },
    f_city: { type: "text", value: "Paris" },
    f_status: { type: "select", value: "on_sale" },
  },
};

// ---------------------------------------------------------------------------
// readCollectionDefFromDraft
// ---------------------------------------------------------------------------

describe("readCollectionDefFromDraft", () => {
  it("returns null when the def file doesn't exist on the branch", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValue(notFound());
    const result = await readCollectionDefFromDraft(CTX, "tour-dates");
    expect(result).toBeNull();
  });

  it("parses and returns the def when present", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(fileResponse(tourDatesDef()));
    const result = await readCollectionDefFromDraft(CTX, "tour-dates");
    expect(result?.slug).toBe("tour-dates");
  });

  it("rejects an invalid collection slug shape at the boundary", async () => {
    await expect(
      readCollectionDefFromDraft(CTX, "Invalid SLUG"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// readItemFromDraft
// ---------------------------------------------------------------------------

describe("readItemFromDraft", () => {
  it("returns null when the item file doesn't exist", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValue(notFound());
    const result = await readItemFromDraft(
      CTX,
      "tour-dates",
      "ghost",
      tourDatesDef(),
    );
    expect(result).toBeNull();
  });

  it("parses + adds the slug from the path", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(fileResponse(PARIS_ITEM_FILE));
    const result = await readItemFromDraft(
      CTX,
      "tour-dates",
      "paris-2026",
      tourDatesDef(),
    );
    expect(result?.slug).toBe("paris-2026");
    expect(result?.id).toBe("item_paris");
  });
});

// ---------------------------------------------------------------------------
// readSingletonFromDraft
// ---------------------------------------------------------------------------

describe("readSingletonFromDraft", () => {
  it("reads from `_singleton.json` in the items dir", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(fileResponse(PARIS_ITEM_FILE));
    await readSingletonFromDraft(CTX, "tour-dates", tourDatesDef());
    expect(reposGetContent).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "src/content/collections/tour-dates/items/_singleton.json",
        ref: "draft",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// listItemSlugsFromDraft
// ---------------------------------------------------------------------------

describe("listItemSlugsFromDraft", () => {
  it("returns slugs filtered by slugSchema, sorted alphabetically", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(
      dirResponse([
        { name: "paris-2026.json", type: "file" },
        { name: "berlin-2026.json", type: "file" },
        // Reserved files filtered by slugSchema's leading-underscore rule.
        { name: "_order.json", type: "file" },
        { name: "_singleton.json", type: "file" },
        // Non-JSON ignored.
        { name: "README.md", type: "file" },
        // Sub-directories ignored.
        { name: "drafts", type: "dir" },
      ]),
    );
    const result = await listItemSlugsFromDraft(CTX, "tour-dates");
    expect(result).toEqual(["berlin-2026", "paris-2026"]);
  });

  it("returns [] for a missing items directory", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValue(notFound());
    const result = await listItemSlugsFromDraft(CTX, "tour-dates");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listItemsInOrderFromDraft
// ---------------------------------------------------------------------------

describe("listItemsInOrderFromDraft", () => {
  // tourDatesDef has defaultSort: { mode: "fieldSort" } — most tests
  // override to `defaultSort: null` to isolate the slug-order
  // fallback path. The fieldSort + manual paths get their own tests
  // further down.
  const tourDatesDefSlugOrder = (): CollectionDef => ({
    ...tourDatesDef(),
    defaultSort: null,
  });

  it("fetches each item file in parallel and returns them sorted by slug", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("/items")) {
        return dirResponse([
          { name: "paris-2026.json", type: "file" },
          { name: "berlin-2026.json", type: "file" },
        ]);
      }
      if (path.endsWith("paris-2026.json")) {
        return fileResponse({ ...PARIS_ITEM_FILE, id: "item_paris" });
      }
      if (path.endsWith("berlin-2026.json")) {
        return fileResponse({ ...PARIS_ITEM_FILE, id: "item_berlin" });
      }
      throw notFound();
    });
    const result = await listItemsInOrderFromDraft(
      CTX,
      "tour-dates",
      tourDatesDefSlugOrder(),
    );
    expect(result.map((i) => i.slug)).toEqual(["berlin-2026", "paris-2026"]);
    expect(result[0].id).toBe("item_berlin");
    expect(result[1].id).toBe("item_paris");
  });

  it("returns [] when the items dir doesn't exist", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValue(notFound());
    const result = await listItemsInOrderFromDraft(
      CTX,
      "tour-dates",
      tourDatesDefSlugOrder(),
    );
    expect(result).toEqual([]);
  });

  it("amortises the SHA fetch — one getRef for N items, not N+1", async () => {
    // Pre-PR this called getRef once per item; for 500 items that
    // added ~25s of latency. Pin it here so a future refactor that
    // re-introduces the per-item getRef shows up in CI.
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("/items")) {
        return dirResponse([
          { name: "a.json", type: "file" },
          { name: "b.json", type: "file" },
          { name: "c.json", type: "file" },
        ]);
      }
      return fileResponse({ ...PARIS_ITEM_FILE, id: `item_${path}` });
    });
    await listItemsInOrderFromDraft(CTX, "tour-dates", tourDatesDefSlugOrder());
    // One getRef for the list operation, regardless of item count.
    expect(getRef).toHaveBeenCalledTimes(1);
  });

  it("sorts by `_order.json` when defaultSort.mode === 'manual'", async () => {
    const def: CollectionDef = {
      ...tourDatesDef(),
      defaultSort: { mode: "manual" },
    };
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("/items")) {
        return dirResponse([
          { name: "berlin.json", type: "file" },
          { name: "paris.json", type: "file" },
          { name: "tokyo.json", type: "file" },
        ]);
      }
      if (path.endsWith("/items/_order.json")) {
        return fileResponse(["tokyo", "berlin", "paris"]);
      }
      if (path.endsWith("paris.json")) return fileResponse({ ...PARIS_ITEM_FILE, id: "item_paris" });
      if (path.endsWith("berlin.json")) return fileResponse({ ...PARIS_ITEM_FILE, id: "item_berlin" });
      if (path.endsWith("tokyo.json")) return fileResponse({ ...PARIS_ITEM_FILE, id: "item_tokyo" });
      throw notFound();
    });
    const result = await listItemsInOrderFromDraft(CTX, "tour-dates", def);
    expect(result.map((i) => i.slug)).toEqual(["tokyo", "berlin", "paris"]);
  });

  it("appends unordered items alphabetically when manual `_order.json` only partially covers them", async () => {
    // The `_order.json` knows about tokyo + berlin but a new item
    // (paris) was added without re-saving the order. The unknown
    // item falls to the end in alphabetic position — same contract
    // store.ts's listItemsInOrder honours.
    const def: CollectionDef = {
      ...tourDatesDef(),
      defaultSort: { mode: "manual" },
    };
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("/items")) {
        return dirResponse([
          { name: "amsterdam.json", type: "file" },
          { name: "berlin.json", type: "file" },
          { name: "tokyo.json", type: "file" },
        ]);
      }
      if (path.endsWith("/items/_order.json")) {
        return fileResponse(["tokyo", "berlin"]);
      }
      return fileResponse({ ...PARIS_ITEM_FILE, id: `item_${path}` });
    });
    const result = await listItemsInOrderFromDraft(CTX, "tour-dates", def);
    expect(result.map((i) => i.slug)).toEqual(["tokyo", "berlin", "amsterdam"]);
  });

  it("falls back to alphabetic when manual mode has no `_order.json` on disk", async () => {
    const def: CollectionDef = {
      ...tourDatesDef(),
      defaultSort: { mode: "manual" },
    };
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("/items")) {
        return dirResponse([
          { name: "berlin.json", type: "file" },
          { name: "amsterdam.json", type: "file" },
        ]);
      }
      if (path.endsWith("/items/_order.json")) throw notFound();
      return fileResponse({ ...PARIS_ITEM_FILE, id: `item_${path}` });
    });
    const result = await listItemsInOrderFromDraft(CTX, "tour-dates", def);
    expect(result.map((i) => i.slug)).toEqual(["amsterdam", "berlin"]);
  });

  it("sorts by field value (asc) when defaultSort.mode === 'fieldSort'", async () => {
    // tourDatesDef's defaultSort is { mode: "fieldSort", fieldId:
    // "f_date", direction: "asc" } — so we go through the same code
    // path the public site relies on. Berlin earlier than Paris by
    // date, so berlin sorts first regardless of slug order.
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("/items")) {
        return dirResponse([
          { name: "paris.json", type: "file" },
          { name: "berlin.json", type: "file" },
        ]);
      }
      if (path.endsWith("paris.json")) {
        return fileResponse({
          ...PARIS_ITEM_FILE,
          id: "item_paris",
          values: {
            ...PARIS_ITEM_FILE.values,
            f_date: { type: "date", value: "2026-07-15" },
          },
        });
      }
      if (path.endsWith("berlin.json")) {
        return fileResponse({
          ...PARIS_ITEM_FILE,
          id: "item_berlin",
          values: {
            ...PARIS_ITEM_FILE.values,
            f_date: { type: "date", value: "2026-05-01" },
          },
        });
      }
      throw notFound();
    });
    const result = await listItemsInOrderFromDraft(CTX, "tour-dates", tourDatesDef());
    expect(result.map((i) => i.slug)).toEqual(["berlin", "paris"]);
  });

  it("respects `direction: 'desc'` on fieldSort", async () => {
    const def: CollectionDef = {
      ...tourDatesDef(),
      defaultSort: { mode: "fieldSort", fieldId: "f_date", direction: "desc" },
    };
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("/items")) {
        return dirResponse([
          { name: "paris.json", type: "file" },
          { name: "berlin.json", type: "file" },
        ]);
      }
      if (path.endsWith("paris.json")) {
        return fileResponse({
          ...PARIS_ITEM_FILE,
          id: "item_paris",
          values: {
            ...PARIS_ITEM_FILE.values,
            f_date: { type: "date", value: "2026-07-15" },
          },
        });
      }
      if (path.endsWith("berlin.json")) {
        return fileResponse({
          ...PARIS_ITEM_FILE,
          id: "item_berlin",
          values: {
            ...PARIS_ITEM_FILE.values,
            f_date: { type: "date", value: "2026-05-01" },
          },
        });
      }
      throw notFound();
    });
    const result = await listItemsInOrderFromDraft(CTX, "tour-dates", def);
    expect(result.map((i) => i.slug)).toEqual(["paris", "berlin"]);
  });
});

// ---------------------------------------------------------------------------
// readOrderFromDraft
// ---------------------------------------------------------------------------

describe("readOrderFromDraft", () => {
  it("returns null when _order.json doesn't exist", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValue(notFound());
    const result = await readOrderFromDraft(CTX, "tour-dates");
    expect(result).toBeNull();
  });

  it("parses the slug array when present", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(
      fileResponse(["paris-2026", "berlin-2026"]),
    );
    const result = await readOrderFromDraft(CTX, "tour-dates");
    expect(result).toEqual(["paris-2026", "berlin-2026"]);
  });
});

// ---------------------------------------------------------------------------
// listCollectionSlugsFromDraft
// ---------------------------------------------------------------------------

describe("listCollectionSlugsFromDraft", () => {
  it("returns directories matching slugSchema, sorted", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(
      dirResponse([
        { name: "tour-dates", type: "dir" },
        { name: "pages", type: "dir" },
        // Files at the collections root aren't collections.
        { name: "README.md", type: "file" },
        // Reserved (leading underscore) — filtered.
        { name: "_archive", type: "dir" },
      ]),
    );
    const result = await listCollectionSlugsFromDraft(CTX);
    expect(result).toEqual(["pages", "tour-dates"]);
  });

  it("returns [] when the collections directory doesn't exist", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValue(notFound());
    const result = await listCollectionSlugsFromDraft(CTX);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cache behaviour — SHA-based invalidation
// ---------------------------------------------------------------------------

describe("caching", () => {
  it("serves a second read of the same path from cache when the branch SHA hasn't changed", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(fileResponse(tourDatesDef()));

    await readCollectionDefFromDraft(CTX, "tour-dates");
    await readCollectionDefFromDraft(CTX, "tour-dates");

    // SHA is checked on every call, but the underlying contents fetch
    // hits cache the second time.
    expect(getRef).toHaveBeenCalledTimes(2);
    expect(reposGetContent).toHaveBeenCalledTimes(1);
  });

  it("invalidates the entire branch cache when the SHA changes", async () => {
    // First read at sha-1.
    getRef.mockResolvedValueOnce(refResponse("sha-1"));
    reposGetContent.mockResolvedValueOnce(fileResponse(tourDatesDef()));
    await readCollectionDefFromDraft(CTX, "tour-dates");

    // Second read at sha-2 — cache invalidates, refetches.
    getRef.mockResolvedValueOnce(refResponse("sha-2"));
    reposGetContent.mockResolvedValueOnce(fileResponse(tourDatesDef()));
    await readCollectionDefFromDraft(CTX, "tour-dates");

    expect(reposGetContent).toHaveBeenCalledTimes(2);
  });

  it("caches null results too (404 doesn't re-fetch on the next call)", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValueOnce(notFound());
    await readCollectionDefFromDraft(CTX, "tour-dates");
    await readCollectionDefFromDraft(CTX, "tour-dates");
    // First call attempts the fetch + 404; second call serves the
    // cached null without hitting GitHub again.
    expect(reposGetContent).toHaveBeenCalledTimes(1);
  });

  it("caches different paths independently", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockImplementation(async ({ path }: { path: string }) => {
      if (path.endsWith("_collection.json")) {
        return fileResponse(tourDatesDef());
      }
      throw notFound();
    });

    await readCollectionDefFromDraft(CTX, "tour-dates");
    await readItemFromDraft(CTX, "tour-dates", "ghost", tourDatesDef());

    // Two distinct paths → two getContent calls, both cached
    // separately. Repeating either hits cache.
    expect(reposGetContent).toHaveBeenCalledTimes(2);
    await readCollectionDefFromDraft(CTX, "tour-dates");
    await readItemFromDraft(CTX, "tour-dates", "ghost", tourDatesDef());
    expect(reposGetContent).toHaveBeenCalledTimes(2);
  });

  it("caches per (owner, repo, branch) tuple — different branches use different caches", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue(fileResponse(tourDatesDef()));

    await readCollectionDefFromDraft(CTX, "tour-dates");
    // Same owner/repo, different branch → separate cache.
    await readCollectionDefFromDraft(
      { ...CTX, branch: "main" },
      "tour-dates",
    );

    expect(reposGetContent).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Error propagation — non-404 errors bubble
// ---------------------------------------------------------------------------

describe("error propagation", () => {
  it("propagates a non-404 error from getContent", async () => {
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValue(new Error("rate limit"));
    await expect(
      readCollectionDefFromDraft(CTX, "tour-dates"),
    ).rejects.toThrow("rate limit");
  });

  it("propagates errors from getRef (branch fetch)", async () => {
    getRef.mockRejectedValue(new Error("branch fetch failed"));
    await expect(
      readCollectionDefFromDraft(CTX, "tour-dates"),
    ).rejects.toThrow("branch fetch failed");
  });

  it("surfaces a typed `branch-missing` error when the branch itself 404s", async () => {
    // A fresh site without a draft branch yet — legitimate empty
    // state, not an outage. The facade decides whether to fall back
    // to main or surface a "no draft yet" UX.
    getRef.mockRejectedValue(notFound());
    await expect(
      readCollectionDefFromDraft(CTX, "tour-dates"),
    ).rejects.toMatchObject({ name: "DraftReadError", code: "branch-missing" });
  });

  it("surfaces a typed `too-large` error when a file exceeds the Contents API limit", async () => {
    // Files >1 MB come back from getContent with `encoding: "none"`
    // and empty `content`. Without the explicit check, we'd
    // `JSON.parse("")` and throw a baffling SyntaxError. Typed
    // error tells the facade to retry via Git Blob API (or fall
    // back to the FS snapshot).
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockResolvedValue({
      data: { type: "file", encoding: "none", content: "", size: 2_000_000, sha: "blob-sha" },
    });
    await expect(
      readCollectionDefFromDraft(CTX, "tour-dates"),
    ).rejects.toMatchObject({ name: "DraftReadError", code: "too-large" });
  });

  it("clears the cached promise when the fetcher throws (retry isn't stuck on a stale rejection)", async () => {
    // Promise-cache foot-gun: if a failed fetcher's rejection sat
    // in the cache, every subsequent reader would replay the error
    // until the branch SHA moved. This test pins the cleanup that
    // makes a retry succeed.
    getRef.mockResolvedValue(refResponse("sha-1"));
    reposGetContent.mockRejectedValueOnce(new Error("transient"));
    await expect(
      readCollectionDefFromDraft(CTX, "tour-dates"),
    ).rejects.toThrow("transient");
    // Second call: same SHA → cache still pinned, but the failed
    // promise should be gone. Provide a real response and assert
    // it lands without the error replaying.
    reposGetContent.mockResolvedValueOnce(fileResponse(tourDatesDef()));
    const result = await readCollectionDefFromDraft(CTX, "tour-dates");
    expect(result?.slug).toBe("tour-dates");
  });
});

// ---------------------------------------------------------------------------
// Concurrency — two callers, one network roundtrip
// ---------------------------------------------------------------------------

describe("concurrency", () => {
  it("dedupes two concurrent reads of the same path at the same SHA", async () => {
    // Caching the promise (not the resolved value) lets the second
    // caller await the first's in-flight fetcher rather than
    // racing a duplicate request. Catches the pre-PR per-call
    // duplicate-fetch behaviour under bursty admin reads after a
    // save (when the SHA just moved).
    getRef.mockResolvedValue(refResponse("sha-1"));
    let resolveContent: ((v: unknown) => void) | null = null;
    reposGetContent.mockReturnValue(
      new Promise((resolve) => {
        resolveContent = resolve;
      }),
    );

    const p1 = readCollectionDefFromDraft(CTX, "tour-dates");
    const p2 = readCollectionDefFromDraft(CTX, "tour-dates");

    // Both calls in flight against the same path. Only one
    // getContent should have fired.
    await Promise.resolve();
    await Promise.resolve();
    expect(reposGetContent).toHaveBeenCalledTimes(1);

    resolveContent!(fileResponse(tourDatesDef()));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1?.slug).toBe("tour-dates");
    expect(r2?.slug).toBe("tour-dates");
  });
});
