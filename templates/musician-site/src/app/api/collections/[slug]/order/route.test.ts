/**
 * Tests for PUT /api/collections/<slug>/order — replaces the legacy
 * `siteConfig.pageOrder` fan-out from /api/save-config.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));
vi.mock("@/lib/publish", async () => {
  const actual = await vi.importActual<typeof import("@/lib/publish")>("@/lib/publish");
  return { ...actual, saveToDraft: publishMock };
});

import { PUT } from "./route";
import { PAGES_FIELD_IDS, PREBAKED_COLLECTIONS, pagesCollectionDef } from "@/lib/collections/seeds";
import { __resetBootstrapCacheForTests } from "@/lib/content";
import { generateItemId, readOrder, writeCollectionDef, writeItem } from "@/lib/collections";

async function seedPage(slug: string, title: string) {
  const now = new Date().toISOString();
  await writeItem(
    "pages",
    slug,
    {
      id: generateItemId(),
      slug,
      createdAt: now,
      updatedAt: now,
      values: {
        [PAGES_FIELD_IDS.title]: { type: "text", value: title },
        [PAGES_FIELD_IDS.body]: {
          type: "puckContent",
          value: { content: [], root: { props: {} } },
        },
      },
    },
    pagesCollectionDef,
  );
}

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-order-api-"));
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
  for (const [slug, def] of Object.entries(PREBAKED_COLLECTIONS)) {
    await writeCollectionDef(slug, def);
  }
});

function ctx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

function jsonReq(body: unknown) {
  return new Request("https://x/api/collections/pages/order", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("PUT /api/collections/[slug]/order", () => {
  it("returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await PUT(jsonReq({ order: ["home", "about"] }), ctx("pages"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid collection slug", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({ order: ["home"] }), ctx("BAD-Slug"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed body (not JSON)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const badReq = new Request("https://x/api/collections/pages/order", {
      method: "PUT",
      body: "not-json",
    });
    const res = await PUT(badReq, ctx("pages"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body doesn't match { order: string[] }", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({ wrong: "shape" }), ctx("pages"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the collection doesn't exist", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({ order: [] }), ctx("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the collection is a singleton", async () => {
    // Singletons have no order; writing one would be silently ignored
    // by the store anyway. Surface as 400 so the misuse is visible.
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({ order: [] }), ctx("site"));
    expect(res.status).toBe(400);
  });

  it("writes the order file and publishes one collection-order target", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await seedPage("home", "Home");
    await seedPage("about", "About");
    await seedPage("tour", "Tour");
    const order = ["home", "about", "tour"];
    const res = await PUT(jsonReq({ order }), ctx("pages"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const written = await readOrder("pages");
    expect(written).toEqual(order);

    expect(publishMock).toHaveBeenCalledTimes(1);
    const target = publishMock.mock.calls[0][0].targets[0];
    expect(target).toEqual({
      kind: "collection-order",
      collectionSlug: "pages",
      data: order,
    });
  });

  it("accepts an empty order (clears the file effectively)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({ order: [] }), ctx("pages"));
    expect(res.status).toBe(200);
    const written = await readOrder("pages");
    expect(written).toEqual([]);
  });

  it("returns 400 when the order contains unknown item slugs", async () => {
    // Cross-check guard: phantom slugs would otherwise silently land
    // in `_order.json` (the listing layer filters them at read time,
    // but accepting them at the API boundary masks client bugs).
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await seedPage("home", "Home");
    const res = await PUT(jsonReq({ order: ["home", "phantom"] }), ctx("pages"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("phantom");
  });

  it("returns a 502 failure (never ok: true) on broker failure", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const { PublishError } = await import("@/lib/publish");
    publishMock.mockRejectedValueOnce(new PublishError("broker-rejected", "broker rejected"));
    await seedPage("home", "Home");
    const res = await PUT(jsonReq({ order: ["home"] }), ctx("pages"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      ok: boolean;
      code: string;
      error: string;
      publishWarning?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("broker-rejected");
    expect(body.error).toContain("broker rejected");
    expect(body.publishWarning).toBeUndefined();
  });
});
