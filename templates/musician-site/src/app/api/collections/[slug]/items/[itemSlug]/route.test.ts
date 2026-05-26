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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));
vi.mock("@/lib/publish", async () => {
  const actual = await vi.importActual<typeof import("@/lib/publish")>("@/lib/publish");
  return { ...actual, saveToDraft: publishMock };
});

import { PUT } from "./route";
import {
  collectionDefSchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  readItem,
  writeCollectionDef,
  type CollectionDef,
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
