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

import { getDraftChanges, parseChanges } from "./draft-changes";
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
    expect(result).toEqual({ count: 0, changes: [], mode: "local" });
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

  it("returns count=0 when draft and main are in sync (empty files array)", async () => {
    compareCommitsWithBasehead.mockResolvedValue(compareResponse([]));
    const result = await getDraftChanges();
    expect(result).toEqual({ count: 0, changes: [], mode: "github" });
  });

  it("handles the API omitting `files` entirely (treated as zero)", async () => {
    // The Octokit typing has `files?: Array<...>`. A response without
    // any commits between base and head can come back without it.
    compareCommitsWithBasehead.mockResolvedValue(compareResponse(null));
    const result = await getDraftChanges();
    expect(result).toEqual({ count: 0, changes: [], mode: "github" });
  });

  it("returns count=0 when the draft branch doesn't exist yet (fresh site)", async () => {
    // Saving the first item is what creates the branch — until then
    // there's nothing to publish, by definition. The compare endpoint
    // 404s on the head ref in that state; don't surface that as an
    // error.
    compareCommitsWithBasehead.mockRejectedValue(notFound());
    const result = await getDraftChanges();
    expect(result).toEqual({ count: 0, changes: [], mode: "github" });
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

  it("preserves previous_filename + extracts previousItemSlug on renames", () => {
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
