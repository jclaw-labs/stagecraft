/**
 * Default detail layout (`DefaultItemDetail`) — the page a post,
 * release or tour date renders at its detail URL when the collection
 * has no `detailTemplate`. Exercised against the real built-in defs from
 * `seeds.ts` so a seed change that breaks the layout shows up here.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { asImageId, type ImageMetadata } from "@/lib/image-types";

import { POSTS_FIELD_IDS, RELEASES_FIELD_IDS, TOUR_DATES_FIELD_IDS } from "../field-ids";
import type { CollectionDef, Item } from "../schema";
import { postsCollectionDef, releasesCollectionDef, tourDatesCollectionDef } from "../seeds";
import { DefaultItemDetail, formatDetailDate, itemDetailSections } from "./item-detail";

const TS = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" };

const WIDE_IMAGE: ImageMetadata = {
  id: asImageId("abc1234567890def"),
  alt: "Studio shot",
  width: 1600,
  height: 900,
  placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
  contentSlug: "post",
  originalExt: "jpg",
};

const SQUARE_IMAGE: ImageMetadata = {
  ...WIDE_IMAGE,
  id: asImageId("fed0987654321cba"),
  alt: "Album art",
  width: 1600,
  height: 1600,
};

const textBlock = (id: string, value: string) => ({
  type: "Text",
  props: { id, content: { kind: "literal", value }, variant: "body", align: "left" },
});

function render(def: CollectionDef, item: Item): string {
  return renderToStaticMarkup(<DefaultItemDetail def={def} item={item} />);
}

/** Every raw value that must never reach the page as-is. */
function expectNoRawDump(html: string, item: Item, def: CollectionDef) {
  for (const field of def.fields) expect(html).not.toContain(`${field.key}:`);
  expect(html).not.toContain(item.id);
  expect(html).not.toContain(item.createdAt);
  expect(html).not.toContain(item.updatedAt);
}

// ---------------------------------------------------------------------------
// Posts — /news/<slug>
// ---------------------------------------------------------------------------

const POST: Item = {
  id: "item_post_1",
  slug: "behind-the-record",
  ...TS,
  values: {
    [POSTS_FIELD_IDS.title]: { type: "text", value: "Behind the Record" },
    [POSTS_FIELD_IDS.coverImage]: { type: "image", value: WIDE_IMAGE },
    [POSTS_FIELD_IDS.publishedAt]: { type: "date", value: "2026-04-02" },
    [POSTS_FIELD_IDS.category]: { type: "select", value: "interview" },
    [POSTS_FIELD_IDS.summary]: { type: "longText", value: "A track-by-track conversation." },
    [POSTS_FIELD_IDS.body]: {
      type: "puckContent",
      value: {
        root: { props: {} },
        content: [textBlock("b1", "We cut most of it live.")],
      },
    },
  },
};

describe("DefaultItemDetail — posts", () => {
  it("uses the title field as the heading, not the slug", () => {
    const html = render(postsCollectionDef, POST);
    expect(html).toContain("<h1");
    expect(html).toMatch(/<h1[^>]*>Behind the Record<\/h1>/);
    expect(html).not.toContain("behind-the-record");
  });

  it("shows the formatted date and the category label in field order", () => {
    const html = render(postsCollectionDef, POST);
    expect(html).toContain("April 2, 2026 · Interview");
    expect(html).not.toContain("2026-04-02");
    expect(html).not.toContain(">interview<");
  });

  it("renders the cover image and the summary", () => {
    const html = render(postsCollectionDef, POST);
    expect(html).toContain("data-item-detail-cover");
    expect(html).toContain('alt="Studio shot"');
    expect(html).toContain("A track-by-track conversation.");
  });

  it("renders the puckContent body through the template renderer", () => {
    const html = render(postsCollectionDef, POST);
    expect(html).toContain("data-item-detail-body");
    expect(html).toContain("We cut most of it live.");
  });

  it("prints no field keys or item metadata", () => {
    expectNoRawDump(render(postsCollectionDef, POST), POST, postsCollectionDef);
  });

  it("skips an empty body and a missing cover", () => {
    const item: Item = {
      ...POST,
      values: {
        [POSTS_FIELD_IDS.title]: { type: "text", value: "Short" },
        [POSTS_FIELD_IDS.publishedAt]: { type: "date", value: "2026-04-02" },
        [POSTS_FIELD_IDS.body]: {
          type: "puckContent",
          value: { root: { props: {} }, content: [] },
        },
      },
    };
    const html = render(postsCollectionDef, item);
    expect(html).not.toContain("data-item-detail-body");
    expect(html).not.toContain("data-item-detail-cover");
    expect(html).toContain("April 2, 2026");
  });
});

// ---------------------------------------------------------------------------
// Releases — /releases/<slug>
// ---------------------------------------------------------------------------

