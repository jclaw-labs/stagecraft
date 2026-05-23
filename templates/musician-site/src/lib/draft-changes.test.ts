import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestError } from "@octokit/request-error";

const { compareCommitsWithBasehead } = vi.hoisted(() => ({
  compareCommitsWithBasehead: vi.fn(),
}));
vi.mock("@octokit/rest", () => ({
  Octokit: class {
    repos = { compareCommitsWithBasehead };
  },
}));

const { fetchPublishTokenMock } = vi.hoisted(() => ({
  fetchPublishTokenMock: vi.fn(),
}));
vi.mock("./publish", async () => {
  const actual = await vi.importActual<typeof import("./publish")>("./publish");
  return { ...actual, fetchPublishToken: fetchPublishTokenMock };
});

import {
  changeKey,
  enrichItemLabels,
  getDraftChanges,
  getHasPendingSingletonChange,
  getPendingItemSlugs,
  parseChanges,
  resolveSelectedChangePaths,
  type DraftChange,
} from "./draft-changes";
import { type CollectionDef, type Item, type ReadStore } from "./collections";
import { PublishError } from "./publish";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  compareCommitsWithBasehead.mockReset();
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

function compareResponse(
  files: Array<{ filename: string; status: string; previous_filename?: string }> | null,
) {
  return { data: { files: files ?? undefined } };
}

function notFound(): RequestError {
  return new RequestError("Not Found", 404, {
    request: { method: "GET", url: "x", headers: {} },
    response: { status: 404, url: "x", headers: {}, data: {} },
  });
}

