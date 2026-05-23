/**
 * POST /api/welcome/complete — atomic first-run wizard completion.
 * Writes the site / appearance / header singletons + a starter Home
 * page (+ illustrative tour dates when that collection exists and is
 * empty), all published in one commit.
 *
 * Drives the real collection store against an isolated tmp content
 * dir (so writes actually land) and mocks only `getSession` + the
 * `publish` round-trip — mirroring the sibling collections-items
 * route tests.
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

import { POST } from "./route";
import { getRequestReadStore, writeCollectionDef } from "@/lib/collections";
import {
  appearanceCollectionDef,
  headerCollectionDef,
  PREBAKED_COLLECTIONS,
  siteCollectionDef,
} from "@/lib/collections/seeds";
import {
  appearanceFromItem,
  headerConfigFromItem,
  siteConfigFromItem,
} from "@/lib/collections/migrate-from-legacy-values";
import { __resetBootstrapCacheForTests } from "@/lib/content";

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-welcome-complete-"));
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  getSessionMock.mockReset().mockResolvedValue({ email: "artist@example.com" });
  publishMock.mockReset().mockResolvedValue({ commitSha: null, mode: "local" });
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  __resetBootstrapCacheForTests();
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
  for (const [slug, def] of Object.entries(PREBAKED_COLLECTIONS)) {
    await writeCollectionDef(slug, def);
  }
});

function jsonReq(body: unknown) {
  return new Request("https://x/api/welcome/complete", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  artistName: "Sarah Chen",
  primaryColor: "#aa00ff",
  firstPageTitle: "Home",
};

describe("POST /api/welcome/complete — guards", () => {
  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the body isn't JSON", async () => {
    const res = await POST(jsonReq("not json {"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await POST(jsonReq({ primaryColor: "#fff" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

describe("POST /api/welcome/complete — happy path", () => {
  it("writes the singletons + Home page and publishes one commit", async () => {
    publishMock.mockResolvedValue({ commitSha: "abc123", mode: "github" });
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.commitSha).toBe("abc123");

    // One publish call, subject = the wizard commit, including the
    // site + appearance + header singletons + the Home page.
    expect(publishMock).toHaveBeenCalledTimes(1);
    const call = publishMock.mock.calls[0]![0];
    expect(call.commitSubject).toBe("Complete welcome wizard");
    const kinds = call.targets.map((t: { collectionSlug: string }) => t.collectionSlug);
    expect(kinds).toEqual(expect.arrayContaining(["site", "appearance", "header", "pages"]));

    // Site singleton was actually written with the wizard values + flag.
    const store = await getRequestReadStore();
    const site = siteConfigFromItem(await store.readSingleton("site", siteCollectionDef));
    expect(site.artistName).toBe("Sarah Chen");
    expect(site.hasCompletedFirstRun).toBe(true);

    // The starter page landed in the pages collection.
    const pages = await store.listItemSlugs("pages");
    expect(pages.length).toBeGreaterThan(0);
  });
});

describe("POST /api/welcome/complete — theme", () => {
  it("applies the chosen theme's palette + header style", async () => {
    const res = await POST(jsonReq({ ...VALID_BODY, theme: "midnight" }));
    expect(res.status).toBe(200);

    const store = await getRequestReadStore();
    const appearance = appearanceFromItem(
      await store.readSingleton("appearance", appearanceCollectionDef),
    );
    const header = headerConfigFromItem(
      await store.readSingleton("header", headerCollectionDef),
    );

    // The Midnight palette landed — not the back-compat accent swap.
    expect(appearance.colors.background).toBe("#0b0b12");
    expect(appearance.colors.accent).not.toBe(VALID_BODY.primaryColor);
    expect(appearance.typography.bodyFont).toBe("Space Grotesk");
    // ...and its header style.
    expect(header.headerLayout).toBe("logo-center-nav-below");
  });

  it("falls back to the accent-swap path when no theme is given", async () => {
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(200);

    const store = await getRequestReadStore();
    const appearance = appearanceFromItem(
      await store.readSingleton("appearance", appearanceCollectionDef),
    );
    expect(appearance.colors.accent).toBe(VALID_BODY.primaryColor);
  });
});

describe("POST /api/welcome/complete — idempotency", () => {
  it("returns 409 when the site has already completed the wizard", async () => {
    // First completion sets hasCompletedFirstRun:true on disk.
    const first = await POST(jsonReq(VALID_BODY));
    expect(first.status).toBe(200);
    // A second POST is rejected — the only way back is the reset route.
    const second = await POST(jsonReq(VALID_BODY));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toMatch(/already completed/i);
  });
});
