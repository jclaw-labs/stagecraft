/**
 * Tests for PUT /api/collections/<slug>/schema (ADR-009 PR 5).
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
  return { ...actual, publish: publishMock };
});

import { PUT } from "./route";
import { POST as POST_ITEM } from "../items/route";
import {
  PAGES_FIELD_IDS,
  PREBAKED_COLLECTIONS,
} from "@/lib/collections/seeds";
import { readCollectionDef, readItem, writeCollectionDef } from "@/lib/collections";
import { __resetBootstrapCacheForTests } from "@/lib/content";

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-schema-api-"));
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
  return new Request("https://x/api/collections/pages/schema", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

const VALID_VALUES = {
  [PAGES_FIELD_IDS.title]: { type: "text" as const, value: "Tour 2026" },
  [PAGES_FIELD_IDS.body]: {
    type: "puckContent" as const,
    value: { content: [], root: { props: {} } },
  },
};

describe("PUT /api/collections/[slug]/schema", () => {
  it("returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await PUT(jsonReq({}), ctx("pages"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid slug", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({}), ctx("BAD-Slug"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown collection", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({}), ctx("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("rejects a body that doesn't match the CollectionDef schema", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({ slug: "pages" }), ctx("pages"));
    expect(res.status).toBe(400);
  });

  it("rejects a body whose slug doesn't match the URL", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const pagesDef = await readCollectionDef("pages");
    const res = await PUT(
      jsonReq({ ...pagesDef, slug: "different" }),
      ctx("pages"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects toggling isSingleton", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const pagesDef = await readCollectionDef("pages");
    const res = await PUT(
      jsonReq({ ...pagesDef, isSingleton: true }),
      ctx("pages"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 with structured issues for a blocked change", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const pagesDef = await readCollectionDef("pages");
    if (!pagesDef) throw new Error("seed");
    // Try to delete the system-locked title field.
    const blocked = {
      ...pagesDef,
      fields: pagesDef.fields.filter((f) => f.id !== PAGES_FIELD_IDS.title),
      slugSourceFieldId: null,
    };
    const res = await PUT(jsonReq(blocked), ctx("pages"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues[0]).toMatchObject({ kind: "system-locked-deleted" });
    expect(typeof body.issues[0].message).toBe("string");
  });

  it("returns 409 with structured issues when optional → required fails", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // Add an optional text field to pages, create an item without
    // a value for it, then try to flip it to required.
    const pagesDef = await readCollectionDef("pages");
    if (!pagesDef) throw new Error("seed");
    const withOptional = {
      ...pagesDef,
      fields: [
        ...pagesDef.fields,
        { id: "f_subtitle", key: "subtitle", type: "text" as const, required: false },
      ],
    };
    await writeCollectionDef("pages", withOptional);

    // Create an item that doesn't fill in the new field.
    await POST_ITEM(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ slug: "tour-2026", values: VALID_VALUES }),
      }),
      ctx("pages"),
    );

    const flippedRequired = {
      ...withOptional,
      fields: withOptional.fields.map((f) =>
        f.id === "f_subtitle" && f.type === "text" ? { ...f, required: true } : f,
      ),
    };
    const res = await PUT(jsonReq(flippedRequired), ctx("pages"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.issues[0]).toMatchObject({
      kind: "required-flag-blocked",
      missingItemCount: 1,
    });
  });

  it("accepts an unchanged def (no-op)", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const pagesDef = await readCollectionDef("pages");
    const res = await PUT(jsonReq(pagesDef), ctx("pages"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.warnings).toEqual([]);
  });

  it("accepts adding a new optional field and publishes a collection-def target", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    publishMock.mockResolvedValue({ commitSha: "abc", mode: "github" });
    const pagesDef = await readCollectionDef("pages");
    if (!pagesDef) throw new Error("seed");
    const newDef = {
      ...pagesDef,
      fields: [
        ...pagesDef.fields,
        { id: "f_subtitle", key: "subtitle", type: "text" as const, required: false },
      ],
    };
    const res = await PUT(jsonReq(newDef), ctx("pages"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.def.fields.some((f: { id: string }) => f.id === "f_subtitle")).toBe(true);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({
            kind: "collection-def",
            collectionSlug: "pages",
          }),
        ],
      }),
    );
    // The on-disk def reflects the change.
    const saved = await readCollectionDef("pages");
    expect(saved?.fields.some((f) => f.id === "f_subtitle")).toBe(true);
  });

  it("returns warnings when a field with data is removed but is not systemLocked", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // Set up: add an optional non-locked field, create an item with a
    // value for it, then remove the field. validateSchemaChange should
    // warn (not block).
    const pagesDef = await readCollectionDef("pages");
    if (!pagesDef) throw new Error("seed");
    const withExtra = {
      ...pagesDef,
      fields: [
        ...pagesDef.fields,
        { id: "f_subtitle", key: "subtitle", type: "text" as const, required: false },
      ],
    };
    await writeCollectionDef("pages", withExtra);
    await POST_ITEM(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({
          slug: "tour-2026",
          values: {
            ...VALID_VALUES,
            f_subtitle: { type: "text", value: "with subtitle" },
          },
        }),
      }),
      ctx("pages"),
    );

    const trimmed = {
      ...withExtra,
      fields: withExtra.fields.filter((f) => f.id !== "f_subtitle"),
    };
    const res = await PUT(jsonReq(trimmed), ctx("pages"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.warnings.length).toBe(1);
    expect(body.warnings[0]).toMatchObject({
      kind: "field-removed-with-data",
      fieldId: "f_subtitle",
      affectedItemCount: 1,
    });
  });

  it("migrates item values on lossless type transition; readItem succeeds afterward", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    publishMock.mockResolvedValue({ commitSha: "abc", mode: "github" });

    // Add an optional text field, create an item with a value, flip
    // the field's type to longText. The on-disk value's `type`
    // discriminator must end up as "longText" so the next readItem
    // parses against the new schema.
    const pagesDef = await readCollectionDef("pages");
    if (!pagesDef) throw new Error("seed");
    const withText = {
      ...pagesDef,
      fields: [
        ...pagesDef.fields,
        { id: "f_subtitle", key: "subtitle", type: "text" as const, required: false },
      ],
    };
    await writeCollectionDef("pages", withText);
    await POST_ITEM(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({
          slug: "tour-2026",
          values: {
            ...VALID_VALUES,
            f_subtitle: { type: "text", value: "Hello world" },
          },
        }),
      }),
      ctx("pages"),
    );

    const flipped = {
      ...withText,
      fields: withText.fields.map((f) =>
        f.id === "f_subtitle" && f.type === "text"
          ? { ...f, type: "longText" as const }
          : f,
      ),
    };
    publishMock.mockClear();
    const res = await PUT(jsonReq(flipped), ctx("pages"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.migratedItemCount).toBe(1);
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: expect.arrayContaining([
          expect.objectContaining({ kind: "collection-def" }),
          expect.objectContaining({
            kind: "collection-item",
            collectionSlug: "pages",
            itemSlug: "tour-2026",
          }),
        ]),
      }),
    );

    // The bug this guards against: without migration, readItem against
    // the new def would throw because the on-disk value's `type` no
    // longer matches the field's `type`.
    const updatedDef = await readCollectionDef("pages");
    if (!updatedDef) throw new Error("def gone");
    const reread = await readItem("pages", "tour-2026", updatedDef);
    expect(reread).not.toBeNull();
    expect(reread!.values.f_subtitle).toEqual({ type: "longText", value: "Hello world" });
  });

  it("blocks removing a select option that an item references", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const pagesDef = await readCollectionDef("pages");
    if (!pagesDef) throw new Error("seed");
    // Add a select field with two options, create an item referencing one.
    const withSelect = {
      ...pagesDef,
      fields: [
        ...pagesDef.fields,
        {
          id: "f_status",
          key: "status",
          type: "select" as const,
          required: false,
          options: [
            { id: "o1", value: "draft", label: "Draft" },
            { id: "o2", value: "live", label: "Live" },
          ],
        },
      ],
    };
    await writeCollectionDef("pages", withSelect);
    await POST_ITEM(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({
          slug: "tour-2026",
          values: { ...VALID_VALUES, f_status: { type: "select", value: "draft" } },
        }),
      }),
      ctx("pages"),
    );

    // Remove the "draft" option that the item references.
    const trimmed = {
      ...withSelect,
      fields: withSelect.fields.map((f) =>
        f.id === "f_status" && f.type === "select"
          ? { ...f, options: f.options.filter((o) => o.value !== "draft") }
          : f,
      ),
    };
    const res = await PUT(jsonReq(trimmed), ctx("pages"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.issues).toContainEqual(
      expect.objectContaining({
        kind: "item-invalid-under-new-schema",
        itemSlug: "tour-2026",
      }),
    );
  });

  it("blocks adding a brand-new required field while items exist", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // Pages already has one item by virtue of POST_ITEM in another
    // test? No — beforeEach wipes the collections dir. Create one
    // first.
    await POST_ITEM(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ slug: "tour-2026", values: VALID_VALUES }),
      }),
      ctx("pages"),
    );

    const pagesDef = await readCollectionDef("pages");
    if (!pagesDef) throw new Error("seed");
    const withRequired = {
      ...pagesDef,
      fields: [
        ...pagesDef.fields,
        { id: "f_ticket", key: "ticketUrl", type: "url" as const, required: true },
      ],
    };
    const res = await PUT(jsonReq(withRequired), ctx("pages"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.issues).toContainEqual(
      expect.objectContaining({
        kind: "item-invalid-under-new-schema",
        itemSlug: "tour-2026",
      }),
    );
  });
});