describe("getDraftChanges", () => {
  it("returns local + count=0 + empty changes when the platform isn't configured", async () => {
    delete process.env.STAGECRAFT_SITE_ID;
    delete process.env.STAGECRAFT_BROKER_SECRET;
    const result = await getDraftChanges();
    expect(result).toEqual({ count: 0, changes: [], mode: "local", truncated: false });
    expect(fetchPublishTokenMock).not.toHaveBeenCalled();
  });

  it("parses item changes from the compare API", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        { filename: "src/content/collections/pages/items/home.json", status: "modified" },
        { filename: "src/content/collections/pages/items/about.json", status: "added" },
        { filename: "src/content/collections/photos/items/sunset.json", status: "removed" },
      ]),
    );
    const result = await getDraftChanges();
    expect(result.mode).toBe("github");
    expect(result.count).toBe(3);
    expect(result.changes).toEqual([
      {
        kind: "item",
        status: "modified",
        collectionSlug: "pages",
        itemSlug: "home",
        path: "src/content/collections/pages/items/home.json",
      },
      {
        kind: "item",
        status: "added",
        collectionSlug: "pages",
        itemSlug: "about",
        path: "src/content/collections/pages/items/about.json",
      },
      {
        kind: "item",
        status: "removed",
        collectionSlug: "photos",
        itemSlug: "sunset",
        path: "src/content/collections/photos/items/sunset.json",
      },
    ]);
    expect(compareCommitsWithBasehead).toHaveBeenCalledWith({
      owner: "artist",
      repo: "site",
      basehead: "main...draft",
    });
  });

  it("returns count=0 + truncated=false when draft and main are in sync (empty files array)", async () => {
    compareCommitsWithBasehead.mockResolvedValue(compareResponse([]));
    const result = await getDraftChanges();
    expect(result).toEqual({
      count: 0,
      changes: [],
      mode: "github",
      truncated: false,
    });
  });

  it("handles the API omitting `files` entirely (treated as zero)", async () => {
    // The Octokit typing has `files?: Array<...>`. A response without
    // any commits between base and head can come back without it.
    compareCommitsWithBasehead.mockResolvedValue(compareResponse(null));
    const result = await getDraftChanges();
    expect(result).toEqual({
      count: 0,
      changes: [],
      mode: "github",
      truncated: false,
    });
  });

  it("flags truncated=true when the compare API returns the 300-file cap", async () => {
    // GitHub's compare endpoint caps `files` at 300 with no pagination.
    // Any response that fills the cap means we can't be sure whether
    // there were exactly 300 changes or more — surface as truncated so
    // the UI renders "300+".
    const files = Array.from({ length: 300 }, (_, i) => ({
      filename: `src/content/collections/pages/items/p${i}.json`,
      status: "modified",
    }));
    compareCommitsWithBasehead.mockResolvedValue(compareResponse(files));
    const result = await getDraftChanges();
    expect(result.truncated).toBe(true);
    expect(result.count).toBe(300);
  });

  it("leaves truncated=false when the file count is below the cap", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      filename: `src/content/collections/pages/items/p${i}.json`,
      status: "modified",
    }));
    compareCommitsWithBasehead.mockResolvedValue(compareResponse(files));
    const result = await getDraftChanges();
    expect(result.truncated).toBe(false);
  });


  it("returns count=0 when the draft branch doesn't exist yet (fresh site)", async () => {
    // Saving the first item is what creates the branch — until then
    // there's nothing to publish, by definition. The compare endpoint
    // 404s on the head ref in that state; don't surface that as an
    // error.
    compareCommitsWithBasehead.mockRejectedValue(notFound());
    const result = await getDraftChanges();
    expect(result).toEqual({ count: 0, changes: [], mode: "github", truncated: false });
  });

  it("re-throws as DraftChangesError(github-failed) on non-404 GitHub errors", async () => {
    const serverErr = new RequestError("Internal Server Error", 500, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 500, url: "x", headers: {}, data: {} },
    });
    compareCommitsWithBasehead.mockRejectedValue(serverErr);
    await expect(getDraftChanges()).rejects.toMatchObject({
      name: "DraftChangesError",
      code: "github-failed",
      // The message extracts `.message` rather than `String(cause)` —
      // "Internal Server Error" instead of "HttpError: Internal Server
      // Error". The compare-path prefix is preserved for context.
      message: "compare main...draft: Internal Server Error",
    });
  });

  it("uses cause.message (not the toString) in the github-failed bubble", async () => {
    // Generic Error, not a RequestError. `String(new Error("boom"))`
    // would yield "Error: boom"; we want just "boom".
    compareCommitsWithBasehead.mockRejectedValue(new Error("ENOTFOUND github.com"));
    await expect(getDraftChanges()).rejects.toMatchObject({
      name: "DraftChangesError",
      code: "github-failed",
      message: "compare main...draft: ENOTFOUND github.com",
    });
  });

  it("re-throws as DraftChangesError(broker-unreachable) when the broker is offline", async () => {
    fetchPublishTokenMock.mockRejectedValue(
      new PublishError("broker-unreachable", "platform down"),
    );
    await expect(getDraftChanges()).rejects.toMatchObject({
      name: "DraftChangesError",
      code: "broker-unreachable",
    });
    expect(compareCommitsWithBasehead).not.toHaveBeenCalled();
  });

  it("re-throws as DraftChangesError(broker-rejected) on bad per-site secret", async () => {
    fetchPublishTokenMock.mockRejectedValue(
      new PublishError("broker-rejected", "unknown site"),
    );
    await expect(getDraftChanges()).rejects.toMatchObject({
      name: "DraftChangesError",
      code: "broker-rejected",
    });
  });
});

