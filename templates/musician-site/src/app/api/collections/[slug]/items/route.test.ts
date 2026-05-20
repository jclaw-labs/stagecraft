/**
 * Tests for the generic collection-items routes
 * (`GET / POST /api/collections/<slug>/items` and
 * `GET / PUT / DELETE /api/collections/<slug>/items/<itemSlug>`).
 *
 * The wrapper layer for legacy pages/singletons is tested separately
 * in `api/pages/route.test.ts` and `api/save-config/route.test.ts`.
 * These tests focus on the generic surface — what the schema and item
 * editors (PR 4+) consume directly.
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
      }),
    );
  });

  it("returns 409 on slug collision", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
    const res = await POST(jsonReq("POST", { slug: TEST_SLUG, values: VALID_VALUES }), ctx("pages"));
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
      }),
    );
  });
});
