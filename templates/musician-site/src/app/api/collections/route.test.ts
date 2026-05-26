/**
 * Tests for POST /api/collections — create a new collection.
 *
 * Mirrors the mocking style of `[slug]/schema/route.test.ts`:
 *   - `getSession` is mocked so we can drive auth.
 *   - `saveToDraft` is mocked (default resolves "local") so the publish
 *     path doesn't reach the broker, and a single test can make it
 *     throw `PublishError`.
 *   - `STAGECRAFT_CONTENT_DIR` points at a tmpdir so the local write
 *     lands in an isolated tree.
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

import { POST } from "./route";
import { PublishError } from "@/lib/publish";
import { PREBAKED_COLLECTIONS } from "@/lib/collections/seeds";
import { readCollectionDef, readItem, writeCollectionDef } from "@/lib/collections";

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
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
  // Seed the prebaked collections so the collision / reserved-name
  // guard has something to find (matches the schema route test setup).
  for (const [slug, def] of Object.entries(PREBAKED_COLLECTIONS)) {
    await writeCollectionDef(slug, def);
  }
});

function jsonReq(body: unknown) {
  return new Request("https://x/api/collections", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/collections", () => {
  it("creates the def, returns the slug, and uses the Title field as slug source", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    publishMock.mockResolvedValue({ commitSha: "abc", mode: "github" });

    const res = await POST(
      jsonReq({ pluralName: "FAQ Entries", singularName: "FAQ entry" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.slug).toBe("faq-entries");
    expect(body.mode).toBe("github");
    expect(body.commitSha).toBe("abc");

    // The returned def has exactly one default Title field, and it's
    // the slug source.
    expect(body.def.fields).toHaveLength(1);
    const titleField = body.def.fields[0];
    expect(titleField).toMatchObject({ key: "title", type: "text", required: true });
    expect(titleField.systemLocked).toBeUndefined();
    expect(body.def.slugSourceFieldId).toBe(titleField.id);
    expect(body.def.isSingleton).toBe(false);
    expect(body.def.singularName).toBe("FAQ entry");
    expect(body.def.pluralName).toBe("FAQ Entries");

    // It published a single collection-def target with a "Create …"
    // commit subject.
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({ kind: "collection-def", collectionSlug: "faq-entries" }),
        ],
        authorEmail: "a@b.c",
        commitSubject: "Create FAQ Entries collection",
      }),
    );

    // The def is written to disk and round-trips through the store.
    const saved = await readCollectionDef("faq-entries");
    expect(saved).not.toBeNull();
    expect(saved!.fields).toHaveLength(1);
    expect(saved!.slugSourceFieldId).toBe(titleField.id);
  });

  it("creates a singleton with no fields, a null slug source, and no eagerly-written item", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });

    const res = await POST(
      jsonReq({ pluralName: "Booking Info", singularName: "booking info", isSingleton: true }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.slug).toBe("booking-info");
    expect(body.def.isSingleton).toBe(true);
    // Singletons match the prebaked-singleton convention: no slug source.
    expect(body.def.slugSourceFieldId).toBeNull();
    // A fresh singleton starts with no fields — the artist defines them
    // in the schema editor next. Starting empty also keeps a later "add a
    // required field" save from being blocked: there's no seeded item to
    // violate the new requirement.
    expect(body.def.fields).toHaveLength(0);

    const saved = await readCollectionDef("booking-info");
    expect(saved!.isSingleton).toBe(true);
    expect(saved!.slugSourceFieldId).toBeNull();
    expect(saved!.fields).toHaveLength(0);

    // The `_singleton.json` item is materialized lazily on first save, not
    // at creation — so it doesn't exist yet.
    const item = await readItem("booking-info", "_singleton", saved!);
    expect(item).toBeNull();

    // Only the collection-def is published — no collection-item target.
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({ kind: "collection-def", collectionSlug: "booking-info" }),
        ],
      }),
    );
    expect(publishMock.mock.calls[0][0].targets).toHaveLength(1);
  });

  it("returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await POST(jsonReq({ pluralName: "Things", singularName: "thing" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: "unauthorized" });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the body isn't JSON", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(
      new Request("https://x/api/collections", { method: "POST", body: "not json{" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on a blank plural name", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(jsonReq({ pluralName: "   ", singularName: "thing" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a blank singular name", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(jsonReq({ pluralName: "Things", singularName: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the plural name has no slug-able characters", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(jsonReq({ pluralName: "!!!", singularName: "thing" }));
    expect(res.status).toBe(400);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns 400 when a name exceeds 80 characters", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(jsonReq({ pluralName: "x".repeat(81), singularName: "thing" }));
    expect(res.status).toBe(400);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns 400 when a name contains a line break (commit-injection guard)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(
      jsonReq({ pluralName: "Press\nQuotes", singularName: "press quote" }),
    );
    expect(res.status).toBe(400);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns 409 when a non-prebaked collection with that slug already exists", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // First create lands "faq-entries" on disk; the second collides. The
    // FS read store re-reads the collections dir on every call, so the
    // second request sees the just-written def.
    const first = await POST(jsonReq({ pluralName: "FAQ Entries", singularName: "FAQ entry" }));
    expect(first.status).toBe(200);
    const dup = await POST(jsonReq({ pluralName: "FAQ Entries", singularName: "FAQ entry" }));
    expect(dup.status).toBe(409);
    const body = await dup.json();
    expect(body).toMatchObject({
      ok: false,
      error: "A collection with that name already exists",
    });
    // Only the first create published; the collision short-circuits.
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("returns 409 'reserved' for a prebaked slug (pages)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await POST(jsonReq({ pluralName: "Pages", singularName: "page" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: "That name is reserved" });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("rejects a reserved prebaked slug even when nothing is seeded on disk", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // Wipe the seeded collections so only the *static* PREBAKED_COLLECTIONS
    // guard can catch this — proving the reserved check doesn't depend on
    // the on-disk / draft listing being complete.
    await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
    const res = await POST(jsonReq({ pluralName: "Tour Dates", singularName: "tour date" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("That name is reserved");
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("returns { ok: true, publishWarning } when the publish fails", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    publishMock.mockRejectedValue(
      new PublishError("broker-unreachable", "broker down"),
    );

    const res = await POST(jsonReq({ pluralName: "Press Quotes", singularName: "press quote" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.slug).toBe("press-quotes");
    expect(body.mode).toBe("local");
    expect(body.commitSha).toBeNull();
    expect(body.publishWarning).toBe("broker down");

    // Local-write-first: the def is on disk even though the publish
    // failed, so the next save can retry.
    const saved = await readCollectionDef("press-quotes");
    expect(saved).not.toBeNull();
    expect(saved!.pluralName).toBe("Press Quotes");
  });

  it("re-throws a non-PublishError from saveToDraft", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    publishMock.mockRejectedValue(new Error("unexpected"));
    await expect(
      POST(jsonReq({ pluralName: "Whatever", singularName: "whatever" })),
    ).rejects.toThrow("unexpected");
  });
});
