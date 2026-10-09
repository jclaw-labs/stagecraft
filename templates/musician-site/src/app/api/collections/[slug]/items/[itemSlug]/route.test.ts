/**
 * Tests for PUT /api/collections/<slug>/items/<itemSlug>.
 *
 * Focused on the singleton create-on-first-save branch (a singleton's
 * `_singleton.json` is materialized by its first PUT rather than at
 * collection-creation time) and the multi-item update-only guard that
 * still 404s a missing slug.
 *
 * Mirrors the create-route test harness: `getSession` mocked for auth,
 * `saveToDraft` mocked so the publish path doesn't reach the broker, and
 * `STAGECRAFT_CONTENT_DIR` pointed at a tmpdir for the local write.
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

import { DELETE, PATCH, PUT } from "./route";
import {
  collectionDefSchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  readItem,
  readOrder,
  writeCollectionDef,
  writeItem,
  writeOrder,
  type CollectionDef,
  type Item,
} from "@/lib/collections";

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-item-put-"));
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  getSessionMock.mockReset();
  publishMock.mockReset();
  publishMock.mockResolvedValue({ commitSha: null, mode: "local" });
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
});

function defOf(partial: Partial<CollectionDef> & Pick<CollectionDef, "slug">): CollectionDef {
  return collectionDefSchema.parse({
    schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
    singularName: partial.slug,
    pluralName: partial.slug,
    fields: [],
    slugSourceFieldId: null,
    detailUrlPrefix: null,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: false,
    ...partial,
  });
}

function faqItem(slug: string): Item {
  return {
    id: `item_${slug}`,
    slug,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    values: { fld_q: { type: "text", value: `${slug}?` } },
  };
}

function patchReq(slug: string, itemSlug: string, body: unknown) {
  const req = new Request(`https://x/api/collections/${slug}/items/${itemSlug}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ slug, itemSlug }) });
}

function putReq(slug: string, itemSlug: string, body: unknown) {
  const req = new Request(`https://x/api/collections/${slug}/items/${itemSlug}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return PUT(req, { params: Promise.resolve({ slug, itemSlug }) });
}

describe("PUT singleton create-on-first-save", () => {
  it("creates the `_singleton.json` item on the first save of a fieldless singleton", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await writeCollectionDef(
      "booking-info",
      defOf({ slug: "booking-info", isSingleton: true, fields: [] }),
    );

    // No item exists yet — the create route doesn't seed one.
    const def = (await readItem("booking-info", "_singleton", defOf({ slug: "booking-info", isSingleton: true })));
    expect(def).toBeNull();

    const res = await putReq("booking-info", "_singleton", { values: {} });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.item.id).toEqual(expect.any(String));
    expect(out.item.id.length).toBeGreaterThan(0);
    expect(out.item.values).toEqual({});

    // First save stamps createdAt (the create-on-first-save path took
    // the `?? now` branch rather than reusing a non-existent prior item).
    expect(typeof out.item.createdAt).toBe("string");
    expect(out.item.createdAt.length).toBeGreaterThan(0);

    // It's now on disk, and the re-read matches the response exactly.
    const saved = await readItem(
      "booking-info",
      "_singleton",
      defOf({ slug: "booking-info", isSingleton: true }),
    );
    expect(saved).not.toBeNull();
    expect(saved).toEqual(out.item);
  });

  it("creates the singleton with a required field's value on first save", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const def = defOf({
      slug: "booking-info",
      isSingleton: true,
      fields: [{ id: "fld_email", key: "email", type: "email", required: true }],
    });
    await writeCollectionDef("booking-info", def);

    const res = await putReq("booking-info", "_singleton", {
      values: { fld_email: { type: "email", value: "hi@band.com" } },
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.item.values.fld_email).toEqual({ type: "email", value: "hi@band.com" });

    const saved = await readItem("booking-info", "_singleton", def);
    expect(saved!.values.fld_email).toEqual({ type: "email", value: "hi@band.com" });
  });

  it("400s when a required field is missing on the singleton's first save", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const def = defOf({
      slug: "booking-info",
      isSingleton: true,
      fields: [{ id: "fld_email", key: "email", type: "email", required: true }],
    });
    await writeCollectionDef("booking-info", def);

    const res = await putReq("booking-info", "_singleton", { values: {} });
    expect(res.status).toBe(400);
    // Nothing got written.
    const saved = await readItem("booking-info", "_singleton", def);
    expect(saved).toBeNull();
  });

  it("still 404s a missing item in a multi-item collection (update-only guard)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await writeCollectionDef(
      "faq-entries",
      defOf({
        slug: "faq-entries",
        fields: [{ id: "fld_q", key: "question", type: "text", required: true }],
        slugSourceFieldId: "fld_q",
      }),
    );

    const res = await putReq("faq-entries", "does-not-exist", {
      values: { fld_q: { type: "text", value: "Hi?" } },
    });
    expect(res.status).toBe(404);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await putReq("booking-info", "_singleton", { values: {} });
    expect(res.status).toBe(401);
    expect(publishMock).not.toHaveBeenCalled();
  });
});

describe("platform configured (production) — issue #345", () => {
  // With STAGECRAFT_SITE_ID + STAGECRAFT_BROKER_SECRET set, saves must
  // commit in-memory content and never touch the server's disk. The
  // broker fetch is stubbed to fail so the read store falls back to
  // the FS snapshot (the seeded tmpdir) — the save path is what's
  // under test, via the mocked `saveToDraft`.
  const singletonDef = () =>
    defOf({
      slug: "booking-info",
      isSingleton: true,
      fields: [{ id: "fld_email", key: "email", type: "email", required: true }],
    });

  beforeEach(async () => {
    process.env.STAGECRAFT_SITE_ID = "site_test";
    process.env.STAGECRAFT_BROKER_SECRET = "secret";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await writeCollectionDef("booking-info", singletonDef());
  });

  afterEach(() => {
    delete process.env.STAGECRAFT_SITE_ID;
    delete process.env.STAGECRAFT_BROKER_SECRET;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("commits the validated item without writing it to local disk", async () => {
    publishMock.mockResolvedValue({ commitSha: "draft-sha", mode: "github" });

    const res = await putReq("booking-info", "_singleton", {
      values: { fld_email: { type: "email", value: "hi@band.com" } },
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ ok: true, mode: "github", commitSha: "draft-sha" });
    expect(out.item.values.fld_email).toEqual({ type: "email", value: "hi@band.com" });

    // The commit carries exactly the item the response reports.
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock.mock.calls[0]![0].targets).toEqual([
      {
        kind: "collection-item",
        collectionSlug: "booking-info",
        itemSlug: "_singleton",
        data: {
          id: out.item.id,
          createdAt: out.item.createdAt,
          updatedAt: out.item.updatedAt,
          values: out.item.values,
        },
      },
    ]);

    // Nothing landed on the server's disk.
    expect(await readItem("booking-info", "_singleton", singletonDef())).toBeNull();
  });

  it("still 400s invalid values before any commit", async () => {
    const res = await putReq("booking-info", "_singleton", { values: {} });
    expect(res.status).toBe(400);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns 502 (never ok: true) when the commit fails, still without a local write", async () => {
    const { PublishError } = await import("@/lib/publish");
    publishMock.mockRejectedValue(new PublishError("github-failed", "commit to draft: boom"));

    const res = await putReq("booking-info", "_singleton", {
      values: { fld_email: { type: "email", value: "hi@band.com" } },
    });
    expect(res.status).toBe(502);
    const out = await res.json();
    expect(out.ok).toBe(false);
    expect(out.code).toBe("github-failed");
    expect(out.error).toContain("boom");
    expect(out.publishWarning).toBeUndefined();
    expect(await readItem("booking-info", "_singleton", singletonDef())).toBeNull();
  });

  it("maps a concurrent-edit commit failure to 409", async () => {
    const { PublishError } = await import("@/lib/publish");
    publishMock.mockRejectedValue(
      new PublishError("concurrent-edit", "heads/draft: retries exhausted"),
    );

    const res = await putReq("booking-info", "_singleton", {
      values: { fld_email: { type: "email", value: "hi@band.com" } },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("concurrent-edit");
  });

  it("DELETE commits the deletion and leaves the snapshot file alone", async () => {
    const def = defOf({
      slug: "faq-entries",
      fields: [{ id: "fld_q", key: "question", type: "text", required: true }],
      slugSourceFieldId: "fld_q",
    });
    await writeCollectionDef("faq-entries", def);
    await writeItem("faq-entries", "first", faqItem("first"), def);
    publishMock.mockResolvedValue({ commitSha: "draft-sha", mode: "github" });

    const res = await DELETE(new Request("https://x"), {
      params: Promise.resolve({ slug: "faq-entries", itemSlug: "first" }),
    });
    expect(res.status).toBe(200);
    expect(publishMock.mock.calls[0]![0].targets).toEqual([
      { kind: "delete-collection-item", collectionSlug: "faq-entries", itemSlug: "first" },
    ]);
    expect(await readItem("faq-entries", "first", def)).not.toBeNull();
  });

  it("PATCH commits write + delete + order without touching disk", async () => {
    const def = defOf({
      slug: "faq-entries",
      fields: [{ id: "fld_q", key: "question", type: "text", required: true }],
      slugSourceFieldId: "fld_q",
      defaultSort: { mode: "manual" },
    });
    await writeCollectionDef("faq-entries", def);
    await writeItem("faq-entries", "first", faqItem("first"), def);
    await writeItem("faq-entries", "second", faqItem("second"), def);
    await writeOrder("faq-entries", ["second", "first"]);
    publishMock.mockResolvedValue({ commitSha: "draft-sha", mode: "github" });

    const res = await patchReq("faq-entries", "first", { newSlug: "renamed" });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.item.slug).toBe("renamed");
    expect(out.item.id).toBe("item_first");
    const targets = publishMock.mock.calls[0]![0].targets;
    expect(targets).toEqual([
      expect.objectContaining({ kind: "collection-item", itemSlug: "renamed" }),
      { kind: "delete-collection-item", collectionSlug: "faq-entries", itemSlug: "first" },
      { kind: "collection-order", collectionSlug: "faq-entries", data: ["second", "renamed"] },
    ]);
    // Snapshot untouched.
    expect(await readItem("faq-entries", "first", def)).not.toBeNull();
    expect(await readItem("faq-entries", "renamed", def)).toBeNull();
    expect(await readOrder("faq-entries")).toEqual(["second", "first"]);
  });
});

describe("platform not configured (dev)", () => {
  it("PUT writes the same bytes to disk that it reports and commits", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const def = defOf({
      slug: "booking-info",
      isSingleton: true,
      fields: [{ id: "fld_email", key: "email", type: "email", required: true }],
    });
    await writeCollectionDef("booking-info", def);

    const res = await putReq("booking-info", "_singleton", {
      values: { fld_email: { type: "email", value: "hi@band.com" } },
    });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(await readItem("booking-info", "_singleton", def)).toEqual(out.item);
    expect(publishMock.mock.calls[0]![0].targets[0].data.updatedAt).toBe(out.item.updatedAt);
  });

  it("PATCH renames on disk, keeps the id, and rewrites the manual order", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const def = defOf({
      slug: "faq-entries",
      fields: [{ id: "fld_q", key: "question", type: "text", required: true }],
      slugSourceFieldId: "fld_q",
      defaultSort: { mode: "manual" },
    });
    await writeCollectionDef("faq-entries", def);
    await writeItem("faq-entries", "first", faqItem("first"), def);
    await writeOrder("faq-entries", ["first"]);

    const res = await patchReq("faq-entries", "first", { newSlug: "renamed" });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(await readItem("faq-entries", "first", def)).toBeNull();
    expect(await readItem("faq-entries", "renamed", def)).toEqual(out.item);
    expect(await readOrder("faq-entries")).toEqual(["renamed"]);
  });

  it("PATCH 409s when the new slug is taken", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const def = defOf({
      slug: "faq-entries",
      fields: [{ id: "fld_q", key: "question", type: "text", required: true }],
      slugSourceFieldId: "fld_q",
    });
    await writeCollectionDef("faq-entries", def);
    await writeItem("faq-entries", "first", faqItem("first"), def);
    await writeItem("faq-entries", "second", faqItem("second"), def);

    const res = await patchReq("faq-entries", "first", { newSlug: "second" });
    expect(res.status).toBe(409);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("PATCH 404s a missing item", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    await writeCollectionDef(
      "faq-entries",
      defOf({
        slug: "faq-entries",
        fields: [{ id: "fld_q", key: "question", type: "text", required: true }],
        slugSourceFieldId: "fld_q",
      }),
    );
    const res = await patchReq("faq-entries", "nope", { newSlug: "renamed" });
    expect(res.status).toBe(404);
  });
});
