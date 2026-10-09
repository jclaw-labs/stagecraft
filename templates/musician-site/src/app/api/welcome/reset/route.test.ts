/**
 * POST /api/welcome/reset — destructive reset back to first-run
 * state: deletes every page + collection item, resets the three
 * singletons to defaults (clearing `hasCompletedFirstRun`). Guarded
 * by an artist-name confirmation (case/whitespace-insensitive) so a
 * mis-fired POST can't wipe a site by accident.
 *
 * Drives the real store against a tmp content dir; mocks `getSession`
 * + the `saveAndPublish` round-trip.
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
import {
  getRequestReadStore,
  readSingleton,
  SINGLETON_ITEM_SLUG,
  writeCollectionDef,
  writeItem,
  writeSingleton,
} from "@/lib/collections";
import { PREBAKED_COLLECTIONS, siteCollectionDef } from "@/lib/collections/seeds";
import {
  siteConfigFromItem,
  siteConfigToItemValues,
} from "@/lib/collections/migrate-from-legacy-values";
import { pageDataToItem } from "@/lib/collections/migrate-from-legacy";
import { generateItemId } from "@/lib/collections";
import { DEFAULT_SITE_CONFIG } from "@/lib/site-config-types";
import { upsertSingletonItem } from "../_shared";
import { __resetBootstrapCacheForTests } from "@/lib/content";

let TMP_CONTENT_DIR: string;
const ARTIST = "Sarah Chen";

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-welcome-reset-"));
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
  // Seed a completed site with a known artist name + a page item to
  // delete, so the reset has something to confirm against + clear.
  const site = upsertSingletonItem(
    null,
    siteConfigToItemValues({
      ...DEFAULT_SITE_CONFIG,
      artistName: ARTIST,
      hasCompletedFirstRun: true,
    }),
  );
  await writeSingleton("site", site, siteCollectionDef);
});

function jsonReq(body: unknown) {
  return new Request("https://x/api/welcome/reset", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/welcome/reset — guards", () => {
  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(jsonReq({ confirmArtistName: ARTIST }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when the body isn't JSON", async () => {
    const res = await POST(jsonReq("nope {"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when confirmArtistName is missing", async () => {
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the confirmation doesn't match the artist name", async () => {
    const res = await POST(jsonReq({ confirmArtistName: "Someone Else" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/didn't match/i);
  });
});

describe("POST /api/welcome/reset — happy path", () => {
  it("accepts a case/whitespace-insensitive confirmation and clears the flag", async () => {
    publishMock.mockResolvedValue({ commitSha: "reset1", mode: "github" });
    const res = await POST(jsonReq({ confirmArtistName: `  ${ARTIST.toLowerCase()}  ` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.commitSha).toBe("reset1");

    // Site singleton reset → hasCompletedFirstRun flipped back to false.
    const store = await getRequestReadStore();
    const site = siteConfigFromItem(await store.readSingleton("site", siteCollectionDef));
    expect(site.hasCompletedFirstRun).toBe(false);

    // Publish carried the "reset" commit subject.
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock.mock.calls[0]![0].commitSubject).toMatch(/reset/i);
  });

  it("deletes the artist's page items and reports the count", async () => {
    // Add a page item to be cleared.
    const home = pageDataToItem(
      "home",
      { root: { props: { title: "Home" } }, content: [], zones: {} },
      { id: generateItemId(), showInNav: true },
    );
    await writeItem("pages", "home", home, PREBAKED_COLLECTIONS.pages!);
    const before = await (await getRequestReadStore()).listItemSlugs("pages");
    expect(before).toContain("home");

    const res = await POST(jsonReq({ confirmArtistName: ARTIST }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Deterministic: beforeEach seeds only the site singleton (no
    // items), this test adds exactly one page item — so a count other
    // than 1 means the handler over-counted (e.g. stopped skipping
    // singletons or double-counted a target).
    expect(body.itemsDeleted).toBe(1);

    // The page file is gone + a delete target was published.
    const after = await (await getRequestReadStore()).listItemSlugs("pages");
    expect(after).not.toContain("home");
    const targets = publishMock.mock.calls[0]![0].targets;
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "delete-collection-item", collectionSlug: "pages", itemSlug: "home" }),
      ]),
    );
    // Singletons are NOT deleted — only reset.
    void SINGLETON_ITEM_SLUG;
  });
});

describe("POST /api/welcome/reset — platform configured (issue #345)", () => {
  // Production: the reset is committed in memory; the server's disk
  // (read-only / ephemeral on serverless hosts) is never written. The
  // broker fetch fails so reads fall back to the seeded FS snapshot.
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

  it("commits the reset singletons without writing them to local disk", async () => {
    publishMock.mockResolvedValue({ commitSha: "reset-sha", mode: "github" });
    const before = await readSingleton("site", siteCollectionDef);

    const res = await POST(jsonReq({ confirmArtistName: ARTIST }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, mode: "github", commitSha: "reset-sha" });

    const targets = publishMock.mock.calls[0]![0].targets;
    const siteTarget = targets.find(
      (t: { kind: string; collectionSlug?: string }) =>
        t.kind === "collection-item" && t.collectionSlug === "site",
    );
    expect(siteConfigFromItem({ ...siteTarget.data, slug: SINGLETON_ITEM_SLUG }).hasCompletedFirstRun)
      .toBe(false);
    // Identity preserved across the reset.
    expect(siteTarget.data.id).toBe(before!.id);

    // The on-disk snapshot still says the wizard was completed.
    const after = await readSingleton("site", siteCollectionDef);
    expect(siteConfigFromItem(after).hasCompletedFirstRun).toBe(true);
    expect(after).toEqual(before);
  });

  it("returns 502 (never ok: true) when the commit fails", async () => {
    const { PublishError } = await import("@/lib/publish");
    publishMock.mockRejectedValue(new PublishError("broker-rejected", "Token broker returned 401"));

    const res = await POST(jsonReq({ confirmArtistName: ARTIST }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "broker-rejected" });
    expect(body.error).toContain("401");
    expect(body.publishWarning).toBeUndefined();

    const after = await readSingleton("site", siteCollectionDef);
    expect(siteConfigFromItem(after).hasCompletedFirstRun).toBe(true);
  });

  it("draft reset landed but publish to main failed: ok with publishWarning, not 'Save failed'", async () => {
    const { DraftSavedPublishError, PublishError } = await import("@/lib/publish");
    publishMock.mockRejectedValue(
      new DraftSavedPublishError(
        "draft-sha",
        new PublishError("github-failed", "squash draft → main: boom"),
      ),
    );

    const res = await POST(jsonReq({ confirmArtistName: ARTIST }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      published: false,
      mode: "github",
      commitSha: "draft-sha",
      itemsDeleted: 0,
    });
    expect(body.publishWarning).toMatch(/^Saved to your draft, but publishing to the live site failed/);
    expect(JSON.stringify(body)).not.toMatch(/Save failed/);
  });
});

describe("POST /api/welcome/reset — production build, platform not configured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 503 and leaves local disk untouched", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const before = await readSingleton("site", siteCollectionDef);

    const res = await POST(jsonReq({ confirmArtistName: ARTIST }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "no-platform-configured" });
    expect(body.error).toMatch(/isn't connected to Stagecraft/);
    expect(publishMock).not.toHaveBeenCalled();
    expect(await readSingleton("site", siteCollectionDef)).toEqual(before);
  });
});

describe("POST /api/welcome/reset — platform not configured (dev)", () => {
  it("writes the reset to local disk", async () => {
    const res = await POST(jsonReq({ confirmArtistName: ARTIST }));
    expect(res.status).toBe(200);
    const after = await readSingleton("site", siteCollectionDef);
    expect(siteConfigFromItem(after).hasCompletedFirstRun).toBe(false);
  });
});