const RELEASE: Item = {
  id: "item_release_1",
  slug: "the-long-way-home",
  ...TS,
  values: {
    [RELEASES_FIELD_IDS.title]: { type: "text", value: "The Long Way Home" },
    [RELEASES_FIELD_IDS.coverImage]: { type: "image", value: SQUARE_IMAGE },
    [RELEASES_FIELD_IDS.releaseType]: { type: "select", value: "ep" },
    [RELEASES_FIELD_IDS.releaseDate]: { type: "date", value: "2026-03-01" },
    [RELEASES_FIELD_IDS.description]: { type: "longText", value: "Ten songs cut live to tape." },
    [RELEASES_FIELD_IDS.body]: {
      type: "puckContent",
      value: { root: { props: {} }, content: [textBlock("r1", "Out now on vinyl.")] },
    },
  },
};

describe("DefaultItemDetail — releases", () => {
  it("renders title, type label · formatted date, description and body", () => {
    const html = render(releasesCollectionDef, RELEASE);
    expect(html).toMatch(/<h1[^>]*>The Long Way Home<\/h1>/);
    expect(html).toContain("EP · March 1, 2026");
    expect(html).toContain("Ten songs cut live to tape.");
    expect(html).toContain("Out now on vinyl.");
  });

  it("keeps square cover art to the narrow width", () => {
    const html = render(releasesCollectionDef, RELEASE);
    expect(html).toContain('alt="Album art"');
    expect(html).toMatch(/data-item-detail-cover="true" style="max-width:var\(--max-width-narrow\)/);
  });

  it("lets wide covers use the full content width", () => {
    const item: Item = {
      ...RELEASE,
      values: { ...RELEASE.values, [RELEASES_FIELD_IDS.coverImage]: { type: "image", value: WIDE_IMAGE } },
    };
    expect(render(releasesCollectionDef, item)).not.toContain("--max-width-narrow");
  });

  it("prints no field keys or item metadata", () => {
    expectNoRawDump(render(releasesCollectionDef, RELEASE), RELEASE, releasesCollectionDef);
  });
});

// ---------------------------------------------------------------------------
// Tour dates — /shows/<slug>
// ---------------------------------------------------------------------------

const SHOW: Item = {
  id: "item_show_1",
  slug: "mercury-lounge",
  ...TS,
  values: {
    [TOUR_DATES_FIELD_IDS.date]: { type: "date", value: "2026-08-25T20:00:00.000Z" },
    [TOUR_DATES_FIELD_IDS.venue]: { type: "text", value: "Mercury Lounge" },
    [TOUR_DATES_FIELD_IDS.city]: { type: "text", value: "New York" },
    [TOUR_DATES_FIELD_IDS.country]: { type: "text", value: "United States" },
    [TOUR_DATES_FIELD_IDS.status]: { type: "select", value: "sold_out" },
    [TOUR_DATES_FIELD_IDS.ticketUrl]: { type: "url", value: "https://tix.example/mercury" },
    [TOUR_DATES_FIELD_IDS.notes]: { type: "longText", value: "Doors at 7." },
  },
};

describe("DefaultItemDetail — tour dates", () => {
  it("uses the venue (slug source) as the heading and city, country as the subtitle", () => {
    const html = render(tourDatesCollectionDef, SHOW);
    expect(html).toMatch(/<h1[^>]*>Mercury Lounge<\/h1>/);
    expect(html).toContain("New York, United States");
  });

  it("formats the date with weekday and time, then the status label", () => {
    const html = render(tourDatesCollectionDef, SHOW);
    expect(html).toContain("Tue, August 25, 2026 · 8:00 PM · Sold out");
    expect(html).not.toContain("sold_out");
    expect(html).not.toContain("2026-08-25T20:00");
  });

  it("renders the ticket URL as a Tickets button and the notes as a paragraph", () => {
    const html = render(tourDatesCollectionDef, SHOW);
    expect(html).toMatch(/<a href="https:\/\/tix\.example\/mercury"[^>]*>Tickets<\/a>/);
    expect(html).toContain("Doors at 7.");
  });

  it("shows a naked local datetime as written, without a time-zone shift", () => {
    const item: Item = {
      ...SHOW,
      values: { ...SHOW.values, [TOUR_DATES_FIELD_IDS.date]: { type: "date", value: "2026-07-15T20:00" } },
    };
    expect(render(tourDatesCollectionDef, item)).toContain("Wed, July 15, 2026 · 8:00 PM");
  });

  it("prints no field keys or item metadata", () => {
    expectNoRawDump(render(tourDatesCollectionDef, SHOW), SHOW, tourDatesCollectionDef);
  });
});

// ---------------------------------------------------------------------------
// Artist-created collections + edge cases
// ---------------------------------------------------------------------------

const CUSTOM_DEF: CollectionDef = {
  schemaVersion: 1,
  slug: "press",
  singularName: "press item",
  pluralName: "press",
  fields: [
    { id: "f_headline", key: "headline", type: "text", required: true },
    { id: "f_outlet", key: "outlet", type: "text", required: false },
    { id: "f_rating", key: "rating", type: "number", required: false },
    {
      id: "f_tags",
      key: "tags",
      type: "multiSelect",
      options: [
        { id: "o1", value: "live", label: "Live" },
        { id: "o2", value: "review", label: "Review" },
      ],
    },
    { id: "f_featured", key: "featured", type: "boolean" },
    { id: "f_accent", key: "accent", type: "color", required: false },
    { id: "f_related", key: "related", type: "collectionRef", required: false, targetCollection: "posts" },
    { id: "f_contact", key: "contact", type: "email", required: false },
    { id: "f_link", key: "link", type: "url", required: false },
    { id: "f_body", key: "body", type: "richText", required: false },
  ],
  slugSourceFieldId: "f_headline",
  detailUrlPrefix: "/press",
  defaultSort: null,
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

const CUSTOM_ITEM: Item = {
  id: "item_press_1",
  slug: "a-review",
  ...TS,
  values: {
    f_headline: { type: "text", value: "A Review" },
    f_outlet: { type: "text", value: "The Paper" },
    f_rating: { type: "number", value: 4 },
    f_tags: { type: "multiSelect", value: ["live", "review"] },
    f_featured: { type: "boolean", value: true },
    f_accent: { type: "color", value: "#ff0000" },
    f_related: { type: "collectionRef", value: { itemId: "item_x" } },
    f_contact: { type: "email", value: "press@example.com" },
    f_link: { type: "url", value: "https://www.thepaper.example/review" },
    f_body: {
      type: "richText",
      value: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Five stars, nearly." }] }],
      },
    },
  },
};

describe("DefaultItemDetail — artist-created collections", () => {
  it("renders labels for multiSelect, numbers in the meta line, and a richText body", () => {
    const html = render(CUSTOM_DEF, CUSTOM_ITEM);
    expect(html).toContain("4 · Live, Review");
    expect(html).toContain("Five stars, nearly.");
    expect(html).toContain("The Paper");
  });

  it("links URLs by hostname and emails via mailto", () => {
    const html = render(CUSTOM_DEF, CUSTOM_ITEM);
    expect(html).toMatch(/href="https:\/\/www\.thepaper\.example\/review"[^>]*>thepaper\.example<\/a>/);
    expect(html).toMatch(/href="mailto:press@example\.com"[^>]*>press@example\.com<\/a>/);
  });

  it("hides internal field types: boolean, color, collection refs", () => {
    const html = render(CUSTOM_DEF, CUSTOM_ITEM);
    expect(html).not.toContain("#ff0000");
    expect(html).not.toContain("item_x");
    expect(html).not.toContain(">true<");
    expectNoRawDump(html, CUSTOM_ITEM, CUSTOM_DEF);
  });

  it("falls back to the slug as the heading when the slug-source field is empty", () => {
    const item: Item = {
      ...CUSTOM_ITEM,
      values: { f_headline: { type: "text", value: "  " }, f_outlet: { type: "text", value: "Zine" } },
    };
    const html = render(CUSTOM_DEF, item);
    expect(html).toMatch(/<h1[^>]*>a-review<\/h1>/);
    expect(html).toContain("Zine");
  });

  it("puts a second image after the body rather than replacing the cover", () => {
    const def: CollectionDef = {
      ...CUSTOM_DEF,
      fields: [
        { id: "f_headline", key: "headline", type: "text", required: true },
        { id: "f_img1", key: "img1", type: "image", required: false },
        { id: "f_img2", key: "img2", type: "image", required: false },
      ],
    };
    const sections = itemDetailSections(def, {
      ...CUSTOM_ITEM,
      values: {
        f_headline: { type: "text", value: "Two pictures" },
        f_img1: { type: "image", value: WIDE_IMAGE },
        f_img2: { type: "image", value: SQUARE_IMAGE },
      },
    });
    expect(sections.cover).toBe(WIDE_IMAGE);
    expect(sections.extraImages).toEqual([SQUARE_IMAGE]);
  });
});

// ---------------------------------------------------------------------------
// formatDetailDate
// ---------------------------------------------------------------------------

describe("formatDetailDate", () => {
  it("formats a date-only value without drifting a day", () => {
    expect(formatDetailDate("2026-01-01", false)).toBe("January 1, 2026");
  });

  it("formats a UTC datetime with weekday and time", () => {
    expect(formatDetailDate("2026-08-25T20:00:00.000Z", true)).toBe("Tue, August 25, 2026 · 8:00 PM");
  });

  it("treats an offset datetime as an absolute instant", () => {
    expect(formatDetailDate("2026-08-25T20:00:00-04:00", true)).toBe("Wed, August 26, 2026 · 12:00 AM");
  });

  it("returns an unparseable value unchanged", () => {
    expect(formatDetailDate("someday", false)).toBe("someday");
  });
});