describe("parseChanges", () => {
  it("classifies singleton item paths as kind=singleton (not item)", () => {
    const out = parseChanges([
      {
        filename: "src/content/collections/site/items/_singleton.json",
        status: "modified",
      },
    ]);
    expect(out).toEqual([
      {
        kind: "singleton",
        status: "modified",
        collectionSlug: "site",
        path: "src/content/collections/site/items/_singleton.json",
      },
    ]);
  });

  it("classifies _order.json as kind=order", () => {
    const out = parseChanges([
      {
        filename: "src/content/collections/pages/items/_order.json",
        status: "modified",
      },
    ]);
    expect(out).toEqual([
      {
        kind: "order",
        status: "modified",
        collectionSlug: "pages",
        path: "src/content/collections/pages/items/_order.json",
      },
    ]);
  });

  it("classifies _collection.json as kind=def", () => {
    const out = parseChanges([
      {
        filename: "src/content/collections/tour-dates/_collection.json",
        status: "added",
      },
    ]);
    expect(out).toEqual([
      {
        kind: "def",
        status: "added",
        collectionSlug: "tour-dates",
        path: "src/content/collections/tour-dates/_collection.json",
      },
    ]);
  });

  it("collapses image variants to one entry per (contentSlug, imageId)", () => {
    // One image upload produces seven files (original + 3 widths × 2
    // formats). Showing seven entries would mislead the artist into
    // thinking they made seven changes.
    const id = "abc123def456";
    const out = parseChanges([
      { filename: `public/images/header/${id}/original.png`, status: "added" },
      { filename: `public/images/header/${id}/400.webp`, status: "added" },
      { filename: `public/images/header/${id}/400.avif`, status: "added" },
      { filename: `public/images/header/${id}/800.webp`, status: "added" },
      { filename: `public/images/header/${id}/800.avif`, status: "added" },
      { filename: `public/images/header/${id}/1600.webp`, status: "added" },
      { filename: `public/images/header/${id}/1600.avif`, status: "added" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "image",
      status: "added",
      contentSlug: "header",
      imageId: id,
      path: `public/images/header/${id}/original.png`,
    });
  });

  it("keeps distinct image ids as separate entries", () => {
    const out = parseChanges([
      { filename: "public/images/header/aaa/original.png", status: "added" },
      { filename: "public/images/header/aaa/400.webp", status: "added" },
      { filename: "public/images/header/bbb/original.jpg", status: "added" },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => (c.kind === "image" ? c.imageId : null))).toEqual(["aaa", "bbb"]);
  });

  it("falls through to kind=other for paths outside known shapes", () => {
    const out = parseChanges([
      { filename: "package.json", status: "modified" },
      { filename: "src/some/other/file.ts", status: "added" },
    ]);
    expect(out).toEqual([
      { kind: "other", status: "modified", path: "package.json" },
      { kind: "other", status: "added", path: "src/some/other/file.ts" },
    ]);
  });

  it("preserves previous_filename + extracts previousItemSlug on same-collection renames", () => {
    const out = parseChanges([
      {
        filename: "src/content/collections/pages/items/about.json",
        status: "renamed",
        previous_filename: "src/content/collections/pages/items/old-about.json",
      },
    ]);
    expect(out[0]).toMatchObject({
      kind: "item",
      status: "renamed",
      previousPath: "src/content/collections/pages/items/old-about.json",
      previousItemSlug: "old-about",
    });
    // Same collection on both sides — previousCollectionSlug stays
    // unset so the modal renders the compact form.
    expect((out[0] as { previousCollectionSlug?: string }).previousCollectionSlug).toBeUndefined();
  });

  it("extracts previousCollectionSlug when the rename crosses collections", () => {
    // Hand-moved file across collections — our `renameItem` flow is
    // single-collection, but GitHub's similarity heuristic may
    // detect a manual move as a rename and set previous_filename
    // accordingly.
    const out = parseChanges([
      {
        filename: "src/content/collections/photos/items/sunset.json",
        status: "renamed",
        previous_filename: "src/content/collections/pages/items/sunset.json",
      },
    ]);
    expect(out[0]).toMatchObject({
      kind: "item",
      status: "renamed",
      collectionSlug: "photos",
      itemSlug: "sunset",
      previousItemSlug: "sunset",
      previousCollectionSlug: "pages",
    });
  });

  it("leaves previousItemSlug unset when previous_filename isn't an item path", () => {
    // Cross-directory move — the previous path doesn't parse as an
    // item file shape. Keep previousPath as fallback for raw display.
    const out = parseChanges([
      {
        filename: "src/content/collections/pages/items/about.json",
        status: "renamed",
        previous_filename: "drafts/about.json",
      },
    ]);
    const item = out[0] as Extract<typeof out[number], { kind: "item" }>;
    expect(item.previousPath).toBe("drafts/about.json");
    expect(item.previousItemSlug).toBeUndefined();
  });

  it("leaves previousItemSlug unset when previous_filename is the singleton/order shape", () => {
    // These aren't artist-edit renames in any meaningful sense —
    // singleton filename is fixed (`_singleton.json`), and `_order.json`
    // isn't an item. Don't synthesise a rename arrow for these.
    const out = parseChanges([
      {
        filename: "src/content/collections/site/items/_singleton.json",
        status: "renamed",
        previous_filename: "src/content/collections/site/items/_singleton.json",
      },
    ]);
    expect(out[0].kind).toBe("singleton");
  });

  it("normalizes GitHub's `changed` / `copied` statuses to modified", () => {
    const out = parseChanges([
      { filename: "src/content/collections/a/items/x.json", status: "changed" },
      { filename: "src/content/collections/a/items/y.json", status: "copied" },
    ]);
    expect(out.map((c) => c.status)).toEqual(["modified", "modified"]);
  });

  it("filters out `unchanged` entries (defensive — compare doesn't return these)", () => {
    const out = parseChanges([
      { filename: "src/content/collections/a/items/x.json", status: "unchanged" },
      { filename: "src/content/collections/a/items/y.json", status: "modified" },
    ]);
    expect(out).toHaveLength(1);
    expect((out[0] as { itemSlug: string }).itemSlug).toBe("y");
  });
});

describe("getPendingItemSlugs", () => {
  it("returns the slugs with pending changes in the requested collection", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        { filename: "src/content/collections/photos/items/sunset.json", status: "modified" },
        { filename: "src/content/collections/photos/items/dawn.json", status: "added" },
        { filename: "src/content/collections/pages/items/about.json", status: "modified" },
      ]),
    );
    const slugs = await getPendingItemSlugs("photos");
    expect(slugs).toEqual(new Set(["sunset", "dawn"]));
  });

  it("returns an empty set when nothing in the collection is pending", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        { filename: "src/content/collections/pages/items/about.json", status: "modified" },
      ]),
    );
    expect(await getPendingItemSlugs("photos")).toEqual(new Set());
  });

  it("degrades to an empty set when the platform isn't configured (local mode)", async () => {
    delete process.env.STAGECRAFT_SITE_ID;
    expect(await getPendingItemSlugs("photos")).toEqual(new Set());
    expect(compareCommitsWithBasehead).not.toHaveBeenCalled();
  });

  it("degrades to an empty set on a GitHub failure rather than throwing", async () => {
    const serverErr = new RequestError("Server Error", 500, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 500, url: "x", headers: {}, data: {} },
    });
    compareCommitsWithBasehead.mockRejectedValue(serverErr);
    // getDraftChanges would throw DraftChangesError here; the slug
    // helper swallows it so the list renders badge-free.
    expect(await getPendingItemSlugs("photos")).toEqual(new Set());
  });

  it("degrades to an empty set on a broker rejection", async () => {
    fetchPublishTokenMock.mockRejectedValue(
      new PublishError("broker-rejected", "unknown site"),
    );
    expect(await getPendingItemSlugs("photos")).toEqual(new Set());
  });
});

