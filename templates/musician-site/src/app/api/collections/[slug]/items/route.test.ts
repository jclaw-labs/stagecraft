/**
 * Tests for the generic collection-items routes
 * (`GET / POST /api/collections/<slug>/items` and
 * `GET / PUT / DELETE /api/collections/<slug>/items/<itemSlug>`).
 *
 * These are also the page editor's and the Pages panel's routes, so
 * the pages-specific behaviour (slug-shadowing check, page commit
 * subjects) is covered here too.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));
vi.mock("@/lib/publish", async () => {
  const actual = await vi.importActual<typeof import("@/lib/publish")>("@/lib/publish");
  return { ...actual, saveToDraft: publishMock };
});

import { GET, POST } from "./route";
import {
  DELETE as DELETE_ITEM,
  GET as GET_ITEM,
  PATCH as PATCH_ITEM,
  PUT as PUT_ITEM,
} from "./[itemSlug]/route";
import {
  PAGES_FIELD_IDS,
  PREBAKED_COLLECTIONS,
} from "@/lib/collections/seeds";
import { __resetBootstrapCacheForTests } from "@/lib/content";
import { writeCollectionDef } from "@/lib/collections";

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-collections-api-"));
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  getSessionMock.mockReset();
  publishMock.mockReset();
  publishMock.mockResolvedValue({ commitSha: null, mode: "local" });
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  __resetBootstrapCacheForTests();
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
  // Seed every prebaked collection def so tests don't depend on the
  // lazy bootstrap timing and can hit /site etc. for singleton checks.
  for (const [slug, def] of Object.entries(PREBAKED_COLLECTIONS)) {
    await writeCollectionDef(slug, def);
  }
});

afterEach(() => {});

function ctx(slug: string, itemSlug?: string) {
  return { params: Promise.resolve(itemSlug ? { slug, itemSlug } : { slug } as { slug: string; itemSlug: string }) };
}

function jsonReq(method: "POST" | "PUT", body: unknown) {
  return new Request("https://x/api/collections/pages/items", {
    method,
    body: JSON.stringify(body),
  });
}

const TEST_SLUG = "tour-2026";
const VALID_VALUES = {
  [PAGES_FIELD_IDS.title]: { type: "text" as const, value: "Tour 2026" },
  [PAGES_FIELD_IDS.body]: {
    type: "puckContent" as const,
    value: { content: [], root: { props: {} } },
  },
};

// ---------------------------------------------------------------------------
// Collection-level routes
// ---------------------------------------------------------------------------

describe("GET /api/collections/[slug]/items", () => {
  it("returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET(new Request("https://x"), ctx("pages"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid slug", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await GET(new Request("https://x"), ctx("BAD-Slug"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown collection", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await GET(new Request("https://x"), ctx("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("lists items with derived labels", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // Create one item directly so the list isn't empty.
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    const res = await GET(new Request("https://x"), ctx("pages"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
    const item = body.items.find((i: { slug: string }) => i.slug === TEST_SLUG);
    expect(item).toBeDefined();
    // Label derives from slugSourceFieldId (title for pages).
    expect(item.label).toBe("Tour 2026");
  });
});

describe("POST /api/collections/[slug]/items", () => {
  it("rejects when slug missing from body", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(jsonReq("POST", { values: VALID_VALUES }), ctx("pages"));
    expect(res.status).toBe(400);
  });

  it("rejects when collection is a singleton (use PUT)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(
      jsonReq("POST", { slug: "anything", values: {} }),
      ctx("site"),
    );
    // site is a singleton — POST should be rejected with 400.
    expect(res.status).toBe(400);
  });

  it("creates a new item and publishes a collection-item target", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    publishMock.mockResolvedValue({ commitSha: "abc", mode: "github" });
    const res = await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.item.slug).toBe(TEST_SLUG);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({
            kind: "collection-item",
            collectionSlug: "pages",
            itemSlug: TEST_SLUG,
          }),
        ],
        commitSubject: `Create page ${TEST_SLUG}`,
      }),
    );
  });

  it("returns 409 on slug collision", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    const res = await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    expect(res.status).toBe(409);
  });

  it("reports a taken slug before validating values", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    // Missing required title: on a fresh slug this would be a 400.
    const res = await POST(
      jsonReq("POST", {
        slug: TEST_SLUG,
        values: { [PAGES_FIELD_IDS.body]: { type: "puckContent", value: { content: [], root: { props: {} } } } },
      }),
      ctx("pages"),
    );
    expect(res.status).toBe(409);
  });

  it("rejects values that fail the per-collection schema", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // Missing required title.
    const res = await POST(
      jsonReq("POST", {
        slug: TEST_SLUG,
        values: { [PAGES_FIELD_IDS.body]: { type: "puckContent", value: { content: [], root: { props: {} } } } },
      }),
      ctx("pages"),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Item-level routes
// ---------------------------------------------------------------------------

describe("GET /api/collections/[slug]/items/[itemSlug]", () => {
  it("returns 404 for a missing item", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await GET_ITEM(new Request("https://x"), ctx("pages", "does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("returns the item + collection def for a hit", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    const res = await GET_ITEM(new Request("https://x"), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.item.slug).toBe(TEST_SLUG);
    expect(body.def.slug).toBe("pages");
  });
});

describe("PUT /api/collections/[slug]/items/[itemSlug]", () => {
  it("updates values, preserving id + createdAt", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const create = await POST(
      jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }),
      ctx("pages"),
    );
    const created = await create.json();

    const updatedValues = {
      ...VALID_VALUES,
      [PAGES_FIELD_IDS.title]: { type: "text" as const, value: "Tour 2027" },
    };
    const res = await PUT_ITEM(jsonReq("PUT", { values: updatedValues }), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.id).toBe(created.item.id);
    expect(body.item.createdAt).toBe(created.item.createdAt);
    expect(body.item.values[PAGES_FIELD_IDS.title].value).toBe("Tour 2027");
  });

  it("rejects values that fail the per-collection schema", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    // Remove the required title field.
    const res = await PUT_ITEM(
      jsonReq("PUT", { values: { [PAGES_FIELD_IDS.body]: { type: "puckContent", value: { content: [], root: { props: {} } } } } }),
      ctx("pages", TEST_SLUG),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    // Structured issues — not a single opaque error string.
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0]).toMatchObject({ path: expect.any(String), message: expect.any(String) });
  });

  it("returns 404 when the item to update doesn't exist (PUT is update-only)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // No item created — PUT against the empty collection should 404,
    // not silently create. Without this, a sibling POST in another
    // tab could race the PUT and clobber the freshly-created item.
    const res = await PUT_ITEM(
      jsonReq("PUT", { values: VALID_VALUES }),
      ctx("pages", "never-created"),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST validation error shape", () => {
  it("returns structured issues, not a flat string", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // Missing the required title field.
    const res = await POST(
      jsonReq("POST", {
        slug: TEST_SLUG,
        values: { [PAGES_FIELD_IDS.body]: { type: "puckContent", value: { content: [], root: { props: {} } } } },
      }),
      ctx("pages"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });
});

describe("DELETE /api/collections/[slug]/items/[itemSlug]", () => {
  it("returns 404 when the item is missing", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await DELETE_ITEM(new Request("https://x"), ctx("pages", "missing"));
    expect(res.status).toBe(404);
  });

  it("removes the file and emits a delete-collection-item publish target", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    const res = await DELETE_ITEM(new Request("https://x"), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(200);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [{ kind: "delete-collection-item", collectionSlug: "pages", itemSlug: TEST_SLUG }],
        commitSubject: `Delete page ${TEST_SLUG}`,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// PATCH = rename. Physically moves items/<old>.json → items/<new>.json,
// keeps the stable `id`, and publishes a write(new) + delete(old) pair.
// ---------------------------------------------------------------------------

describe("PATCH /api/collections/[slug]/items/[itemSlug] (rename)", () => {
  function patchReq(newSlug: unknown) {
    return new Request("https://x/api/collections/pages/items/x", {
      method: "PATCH",
      body: JSON.stringify({ newSlug }),
    });
  }

  it("returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await PATCH_ITEM(patchReq("new-slug"), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid collection slug", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PATCH_ITEM(patchReq("new-slug"), ctx("BAD-Slug", TEST_SLUG));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the body isn't JSON", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const bad = new Request("https://x", { method: "PATCH", body: "not json {" });
    const res = await PATCH_ITEM(bad, ctx("pages", TEST_SLUG));
    expect(res.status).toBe(400);
  });

  it("returns 400 when newSlug is missing or not a string", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    expect((await PATCH_ITEM(patchReq(undefined), ctx("pages", TEST_SLUG))).status).toBe(400);
    expect((await PATCH_ITEM(patchReq(42), ctx("pages", TEST_SLUG))).status).toBe(400);
  });

  it("returns 400 when newSlug is malformed", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PATCH_ITEM(patchReq("Not A Slug"), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(400);
  });

  it("returns 400 when newSlug equals the current slug", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    const res = await PATCH_ITEM(patchReq(TEST_SLUG), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the collection doesn't exist", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PATCH_ITEM(patchReq("new-slug"), ctx("does-not-exist", TEST_SLUG));
    expect(res.status).toBe(404);
  });

  it("returns 404 when the item to rename doesn't exist", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PATCH_ITEM(patchReq("new-slug"), ctx("pages", "never-created"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when newSlug already exists", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: "tour-a", values: VALID_VALUES }), ctx("pages"));
    await POST(jsonReq("POST", { slug: "tour-b", values: VALID_VALUES }), ctx("pages"));
    const res = await PATCH_ITEM(patchReq("tour-b"), ctx("pages", "tour-a"));
    expect(res.status).toBe(409);
  });

  it("renames the item, preserves its id, and publishes write(new) + delete(old)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    publishMock.mockResolvedValue({ commitSha: "ren1", mode: "github" });
    const create = await POST(jsonReq("POST", { slug: "tour-2026", values: VALID_VALUES }), ctx("pages"));
    const created = await create.json();

    const res = await PATCH_ITEM(patchReq("tour-2027"), ctx("pages", "tour-2026"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newSlug).toBe("tour-2027");
    // The stable id survives the rename (cross-collection refs hold).
    expect(body.item.id).toBe(created.item.id);

    // Publish carried both a write(new) and a delete(old) target.
    const targets = publishMock.mock.calls.at(-1)![0].targets;
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "collection-item", collectionSlug: "pages", itemSlug: "tour-2027" }),
        expect.objectContaining({ kind: "delete-collection-item", collectionSlug: "pages", itemSlug: "tour-2026" }),
      ]),
    );

    // New slug resolves; old slug 404s.
    expect((await GET_ITEM(new Request("https://x"), ctx("pages", "tour-2027"))).status).toBe(200);
    expect((await GET_ITEM(new Request("https://x"), ctx("pages", "tour-2026"))).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Pages through the generic routes: what the Pages panel's create and the
// page editor's save rely on.
// ---------------------------------------------------------------------------

const PODCASTS_DEF = {
  schemaVersion: 1,
  slug: "podcasts",
  singularName: "podcast",
  pluralName: "podcasts",
  fields: [{ id: "f_title", key: "title", type: "text", required: true }],
  slugSourceFieldId: "f_title",
  detailUrlPrefix: "/episodes",
  defaultSort: null,
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

async function writePodcastsDef() {
  const dir = path.join(TMP_CONTENT_DIR, "collections", "podcasts");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "_collection.json"), JSON.stringify(PODCASTS_DEF), "utf-8");
}

describe("pages via the generic item routes", () => {
  it("POST returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    expect(res.status).toBe(401);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("POST rejects malformed JSON", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(
      new Request("https://x/api/collections/pages/items", { method: "POST", body: "not json" }),
      ctx("pages"),
    );
    expect(res.status).toBe(400);
  });

  it("POST rejects an uppercase slug", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(jsonReq("POST", { slug: "BadSlug", values: VALID_VALUES }), ctx("pages"));
    expect(res.status).toBe(400);
  });

  it.each([
    ["news", "posts", "/news"],
    ["releases", "releases", "/releases"],
    ["shows", "tour-dates", "/shows"],
  ])(
    "POST returns 409 when a page slug shadows the %s collection's prefix",
    async (slug, collectionSlug, prefix) => {
      getSessionMock.mockResolvedValue({ email: "a@b.c" });
      const res = await POST(jsonReq("POST", { slug, values: VALID_VALUES }), ctx("pages"));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain(collectionSlug);
      expect(body.error).toContain(prefix);
      expect(publishMock).not.toHaveBeenCalled();
      await expect(
        fs.access(path.join(TMP_CONTENT_DIR, "collections/pages/items", `${slug}.json`)),
      ).rejects.toThrow();
    },
  );

  // A fresh site may not have the prebaked collections' defs on disk
  // yet; the check still has to refuse their prefixes from the built-in
  // defs, or the new page would shadow every item route under it.
  it.each([
    ["news", "posts"],
    ["releases", "releases"],
    ["shows", "tour-dates"],
  ])(
    "POST returns 409 for %s when the %s def isn't on disk yet",
    async (slug, collectionSlug) => {
      await fs.rm(path.join(TMP_CONTENT_DIR, "collections", collectionSlug), {
        recursive: true,
        force: true,
      });
      getSessionMock.mockResolvedValue({ email: "a@b.c" });
      const res = await POST(jsonReq("POST", { slug, values: VALID_VALUES }), ctx("pages"));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain(collectionSlug);
      expect(publishMock).not.toHaveBeenCalled();
    },
  );

  it("POST returns 409 when a page slug shadows a custom collection's prefix", async () => {
    await writePodcastsDef();
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(jsonReq("POST", { slug: "episodes", values: VALID_VALUES }), ctx("pages"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("podcasts");
    expect(body.error).toContain("/episodes");
    expect(publishMock).not.toHaveBeenCalled();
  });

  // Create and rename share one 409 order: "slug taken" before
  // "shadows a prefix". A page that predates the collection whose
  // prefix it now shadows hits both.
  it("POST reports a slug that both exists and shadows as taken", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const first = await POST(jsonReq("POST", { slug: "episodes", values: VALID_VALUES }), ctx("pages"));
    expect(first.status).toBe(200);
    await writePodcastsDef();
    publishMock.mockClear();
    const res = await POST(jsonReq("POST", { slug: "episodes", values: VALID_VALUES }), ctx("pages"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('An item with slug "episodes" already exists in collection "pages"');
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("POST checks shadowing only for pages", async () => {
    await writePodcastsDef();
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(
      jsonReq("POST", { slug: "news", values: { f_title: { type: "text", value: "News" } } }),
      ctx("podcasts"),
    );
    expect(res.status).toBe(200);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ commitSubject: "Create podcasts/news" }),
    );
  });

  it("POST returns a 502 failure (never ok: true) when the commit fails", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const { PublishError } = await vi.importActual<typeof import("@/lib/publish")>(
      "@/lib/publish",
    );
    publishMock.mockRejectedValue(new PublishError("github-failed", "boom"));
    const res = await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("github-failed");
    expect(body.error).toContain("boom");
  });

  it("PUT saves a page to the draft with a page commit subject", async () => {
    getSessionMock.mockResolvedValue({ email: "artist@example.com" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    publishMock.mockClear();
    publishMock.mockResolvedValue({ commitSha: "draft-sha", mode: "github" });
    const res = await PUT_ITEM(
      jsonReq("PUT", {
        values: { ...VALID_VALUES, [PAGES_FIELD_IDS.title]: { type: "text", value: "Renamed" } },
      }),
      ctx("pages", TEST_SLUG),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, commitSha: "draft-sha" });
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authorEmail: "artist@example.com",
        commitSubject: `Update page ${TEST_SLUG}`,
        targets: [
          expect.objectContaining({
            kind: "collection-item",
            collectionSlug: "pages",
            itemSlug: TEST_SLUG,
          }),
        ],
      }),
    );
  });

  it.each([
    ["broker-rejected", 502],
    ["github-failed", 502],
    ["concurrent-edit", 409],
  ] as const)("PUT maps a %s commit failure to %i", async (code, status) => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    const { PublishError } = await vi.importActual<typeof import("@/lib/publish")>(
      "@/lib/publish",
    );
    publishMock.mockRejectedValue(new PublishError(code, "nope"));
    const res = await PUT_ITEM(jsonReq("PUT", { values: VALID_VALUES }), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code });
  });

  it("PATCH names a page rename in the commit subject", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    publishMock.mockClear();
    const res = await PATCH_ITEM(
      new Request("https://x", { method: "PATCH", body: JSON.stringify({ newSlug: "tour-2027" }) }),
      ctx("pages", TEST_SLUG),
    );
    expect(res.status).toBe(200);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ commitSubject: `Rename page ${TEST_SLUG} → tour-2027` }),
    );
  });

  function renameReq(newSlug: string) {
    return new Request("https://x", { method: "PATCH", body: JSON.stringify({ newSlug }) });
  }

  it.each([
    ["news", "posts", "/news"],
    ["releases", "releases", "/releases"],
    ["shows", "tour-dates", "/shows"],
  ])(
    "PATCH returns 409 when renaming a page to %s would shadow the %s collection's prefix",
    async (newSlug, collectionSlug, prefix) => {
      getSessionMock.mockResolvedValue({ email: "a@b.c" });
      await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
      publishMock.mockClear();
      const res = await PATCH_ITEM(renameReq(newSlug), ctx("pages", TEST_SLUG));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain(collectionSlug);
      expect(body.error).toContain(prefix);
      expect(publishMock).not.toHaveBeenCalled();
      // The page stays where it was.
      await expect(
        fs.access(path.join(TMP_CONTENT_DIR, "collections/pages/items", `${TEST_SLUG}.json`)),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(TMP_CONTENT_DIR, "collections/pages/items", `${newSlug}.json`)),
      ).rejects.toThrow();
    },
  );

  it("PATCH returns 409 when renaming a page onto a custom collection's prefix", async () => {
    await writePodcastsDef();
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    publishMock.mockClear();
    const res = await PATCH_ITEM(renameReq("episodes"), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("podcasts");
    expect(body.error).toContain("/episodes");
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("PATCH reports a slug that both exists and shadows as taken", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    await POST(jsonReq("POST", { slug: "episodes", values: VALID_VALUES }), ctx("pages"));
    await writePodcastsDef();
    publishMock.mockClear();
    const res = await PATCH_ITEM(renameReq("episodes"), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('An item with slug "episodes" already exists in collection "pages"');
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("PATCH allows renaming a page to a slug that shadows no prefix", async () => {
    await writePodcastsDef();
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    publishMock.mockClear();
    const res = await PATCH_ITEM(renameReq("press"), ctx("pages", TEST_SLUG));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, newSlug: "press" });
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("PATCH checks shadowing only for pages", async () => {
    await writePodcastsDef();
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(
      jsonReq("POST", { slug: "pilot", values: { f_title: { type: "text", value: "Pilot" } } }),
      ctx("podcasts"),
    );
    publishMock.mockClear();
    const res = await PATCH_ITEM(renameReq("news"), ctx("podcasts", "pilot"));
    expect(res.status).toBe(200);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ commitSubject: "Rename podcasts/pilot → news" }),
    );
  });
});
