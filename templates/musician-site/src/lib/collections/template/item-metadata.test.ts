/**
 * Head metadata for collection-item detail pages, against the real
 * built-in defs from `seeds.ts`.
 */

import { describe, expect, it } from "vitest";

import { asImageId, type ImageMetadata } from "@/lib/image-types";

import { POSTS_FIELD_IDS, RELEASES_FIELD_IDS, TOUR_DATES_FIELD_IDS } from "../field-ids";
import type { Item } from "../schema";
import { postsCollectionDef, releasesCollectionDef, tourDatesCollectionDef } from "../seeds";
import { itemDetailMetadata } from "./item-metadata";

const TS = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };
const SITE = { artistName: "June Harlow", siteDescription: "Songs from the Pacific Northwest." };

const COVER: ImageMetadata = {
  id: asImageId("abc1234567890def"),
  alt: "Studio shot",
  width: 1600,
  height: 900,
  placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
  contentSlug: "post",
  originalExt: "jpg",
};

function post(values: Item["values"]): Item {
  return {
    id: "item_post_1",
    slug: "behind-the-record",
    ...TS,
    values: {
      [POSTS_FIELD_IDS.title]: { type: "text", value: "Behind the Record" },
      [POSTS_FIELD_IDS.publishedAt]: { type: "date", value: "2026-04-02" },
      ...values,
    },
  };
}

describe("itemDetailMetadata", () => {
  it("gives a post its title, summary and cover", () => {
    const item = post({
      [POSTS_FIELD_IDS.coverImage]: { type: "image", value: COVER },
      [POSTS_FIELD_IDS.summary]: { type: "longText", value: "  A track-by-track talk.  " },
    });
    expect(itemDetailMetadata(postsCollectionDef, item, SITE)).toEqual({
      title: "Behind the Record — June Harlow",
      description: "A track-by-track talk.",
      openGraph: {
        images: [{ url: "/images/post/abc1234567890def/1600.webp", alt: "Studio shot" }],
      },
    });
  });

  it("gives a release its title, description and cover", () => {
    const item: Item = {
      id: "item_release_1",
      slug: "halflight",
      ...TS,
      values: {
        [RELEASES_FIELD_IDS.title]: { type: "text", value: "Halflight" },
        [RELEASES_FIELD_IDS.coverImage]: {
          type: "image",
          value: { ...COVER, contentSlug: "release", width: 600, height: 600 },
        },
        [RELEASES_FIELD_IDS.releaseType]: { type: "select", value: "ep" },
        [RELEASES_FIELD_IDS.description]: { type: "longText", value: "Five songs, one take." },
      },
    };
    expect(itemDetailMetadata(releasesCollectionDef, item, SITE)).toEqual({
      title: "Halflight — June Harlow",
      description: "Five songs, one take.",
      openGraph: {
        images: [{ url: "/images/release/abc1234567890def/400.webp", alt: "Studio shot" }],
      },
    });
  });

  it("titles a show by its venue and falls back to the site description", () => {
    const item: Item = {
      id: "item_show_1",
      slug: "mercury-lounge",
      ...TS,
      values: {
        [TOUR_DATES_FIELD_IDS.date]: { type: "date", value: "2026-11-01T20:00" },
        [TOUR_DATES_FIELD_IDS.venue]: { type: "text", value: "Mercury Lounge" },
        [TOUR_DATES_FIELD_IDS.city]: { type: "text", value: "New York" },
        [TOUR_DATES_FIELD_IDS.status]: { type: "select", value: "on_sale" },
        [TOUR_DATES_FIELD_IDS.notes]: { type: "longText", value: "All ages." },
      },
    };
    expect(itemDetailMetadata(tourDatesCollectionDef, item, SITE)).toEqual({
      title: "Mercury Lounge — June Harlow",
      description: "Songs from the Pacific Northwest.",
    });
  });

  it("falls back to the site description when the summary is missing or blank", () => {
    const missing = itemDetailMetadata(postsCollectionDef, post({}), SITE);
    const blank = itemDetailMetadata(
      postsCollectionDef,
      post({ [POSTS_FIELD_IDS.summary]: { type: "longText", value: "   " } }),
      SITE,
    );
    for (const metadata of [missing, blank]) {
      expect(metadata.description).toBe("Songs from the Pacific Northwest.");
      expect(metadata.openGraph).toBeUndefined();
    }
  });

  it("titles an item by its slug when the slug-source field is blank", () => {
    const item = post({ [POSTS_FIELD_IDS.title]: { type: "text", value: " " } });
    expect(itemDetailMetadata(postsCollectionDef, item, SITE).title).toBe(
      "behind-the-record — June Harlow",
    );
  });

  it("leaves og:image off for a vector cover", () => {
    const item = post({
      [POSTS_FIELD_IDS.coverImage]: { type: "image", value: { ...COVER, originalExt: "svg" } },
    });
    expect(itemDetailMetadata(postsCollectionDef, item, SITE).openGraph).toBeUndefined();
  });
});