describe("getHasPendingSingletonChange", () => {
  it("is true when the collection's singleton is pending", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        { filename: "src/content/collections/site/items/_singleton.json", status: "modified" },
      ]),
    );
    expect(await getHasPendingSingletonChange("site")).toBe(true);
  });

  it("is false when only other collections / kinds are pending", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        { filename: "src/content/collections/header/items/_singleton.json", status: "modified" },
        { filename: "src/content/collections/pages/items/about.json", status: "modified" },
      ]),
    );
    expect(await getHasPendingSingletonChange("site")).toBe(false);
  });

  it("degrades to false when the platform isn't configured (local mode)", async () => {
    delete process.env.STAGECRAFT_SITE_ID;
    expect(await getHasPendingSingletonChange("site")).toBe(false);
    expect(compareCommitsWithBasehead).not.toHaveBeenCalled();
  });

  it("degrades to false on a GitHub failure rather than throwing", async () => {
    const serverErr = new RequestError("Server Error", 500, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 500, url: "x", headers: {}, data: {} },
    });
    compareCommitsWithBasehead.mockRejectedValue(serverErr);
    expect(await getHasPendingSingletonChange("site")).toBe(false);
  });
});

describe("enrichItemLabels", () => {
  const def = {
    slug: "pages",
    slugSourceFieldId: "fld_title",
  } as unknown as CollectionDef;

  function item(slug: string, title: string): Item {
    return {
      id: `id_${slug}`,
      slug,
      values: { fld_title: { type: "text", value: title } },
    } as unknown as Item;
  }

  function itemChange(itemSlug: string, status: DraftChange["status"] = "modified"): DraftChange {
    return {
      kind: "item",
      status,
      collectionSlug: "pages",
      itemSlug,
      path: `src/content/collections/pages/items/${itemSlug}.json`,
    };
  }

  function makeStore(
    items: Record<string, Item | null>,
    overrides: Partial<ReadStore> = {},
  ): ReadStore {
    return {
      readCollectionDef: vi.fn(async () => def),
      readItem: vi.fn(async (_slug: string, itemSlug: string) => items[itemSlug] ?? null),
      ...overrides,
    } as unknown as ReadStore;
  }

  it("resolves displayName from the slugSource field", async () => {
    const store = makeStore({ home: item("home", "Home Page") });
    const [out] = await enrichItemLabels([itemChange("home")], store);
    expect(out).toMatchObject({ kind: "item", itemSlug: "home", displayName: "Home Page" });
  });

  it("skips removed items (gone from draft) and leaves them un-enriched", async () => {
    const store = makeStore({});
    const [out] = await enrichItemLabels([itemChange("gone", "removed")], store);
    expect(out).not.toHaveProperty("displayName");
    expect(store.readItem).not.toHaveBeenCalled();
  });

  it("leaves non-item changes untouched", async () => {
    const store = makeStore({});
    const singleton: DraftChange = {
      kind: "singleton",
      status: "modified",
      collectionSlug: "site",
      path: "src/content/collections/site/items/_singleton.json",
    };
    const [out] = await enrichItemLabels([singleton], store);
    expect(out).toEqual(singleton);
    expect(store.readItem).not.toHaveBeenCalled();
  });

  it("falls back (no displayName) when the item can't be read", async () => {
    const store = makeStore({ home: null });
    const [out] = await enrichItemLabels([itemChange("home")], store);
    expect(out).not.toHaveProperty("displayName");
  });

  it("reads each collection's def once across multiple items", async () => {
    const store = makeStore({
      home: item("home", "Home"),
      about: item("about", "About Us"),
    });
    const out = await enrichItemLabels([itemChange("home"), itemChange("about")], store);
    expect(out.map((c) => (c.kind === "item" ? c.displayName : null))).toEqual([
      "Home",
      "About Us",
    ]);
    expect(store.readCollectionDef).toHaveBeenCalledTimes(1);
  });

  it("leaves a change un-enriched when its item read throws (one bad item doesn't blank the batch)", async () => {
    const store = makeStore(
      { ok: item("ok", "Fine") },
      {
        readItem: vi.fn(async (_slug: string, itemSlug: string) => {
          if (itemSlug === "boom") throw new Error("read failed");
          return item("ok", "Fine");
        }),
      },
    );
    const out = await enrichItemLabels([itemChange("boom"), itemChange("ok")], store);
    expect(out[0]).not.toHaveProperty("displayName");
    expect(out[1]).toMatchObject({ displayName: "Fine" });
  });
});

