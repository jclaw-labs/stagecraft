import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));
vi.mock("@/lib/publish", async () => {
  const actual = await vi.importActual<typeof import("@/lib/publish")>("@/lib/publish");
  return { ...actual, publish: publishMock };
});

import { GET, POST } from "./route";
import { DELETE } from "./[slug]/route";
import { PAGES_FIELD_IDS } from "@/lib/collections/seeds";

const TEST_SLUG = "api-test-page";

// Worker-scoped tmpdir keeps these tests isolated from other test files that
// touch the same on-disk paths. The seed page "home" matches what tests
// expect to find by default.
let TMP_CONTENT_DIR: string;
let PAGES_ITEMS_DIR: string;
let TEST_ITEM_PATH: string;
let HOME_ITEM_PATH: string;

const HOME_FIXTURE_ITEM = {
  id: "item_home_fixture",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  values: {
    [PAGES_FIELD_IDS.title]: { type: "text", value: "Home" },
    [PAGES_FIELD_IDS.isSplashPage]: { type: "boolean", value: false },
    [PAGES_FIELD_IDS.isFooterHidden]: { type: "boolean", value: false },
    [PAGES_FIELD_IDS.showInNav]: { type: "boolean", value: true },
    [PAGES_FIELD_IDS.body]: { type: "puckContent", value: { content: [], root: { props: {} } } },
  },
};

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-pagesapi-"));
  PAGES_ITEMS_DIR = path.join(TMP_CONTENT_DIR, "collections/pages/items");
  TEST_ITEM_PATH = path.join(PAGES_ITEMS_DIR, `${TEST_SLUG}.json`);
  HOME_ITEM_PATH = path.join(PAGES_ITEMS_DIR, "home.json");
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  getSessionMock.mockReset();
  publishMock.mockReset();
  publishMock.mockResolvedValue({ commitSha: null, mode: "local" });
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  // Seed the tmpdir with a home page so tests that expect it pass.
  await fs.mkdir(PAGES_ITEMS_DIR, { recursive: true });
  await fs.writeFile(HOME_ITEM_PATH, JSON.stringify(HOME_FIXTURE_ITEM, null, 2) + "\n", "utf-8");
});

afterEach(async () => {
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
});

describe("GET /api/pages", () => {
  it("returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the pages list when signed in", async () => {
    getSessionMock.mockResolvedValue({ email: "artist@example.com" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.pages)).toBe(true);
    // home is seeded above, so it should appear.
    expect(body.pages.find((p: { slug: string }) => p.slug === "home")).toBeTruthy();
  });
});

describe("POST /api/pages", () => {
  it("returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const req = new Request("https://x/api/pages", {
      method: "POST",
      body: JSON.stringify({ slug: TEST_SLUG, title: "Test" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON body", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const req = new Request("https://x/api/pages", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects uppercase slug", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const req = new Request("https://x/api/pages", {
      method: "POST",
      body: JSON.stringify({ slug: "BadSlug", title: "Bad" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("creates a new page, writes it to disk, and publishes", async () => {
    getSessionMock.mockResolvedValue({ email: "artist@example.com" });
    publishMock.mockResolvedValue({ commitSha: "abc", mode: "github" });

    const req = new Request("https://x/api/pages", {
      method: "POST",
      body: JSON.stringify({ slug: TEST_SLUG, title: "Tour 2026" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.slug).toBe(TEST_SLUG);

    // On disk: the page item carries title under the canonical field id.
    const written = JSON.parse(await fs.readFile(TEST_ITEM_PATH, "utf-8"));
    expect(written.values[PAGES_FIELD_IDS.title].value).toBe("Tour 2026");

    // Publish was called with a `collection-item` target for the
    // pages collection.
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

  it("returns 409 when the slug already exists", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // home is already seeded.
    const req = new Request("https://x/api/pages", {
      method: "POST",
      body: JSON.stringify({ slug: "home", title: "Home" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it.each([
    ["news", "posts", "/news"],
    ["releases", "releases", "/releases"],
    ["shows", "tour-dates", "/shows"],
  ])(
    "returns 409 when the slug shadows the %s collection's prefix",
    async (slug, collectionSlug, prefix) => {
      getSessionMock.mockResolvedValue({ email: "a@b.c" });
      const req = new Request("https://x/api/pages", {
        method: "POST",
        body: JSON.stringify({ slug, title: "Conflicting" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain(collectionSlug);
      expect(body.error).toContain(prefix);
      // The page should not have been written, and publish should
      // never have been called.
      expect(publishMock).not.toHaveBeenCalled();
    },
  );

  it("returns ok with publishWarning when local write succeeds but publish fails", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const { PublishError } = await vi.importActual<typeof import("@/lib/publish")>(
      "@/lib/publish",
    );
    publishMock.mockRejectedValue(new PublishError("github-failed", "boom"));

    const req = new Request("https://x/api/pages", {
      method: "POST",
      body: JSON.stringify({ slug: TEST_SLUG, title: "x" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.publishWarning).toContain("boom");
    // Disk state still reflects the create.
    const written = JSON.parse(await fs.readFile(TEST_ITEM_PATH, "utf-8"));
    expect(written.values[PAGES_FIELD_IDS.title].value).toBe("x");
  });
});

describe("DELETE /api/pages/[slug]", () => {
  it("returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await DELETE(new Request("https://x"), {
      params: Promise.resolve({ slug: TEST_SLUG }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid slug", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await DELETE(new Request("https://x"), {
      params: Promise.resolve({ slug: "BAD-SLUG" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the page is missing", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await DELETE(new Request("https://x"), {
      params: Promise.resolve({ slug: "page-that-does-not-exist-anywhere" }),
    });
    expect(res.status).toBe(404);
  });

  it("deletes the file and emits a delete-collection-item publish target", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // Create a valid page item first.
    await fs.writeFile(
      TEST_ITEM_PATH,
      JSON.stringify({
        id: "item_delete_me",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        values: {
          [PAGES_FIELD_IDS.title]: { type: "text", value: "delete me" },
          [PAGES_FIELD_IDS.body]: {
            type: "puckContent",
            value: { content: [], root: { props: {} } },
          },
        },
      }),
      "utf-8",
    );

    const res = await DELETE(new Request("https://x"), {
      params: Promise.resolve({ slug: TEST_SLUG }),
    });
    expect(res.status).toBe(200);
    await expect(fs.access(TEST_ITEM_PATH)).rejects.toThrow();

    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          { kind: "delete-collection-item", collectionSlug: "pages", itemSlug: TEST_SLUG },
        ],
        commitSubject: `Delete page ${TEST_SLUG}`,
      }),
    );
  });
});
