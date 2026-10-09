/**
 * POST /api/welcome/complete — atomic first-run wizard completion.
 * Writes the site / appearance / header singletons + a starter Home
 * page (+ illustrative tour dates when that collection exists and is
 * empty), all published in one commit.
 *
 * Drives the real collection store against an isolated tmp content
 * dir (so writes actually land) and mocks only `getSession` + the
 * `saveAndPublish` round-trip — mirroring the sibling collections-items
 * route tests.
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
  return { ...actual, saveAndPublish: publishMock };
});

import { POST } from "./route";
import { getRequestReadStore, readSingleton, writeCollectionDef } from "@/lib/collections";
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
    const res = await POST(jsonReq({ ...VALID_BODY, theme: "riot" }));
    expect(res.status).toBe(200);

    const store = await getRequestReadStore();
    const appearance = appearanceFromItem(
      await store.readSingleton("appearance", appearanceCollectionDef),
    );
    const header = headerConfigFromItem(
      await store.readSingleton("header", headerCollectionDef),
    );

    // The Riot palette + design landed — not the back-compat accent swap.
    expect(appearance.colors.background).toBe("#0a0a0a");
    expect(appearance.colors.accent).not.toBe(VALID_BODY.primaryColor);
    expect(appearance.typography.bodyFont).toBe("Space Mono");
    expect(appearance.design?.radius).toBe("sharp");
    // ...and its header style.
    expect(header.isHeaderTextUppercase).toBe(true);
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

describe("POST /api/welcome/complete — seedContent", () => {
  it("seeds Home + starter pages (Home-first nav order) + tour dates by default", async () => {
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(200);
    const store = await getRequestReadStore();
    expect([...(await store.listItemSlugs("pages"))].sort()).toEqual([
      "about",
      "contact",
      "home",
      "music",
      "updates",
    ]);
    // Home stays first in the nav via the pages collection's _order.json.
    expect(await store.readOrder("pages")).toEqual(["home", "music", "updates", "about", "contact"]);
    expect((await store.listItemSlugs("tour-dates")).length).toBeGreaterThan(0);
  });

  it("with seedContent:false lands a blank Home page and no tour dates", async () => {
    const res = await POST(jsonReq({ ...VALID_BODY, seedContent: false }));
    expect(res.status).toBe(200);
    const store = await getRequestReadStore();
    // One page (the Home shell) still lands so the public site renders...
    expect(await store.listItemSlugs("pages")).toEqual(["home"]);
    // ...but the demo tour dates are skipped.
    expect((await store.listItemSlugs("tour-dates")).length).toBe(0);
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

describe("POST /api/welcome/complete — dev write ordering", () => {
  it("writes the site singleton last, so a failed earlier write leaves the wizard re-runnable", async () => {
    // A directory where the Home page file goes makes that write's
    // rename fail, partway through the dev write.
    await fs.mkdir(path.join(TMP_CONTENT_DIR, "collections/pages/items/home.json/blocker"), {
      recursive: true,
    });

    await expect(POST(jsonReq(VALID_BODY))).rejects.toThrow();

    expect(publishMock).not.toHaveBeenCalled();
    const site = siteConfigFromItem(await readSingleton("site", siteCollectionDef));
    expect(site.hasCompletedFirstRun).toBe(false);
  });
});

describe("POST /api/welcome/complete — platform configured (issue #345)", () => {
  beforeEach(() => {
    process.env.STAGECRAFT_SITE_ID = "site_test";
    process.env.STAGECRAFT_BROKER_SECRET = "secret";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.STAGECRAFT_SITE_ID;
    delete process.env.STAGECRAFT_BROKER_SECRET;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns 502 (never ok: true) when the draft commit fails", async () => {
    const { PublishError } = await import("@/lib/publish");
    publishMock.mockRejectedValue(new PublishError("github-failed", "commit to draft: boom"));

    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "github-failed" });
    expect(body.error).toMatch(/^Save failed: /);
  });

  it("draft saved but publish to main failed: ok with publishWarning, not 'Save failed'", async () => {
    const { DraftSavedPublishError, PublishError } = await import("@/lib/publish");
    publishMock.mockRejectedValue(
      new DraftSavedPublishError(
        "draft-sha",
        new PublishError("github-failed", "squash draft → main: boom"),
      ),
    );

    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      published: false,
      mode: "github",
      commitSha: "draft-sha",
    });
    expect(body.publishWarning).toMatch(/^Saved to your draft, but publishing to the live site failed/);
    expect(JSON.stringify(body)).not.toMatch(/Save failed/);
  });

  it("a successful publish carries no publishWarning", async () => {
    publishMock.mockResolvedValue({ commitSha: "main-sha", mode: "github" });
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, mode: "github", commitSha: "main-sha" });
  });
});
