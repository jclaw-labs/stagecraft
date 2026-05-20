/**
 * Tests for the slug-suggestion rule used by the new-item flow.
 *
 * Covers the common text-source path and the photos-specific
 * image-derived path (with date-based fallback). Each test
 * constructs a minimal CollectionDef + Item rather than reaching
 * for fixtures so the inputs are visible in the test body.
 */

import { describe, expect, it } from "vitest";

import { suggestSlug } from "./suggest-slug";
import { PHOTOS_FIELD_IDS } from "./field-ids";
import {
  CURRENT_COLLECTION_SCHEMA_VERSION,
  type CollectionDef,
  type Item,
} from "./schema";
import { asImageId } from "../image-types";

const TS = "2026-05-20T00:00:00.000Z";

function makeDef(overrides: Partial<CollectionDef> = {}): CollectionDef {
  return {
    schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
    slug: "tour-dates",
    singularName: "tour date",
    pluralName: "tour dates",
    fields: [
      { id: "f_venue", key: "venue", type: "text", required: true },
    ],
    slugSourceFieldId: "f_venue",
    detailUrlPrefix: null,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: false,
    ...overrides,
  };
}

function makeItem(values: Item["values"]): Item {
  return {
    id: "item_test",
    slug: "",
    createdAt: TS,
    updatedAt: TS,
    values,
  };
}

const STUB_IMAGE = {
  id: asImageId("a1b2c3d4e5f60000"),
  alt: "x",
  width: 800,
  height: 600,
  placeholderDataUri: "data:image/webp;base64,abc",
  contentSlug: "tour-2026-paris",
  originalExt: "jpg" as const,
};

describe("suggestSlug — text-source path", () => {
  it("slugifies the source field's string value", () => {
    const def = makeDef();
    const item = makeItem({
      f_venue: { type: "text", value: "Madison Square Garden" },
    });
    expect(suggestSlug(item, def)).toBe("madison-square-garden");
  });

  it("returns empty string when slugSourceFieldId is null", () => {
    const def = makeDef({ slugSourceFieldId: null });
    const item = makeItem({});
    expect(suggestSlug(item, def)).toBe("");
  });

  it("returns empty string when the source field has no value", () => {
    const def = makeDef();
    const item = makeItem({});
    expect(suggestSlug(item, def)).toBe("");
  });

  it("strips non-slug-safe characters and collapses hyphens", () => {
    const def = makeDef();
    const item = makeItem({
      f_venue: { type: "text", value: "Hello, World!  -  How's it going?" },
    });
    // Apostrophes and exclamation points strip; commas become
    // hyphens; runs of hyphens collapse.
    expect(suggestSlug(item, def)).toBe("hello-world-how-s-it-going");
  });

  it("caps the slug at 64 characters", () => {
    const def = makeDef();
    const long = "a".repeat(100);
    const item = makeItem({ f_venue: { type: "text", value: long } });
    expect(suggestSlug(item, def)).toHaveLength(64);
  });

  it("strips a trailing hyphen left by the 64-char slice", () => {
    // Construct an input where the slice boundary lands inside what
    // was originally a run of disallowed chars (collapsed to a
    // single hyphen). Without the post-slice strip, the result
    // would end in "-".
    const def = makeDef();
    // 63 'a's then a space — slugified becomes 63 'a's + "-" (64
    // chars total). Without the post-slice fix, the slug ends in "-".
    const input = "a".repeat(63) + " ";
    const item = makeItem({ f_venue: { type: "text", value: input } });
    const out = suggestSlug(item, def);
    expect(out).not.toMatch(/-$/);
    expect(out).toBe("a".repeat(63));
  });
});

describe("suggestSlug — photos collection", () => {
  const photosDef = makeDef({
    slug: "photos",
    singularName: "photo",
    pluralName: "photos",
    fields: [
      { id: PHOTOS_FIELD_IDS.image, key: "image", type: "image", required: true },
      { id: PHOTOS_FIELD_IDS.takenAt, key: "takenAt", type: "date", required: false },
    ],
    slugSourceFieldId: null,
  });

  it("derives from the image's contentSlug + 6-char id suffix when uploaded", () => {
    const item = makeItem({
      [PHOTOS_FIELD_IDS.image]: { type: "image", value: STUB_IMAGE },
    });
    expect(suggestSlug(item, photosDef)).toBe("tour-2026-paris-a1b2c3");
  });

  it("falls back to photo-<takenAt> when no image is uploaded yet", () => {
    const item = makeItem({
      [PHOTOS_FIELD_IDS.takenAt]: { type: "date", value: "2026-07-15" },
    });
    expect(suggestSlug(item, photosDef)).toBe("photo-2026-07-15");
  });

  it("falls back to today's date when neither image nor takenAt is set", () => {
    const item = makeItem({});
    const suggested = suggestSlug(item, photosDef);
    // The date prefix is deterministic from `new Date()`; just
    // assert the shape so the test doesn't fail at midnight.
    expect(suggested).toMatch(/^photo-\d{4}-\d{2}-\d{2}$/);
  });

  it("prefers the image-derived slug over the date fallback when image is set", () => {
    const item = makeItem({
      [PHOTOS_FIELD_IDS.image]: { type: "image", value: STUB_IMAGE },
      [PHOTOS_FIELD_IDS.takenAt]: { type: "date", value: "2026-07-15" },
    });
    expect(suggestSlug(item, photosDef)).toBe("tour-2026-paris-a1b2c3");
  });

  it("survives an image with a contentSlug containing characters that need slugifying", () => {
    const item = makeItem({
      [PHOTOS_FIELD_IDS.image]: {
        type: "image",
        value: { ...STUB_IMAGE, contentSlug: "Site Photos!" },
      },
    });
    // contentSlug should already be slug-safe (the upload pipeline
    // enforces) but defense-in-depth: the slugifier collapses any
    // stray characters.
    expect(suggestSlug(item, photosDef)).toBe("site-photos-a1b2c3");
  });

  it("image-derived slug wins even if slugSourceFieldId is set on a photos def", () => {
    // Pins the precedence rule documented in the helper: photos
    // collections always use image-derived slugs. A custom photos
    // def that someone wires up with a text source still falls
    // through to the image logic.
    const customDef = makeDef({
      slug: "photos",
      singularName: "photo",
      pluralName: "photos",
      fields: [
        { id: PHOTOS_FIELD_IDS.image, key: "image", type: "image", required: true },
        { id: PHOTOS_FIELD_IDS.caption, key: "caption", type: "text", required: false },
      ],
      slugSourceFieldId: PHOTOS_FIELD_IDS.caption,
    });
    const item = makeItem({
      [PHOTOS_FIELD_IDS.image]: { type: "image", value: STUB_IMAGE },
      [PHOTOS_FIELD_IDS.caption]: { type: "text", value: "Should be ignored" },
    });
    expect(suggestSlug(item, customDef)).toBe("tour-2026-paris-a1b2c3");
  });
});
