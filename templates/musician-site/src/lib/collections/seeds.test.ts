/**
 * Each prebaked CollectionDef must satisfy the full
 * `collectionDefSchema` — duplicate field ids, slug-source mismatches,
 * and the like would fail at the schema-editor level later. Catch
 * them now so the seeds are valid the moment they ship.
 */

import { describe, expect, it } from "vitest";

import { collectionDefSchema } from "./schema";
import {
  appearanceCollectionDef,
  headerCollectionDef,
  pagesCollectionDef,
  photosCollectionDef,
  postsCollectionDef,
  PREBAKED_COLLECTIONS,
  releasesCollectionDef,
  siteCollectionDef,
  storeItemsCollectionDef,
  tourDatesCollectionDef,
  TOUR_DATES_FIELD_IDS,
  videosCollectionDef,
  VIDEOS_FIELD_IDS,
} from "./seeds";

describe("prebaked CollectionDefs", () => {
  it.each([
    ["pages", pagesCollectionDef],
    ["site", siteCollectionDef],
    ["header", headerCollectionDef],
    ["appearance", appearanceCollectionDef],
    ["tour-dates", tourDatesCollectionDef],
    ["releases", releasesCollectionDef],
    ["posts", postsCollectionDef],
    ["store-items", storeItemsCollectionDef],
    ["photos", photosCollectionDef],
    ["videos", videosCollectionDef],
  ])("%s parses against collectionDefSchema", (_slug, def) => {
    expect(() => collectionDefSchema.parse(def)).not.toThrow();
  });

  it("the registry exposes all ten", () => {
    expect(Object.keys(PREBAKED_COLLECTIONS).sort()).toEqual(
      [
        "appearance",
        "header",
        "pages",
        "photos",
        "posts",
        "releases",
        "site",
        "store-items",
        "tour-dates",
        "videos",
      ].sort(),
    );
  });

  it("pages collection marks title and body as systemLocked", () => {
    const fields = pagesCollectionDef.fields;
    const title = fields.find((f) => f.key === "title");
    const body = fields.find((f) => f.key === "body");
    expect(title?.systemLocked).toBe(true);
    expect(body?.systemLocked).toBe(true);
  });

  it("singletons set isSingleton: true and detailUrlPrefix: null", () => {
    for (const slug of ["site", "header", "appearance"] as const) {
      const def = PREBAKED_COLLECTIONS[slug];
      expect(def.isSingleton).toBe(true);
      expect(def.detailUrlPrefix).toBeNull();
    }
  });

  it("pages collection is not a singleton and uses manual sort", () => {
    expect(pagesCollectionDef.isSingleton).toBe(false);
    expect(pagesCollectionDef.detailUrlPrefix).toBe("/");
    expect(pagesCollectionDef.defaultSort).toEqual({ mode: "manual" });
  });

  it("every field has a unique id within its collection", () => {
    for (const [slug, def] of Object.entries(PREBAKED_COLLECTIONS)) {
      const ids = new Set<string>();
      for (const field of def.fields) {
        expect(ids.has(field.id), `${slug}: duplicate field id ${field.id}`).toBe(false);
        ids.add(field.id);
      }
    }
  });

  it("appearance has exactly 9 colors + 5 weight + 3 typography fields", () => {
    const fields = appearanceCollectionDef.fields;
    const colorFields = fields.filter((f) => f.key.startsWith("color_"));
    const weightFields = fields.filter(
      (f) => f.key.endsWith("_body") || f.key.endsWith("_bodyBold") || /Weight_h[1-3]$/.test(f.key),
    );
    expect(colorFields).toHaveLength(9);
    expect(weightFields).toHaveLength(5);
    expect(fields.find((f) => f.key === "bodyFont")).toBeDefined();
    expect(fields.find((f) => f.key === "headingMode")).toBeDefined();
    expect(fields.find((f) => f.key === "headingFont")).toBeDefined();
  });

  it("tour-dates has the expected core fields and routing config", () => {
    const def = tourDatesCollectionDef;
    expect(def.slug).toBe("tour-dates");
    expect(def.isSingleton).toBe(false);
    expect(def.detailUrlPrefix).toBe("/shows");
    expect(def.slugSourceFieldId).toBe(TOUR_DATES_FIELD_IDS.venue);
    expect(def.defaultSort).toEqual({
      mode: "fieldSort",
      fieldId: TOUR_DATES_FIELD_IDS.date,
      direction: "desc",
    });
    // Required core fields are systemLocked so the renderer can rely
    // on them; nice-to-have fields are editable.
    const date = def.fields.find((f) => f.id === TOUR_DATES_FIELD_IDS.date);
    const venue = def.fields.find((f) => f.id === TOUR_DATES_FIELD_IDS.venue);
    const ticketUrl = def.fields.find((f) => f.id === TOUR_DATES_FIELD_IDS.ticketUrl);
    expect(date?.systemLocked).toBe(true);
    expect(venue?.systemLocked).toBe(true);
    expect(ticketUrl?.systemLocked ?? false).toBe(false);
  });

  it("releases / posts have public detail pages; store-items / photos / videos don't", () => {
    expect(releasesCollectionDef.detailUrlPrefix).toBe("/releases");
    expect(postsCollectionDef.detailUrlPrefix).toBe("/news");
    expect(storeItemsCollectionDef.detailUrlPrefix).toBeNull();
    expect(photosCollectionDef.detailUrlPrefix).toBeNull();
    expect(videosCollectionDef.detailUrlPrefix).toBeNull();
  });

  it("the new prebaked collections don't conflict on detailUrlPrefix", () => {
    const prefixes = Object.values(PREBAKED_COLLECTIONS)
      .map((d) => d.detailUrlPrefix)
      .filter((p): p is string => p !== null);
    // Each non-null prefix is unique. This catches the case where
    // two prebaked collections accidentally claim the same URL.
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("every prebaked collection has its required core fields systemLocked", () => {
    // Spot-check: each non-singleton collection has at least one
    // systemLocked field. The schema editor's guardrails depend on
    // this for the routing / renderer invariants.
    const nonSingletonDefs = Object.values(PREBAKED_COLLECTIONS).filter(
      (d) => !d.isSingleton,
    );
    for (const def of nonSingletonDefs) {
      const locked = def.fields.filter((f) => f.systemLocked);
      expect(locked.length, `${def.slug}: no systemLocked fields`).toBeGreaterThan(0);
    }
  });

  it("videos.embedUrl is text so the upload source can store a public/ path", () => {
    // The `url` field type validates with `z.string().url()` which
    // rejects relative paths like `/uploads/song.mp4`. Switching to
    // `text` keeps embed URLs working for youtube / vimeo and lets
    // the upload source actually round-trip through the items API.
    const embedUrl = videosCollectionDef.fields.find(
      (f) => f.id === VIDEOS_FIELD_IDS.embedUrl,
    );
    expect(embedUrl?.type).toBe("text");
  });
});
