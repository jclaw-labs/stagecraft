/**
 * Tests for PUT /api/collections/<slug>/template/<kind> (ADR-009
 * PR 6 follow-up).
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
import { PREBAKED_COLLECTIONS } from "@/lib/collections/seeds";
import { readCollectionDef, writeCollectionDef } from "@/lib/collections";
import { __resetBootstrapCacheForTests } from "@/lib/content";

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-template-api-"));
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

function ctx(slug: string, kind: string) {
  return { params: Promise.resolve({ slug, kind }) };
}

function jsonReq(body: unknown) {
  return new Request("https://x/api/collections/pages/template/item", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("PUT /api/collections/[slug]/template/[kind]", () => {
  it("returns 401 without session", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await PUT(jsonReq({ data: null }), ctx("pages", "item"));
    expect(res.status).toBe(401);
  });

  it("returns 400 for an unknown kind", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({ data: null }), ctx("pages", "weird"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown collection", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({ data: null }), ctx("does-not-exist", "item"));
    expect(res.status).toBe(404);
  });

  it("writes only the chosen template slot, leaving the other slots intact", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    // Pre-populate detailTemplate so we can verify it survives.
    const existing = await readCollectionDef("pages");
    if (!existing) throw new Error("seed");
    const seeded = {
      ...existing,
      detailTemplate: { content: [], root: { props: {} } } as unknown as typeof existing.detailTemplate,
    };
    await writeCollectionDef("pages", seeded);

    const payload = {
      data: {
        content: [
          { type: "Text", props: { content: { kind: "literal", value: "Hello" } } },
        ],
        root: { props: {} },
      },
    };
    const res = await PUT(jsonReq(payload), ctx("pages", "item"));
    expect(res.status).toBe(200);
    const saved = await readCollectionDef("pages");
    expect(saved?.itemTemplate).toMatchObject({ content: [{ type: "Text" }] });
    expect(saved?.detailTemplate).toMatchObject({ content: [], root: { props: {} } });
  });

  it("blocks a template that binds to a missing field", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const payload = {
      data: {
        content: [
          {
            type: "Text",
            props: { content: { kind: "binding", fieldId: "f_does_not_exist" } },
          },
        ],
        root: { props: {} },
      },
    };
    const res = await PUT(jsonReq(payload), ctx("pages", "item"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.issues).toContainEqual(
      expect.objectContaining({ kind: "template-references-missing-field" }),
    );
  });

  it("does NOT roll back a concurrent schema change made between mount and save", async () => {
    // Simulate: editor mounted with the original def. In another tab,
    // a new field is added. The template editor (using this route)
    // only writes the template slot — the new field is preserved.
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const original = await readCollectionDef("pages");
    if (!original) throw new Error("seed");

    // Simulate the concurrent schema change.
    const concurrent = {
      ...original,
      fields: [
        ...original.fields,
        { id: "f_new", key: "newField", type: "text" as const, required: false },
      ],
    };
    await writeCollectionDef("pages", concurrent);

    // Now the template editor saves. The route reads the current def,
    // applies just the template slot, writes back. The new field
    // survives.
    const payload = { data: { content: [], root: { props: {} } } };
    const res = await PUT(jsonReq(payload), ctx("pages", "item"));
    expect(res.status).toBe(200);
    const after = await readCollectionDef("pages");
    expect(after?.fields.some((f) => f.id === "f_new")).toBe(true);
  });

  it("accepts null to clear the template", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.c" });
    const res = await PUT(jsonReq({ data: null }), ctx("pages", "item"));
    expect(res.status).toBe(200);
    const saved = await readCollectionDef("pages");
    expect(saved?.itemTemplate).toBeNull();
  });
});