describe("changeKey", () => {
  it("derives a stable key per change kind", () => {
    expect(
      changeKey({
        kind: "item",
        status: "modified",
        collectionSlug: "pages",
        itemSlug: "about",
        path: "src/content/collections/pages/items/about.json",
      }),
    ).toBe("item:pages/about");
    expect(
      changeKey({ kind: "singleton", status: "modified", collectionSlug: "site", path: "p" }),
    ).toBe("singleton:site");
    expect(
      changeKey({ kind: "order", status: "modified", collectionSlug: "pages", path: "p" }),
    ).toBe("order:pages");
    expect(
      changeKey({ kind: "def", status: "modified", collectionSlug: "tour-dates", path: "p" }),
    ).toBe("def:tour-dates");
    expect(
      changeKey({
        kind: "image",
        status: "added",
        contentSlug: "hero",
        imageId: "abc123",
        path: "public/images/hero/abc123/original.webp",
      }),
    ).toBe("image:hero/abc123");
    expect(changeKey({ kind: "other", status: "modified", path: "README.md" })).toBe(
      "other:README.md",
    );
  });
});

describe("resolveSelectedChangePaths", () => {
  it("returns empty in dev / unconfigured mode", async () => {
    delete process.env.STAGECRAFT_SITE_ID;
    delete process.env.STAGECRAFT_BROKER_SECRET;
    const res = await resolveSelectedChangePaths(["item:pages/about"]);
    expect(res).toEqual({ copyPaths: [], deletePaths: [] });
    expect(compareCommitsWithBasehead).not.toHaveBeenCalled();
  });

  it("copies an added/modified item and ignores unselected changes", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        { filename: "src/content/collections/pages/items/about.json", status: "modified" },
        { filename: "src/content/collections/pages/items/contact.json", status: "modified" },
      ]),
    );
    const res = await resolveSelectedChangePaths(["item:pages/about"]);
    expect(res).toEqual({
      copyPaths: ["src/content/collections/pages/items/about.json"],
      deletePaths: [],
    });
  });

  it("expands an image selection to all its variant paths", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        { filename: "public/images/hero/abc123/original.webp", status: "added" },
        { filename: "public/images/hero/abc123/400.webp", status: "added" },
        { filename: "public/images/hero/abc123/800.avif", status: "added" },
        { filename: "public/images/other/zzz/original.webp", status: "added" },
      ]),
    );
    const res = await resolveSelectedChangePaths(["image:hero/abc123"]);
    expect(res.deletePaths).toEqual([]);
    expect(res.copyPaths.sort()).toEqual([
      "public/images/hero/abc123/400.webp",
      "public/images/hero/abc123/800.avif",
      "public/images/hero/abc123/original.webp",
    ]);
  });

  it("publishes a rename as copy-new + delete-old", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        {
          filename: "src/content/collections/pages/items/about-us.json",
          status: "renamed",
          previous_filename: "src/content/collections/pages/items/about.json",
        },
      ]),
    );
    // Key uses the NEW slug (what the modal shows).
    const res = await resolveSelectedChangePaths(["item:pages/about-us"]);
    expect(res).toEqual({
      copyPaths: ["src/content/collections/pages/items/about-us.json"],
      deletePaths: ["src/content/collections/pages/items/about.json"],
    });
  });

  it("publishes a deletion as a delete path", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        { filename: "src/content/collections/pages/items/old.json", status: "removed" },
      ]),
    );
    const res = await resolveSelectedChangePaths(["item:pages/old"]);
    expect(res).toEqual({
      copyPaths: [],
      deletePaths: ["src/content/collections/pages/items/old.json"],
    });
  });

  it("ignores selected keys with no matching pending file", async () => {
    compareCommitsWithBasehead.mockResolvedValue(
      compareResponse([
        { filename: "src/content/collections/pages/items/about.json", status: "modified" },
      ]),
    );
    const res = await resolveSelectedChangePaths(["item:pages/ghost"]);
    expect(res).toEqual({ copyPaths: [], deletePaths: [] });
  });
});
