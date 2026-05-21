/**
 * Prebaked collection definitions for the four surfaces that exist on
 * day one of every artist site: `pages`, `site`, `header`, `appearance`.
 *
 * Each `_collection.json` shipped in a fresh artist repo is one of
 * these. The schema editor (PR 5) will let the artist add fields on
 * top, but anything marked `systemLocked` here can't be removed — the
 * renderer and routing depend on those fields. ADR-009 §11.
 *
 * Field ids are stable identifiers picked once for the migration
 * (ADR-009 §13). Existing artist content references them; never rename
 * them, only add new ones. They're spelled out as constants below so
 * the migration helpers in `./migrate-from-legacy.ts` can reuse them
 * for the value-by-value translation.
 */

import {
  CURRENT_COLLECTION_SCHEMA_VERSION,
  type CollectionDef,
  type SelectOption,
} from "./schema";

// Field-id constants live in `./field-ids.ts` (client-bundle-safe);
// re-exported here for source-compat with existing imports.
import {
  APPEARANCE_FIELD_IDS,
  HEADER_FIELD_IDS,
  PAGES_FIELD_IDS,
  PHOTOS_COLLECTION_SLUG,
  PHOTOS_FIELD_IDS,
  SITE_FIELD_IDS,
} from "./field-ids";
export {
  APPEARANCE_FIELD_IDS,
  HEADER_FIELD_IDS,
  PAGES_FIELD_IDS,
  PHOTOS_COLLECTION_SLUG,
  PHOTOS_FIELD_IDS,
  SITE_FIELD_IDS,
};

import {
  COLOR_FIELDS,
  FONT_WEIGHTS,
  HEADER_LAYOUTS,
  HEADER_LAYOUT_LABELS,
  HEADER_MODES,
  HEADER_MODE_LABELS,
  HEADING_MODES,
  HEADING_MODE_LABELS,
  SOCIAL_PLATFORMS,
} from "../site-config-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const selectOptionsFrom = <T extends readonly string[]>(
  values: T,
  labels: Record<T[number], string>,
): SelectOption[] =>
  values.map((value, i) => ({
    id: `o${i + 1}`,
    value,
    label: labels[value as T[number]] ?? value,
  }));

const fontWeightOptions: SelectOption[] = FONT_WEIGHTS.map((w, i) => ({
  id: `o${i + 1}`,
  value: String(w),
  label: String(w),
}));

// ---------------------------------------------------------------------------
// Pages collection
// ---------------------------------------------------------------------------

export const pagesCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: "pages",
  singularName: "page",
  pluralName: "pages",
  fields: [
    {
      id: PAGES_FIELD_IDS.title,
      key: "title",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: PAGES_FIELD_IDS.isSplashPage,
      key: "isSplashPage",
      type: "boolean",
      systemLocked: true,
    },
    {
      id: PAGES_FIELD_IDS.isFooterHidden,
      key: "isFooterHidden",
      type: "boolean",
      systemLocked: true,
    },
    {
      id: PAGES_FIELD_IDS.showInNav,
      key: "showInNav",
      type: "boolean",
      default: true,
      systemLocked: true,
    },
    {
      id: PAGES_FIELD_IDS.body,
      key: "body",
      type: "puckContent",
      systemLocked: true,
    },
  ],
  slugSourceFieldId: PAGES_FIELD_IDS.title,
  detailUrlPrefix: "/",
  defaultSort: { mode: "manual" },
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

// ---------------------------------------------------------------------------
// Site singleton
// ---------------------------------------------------------------------------

export const siteCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: "site",
  singularName: "site settings",
  pluralName: "site settings",
  fields: [
    {
      id: SITE_FIELD_IDS.artistName,
      key: "artistName",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: SITE_FIELD_IDS.siteTitle,
      key: "siteTitle",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: SITE_FIELD_IDS.siteDescription,
      key: "siteDescription",
      type: "longText",
      required: false,
    },
    {
      id: SITE_FIELD_IDS.contactEmail,
      key: "contactEmail",
      type: "email",
      required: true,
      systemLocked: true,
    },
    { id: SITE_FIELD_IDS.copyrightName, key: "copyrightName", type: "text", required: false },
    { id: SITE_FIELD_IDS.isFooterHidden, key: "isFooterHidden", type: "boolean" },
    // Site-wide chrome customisation — parity with the legacy
    // template. Favicon overrides the default `/favicons/favicon.svg`
    // in `<link rel="icon">`; pageBackground paints behind every
    // page's content. Both go through the standard image upload
    // pipeline (sharp variants + LQIP).
    { id: SITE_FIELD_IDS.favicon, key: "favicon", type: "image", required: false },
    {
      id: SITE_FIELD_IDS.pageBackground,
      key: "pageBackground",
      type: "image",
      required: false,
    },
    // First-run completion flag. systemLocked because the welcome
    // wizard and reset flow are the only writers; the artist
    // shouldn't see it as an editable field in the schema editor.
    {
      id: SITE_FIELD_IDS.hasCompletedFirstRun,
      key: "hasCompletedFirstRun",
      type: "boolean",
      systemLocked: true,
    },
    // One field per social platform — flatter than the legacy
    // `socialLinks: Record<...>` shape but means the schema editor can
    // treat each as an independent slot.
    ...SOCIAL_PLATFORMS.map((platform) => ({
      id: SITE_FIELD_IDS.social(platform),
      key: `social_${platform}`,
      type: "url" as const,
      required: false,
    })),
  ],
  slugSourceFieldId: null,
  detailUrlPrefix: null,
  defaultSort: null,
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: true,
};

// ---------------------------------------------------------------------------
// Header singleton
// ---------------------------------------------------------------------------

export const headerCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: "header",
  singularName: "header & navigation",
  pluralName: "header & navigation",
  fields: [
    { id: HEADER_FIELD_IDS.wordmark, key: "wordmark", type: "image", required: false },
    {
      id: HEADER_FIELD_IDS.wordmarkSizeAdjust,
      key: "wordmarkSizeAdjust",
      type: "number",
      required: false,
      min: -2,
      max: 2,
      step: 1,
    },
    {
      id: HEADER_FIELD_IDS.headerMode,
      key: "headerMode",
      type: "select",
      required: true,
      systemLocked: true,
      options: selectOptionsFrom(HEADER_MODES, HEADER_MODE_LABELS),
    },
    {
      id: HEADER_FIELD_IDS.headerForegroundColor,
      key: "headerForegroundColor",
      type: "text",
      required: false,
    },
    { id: HEADER_FIELD_IDS.isHeaderTextUppercase, key: "isHeaderTextUppercase", type: "boolean" },
    { id: HEADER_FIELD_IDS.headerSubtitle, key: "headerSubtitle", type: "text", required: false },
    {
      id: HEADER_FIELD_IDS.headerLayout,
      key: "headerLayout",
      type: "select",
      required: true,
      systemLocked: true,
      options: selectOptionsFrom(HEADER_LAYOUTS, HEADER_LAYOUT_LABELS),
    },
  ],
  slugSourceFieldId: null,
  detailUrlPrefix: null,
  defaultSort: null,
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: true,
};

// ---------------------------------------------------------------------------
// Appearance singleton
// ---------------------------------------------------------------------------

export const appearanceCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: "appearance",
  singularName: "appearance",
  pluralName: "appearance",
  fields: [
    // The 9 named colors. `linkColor` is allowed to be empty (falls
    // back to accent at render — see resolveLinkColor); the rest are
    // required so the renderer always has a value. Stored as `text`
    // not `color` because the legacy empty-string for linkColor would
    // fail the hex-regex check on the `color` type.
    ...COLOR_FIELDS.map((color) => ({
      id: APPEARANCE_FIELD_IDS.color(color),
      key: `color_${color}`,
      type: "text" as const,
      required: color !== "linkColor",
      systemLocked: true,
    })),

    // Typography. Stored flat so each weight is editable independently.
    {
      id: APPEARANCE_FIELD_IDS.bodyFont,
      key: "bodyFont",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: APPEARANCE_FIELD_IDS.headingMode,
      key: "headingMode",
      type: "select",
      required: true,
      systemLocked: true,
      options: selectOptionsFrom(HEADING_MODES, HEADING_MODE_LABELS),
    },
    { id: APPEARANCE_FIELD_IDS.headingFont, key: "headingFont", type: "text", required: false },
    // Font weights stored as `select` over the numeric ladder so the
    // editor surfaces a dropdown rather than a free-text field, and
    // values stay constrained to multiples of 100.
    ...(
      [
        ["bodyWeight_body", APPEARANCE_FIELD_IDS.bodyWeight_body],
        ["bodyWeight_bodyBold", APPEARANCE_FIELD_IDS.bodyWeight_bodyBold],
        ["headingWeight_h1", APPEARANCE_FIELD_IDS.headingWeight_h1],
        ["headingWeight_h2", APPEARANCE_FIELD_IDS.headingWeight_h2],
        ["headingWeight_h3", APPEARANCE_FIELD_IDS.headingWeight_h3],
      ] as const
    ).map(([key, id]) => ({
      id,
      key,
      type: "select" as const,
      required: true,
      systemLocked: true,
      options: fontWeightOptions,
    })),
  ],
  slugSourceFieldId: null,
  detailUrlPrefix: null,
  defaultSort: null,
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: true,
};

// ---------------------------------------------------------------------------
// Tour Dates collection — first non-pages collection (ADR-009 PR 7)
// ---------------------------------------------------------------------------

const TOUR_DATE_STATUSES = ["on_sale", "sold_out", "cancelled", "free"] as const;
const TOUR_DATE_STATUS_LABELS: Record<(typeof TOUR_DATE_STATUSES)[number], string> = {
  on_sale: "On sale",
  sold_out: "Sold out",
  cancelled: "Cancelled",
  free: "Free",
};

export const TOUR_DATES_FIELD_IDS = {
  date: "fld_tour_dates_date",
  venue: "fld_tour_dates_venue",
  city: "fld_tour_dates_city",
  country: "fld_tour_dates_country",
  status: "fld_tour_dates_status",
  ticketUrl: "fld_tour_dates_ticketUrl",
  notes: "fld_tour_dates_notes",
} as const;

export const tourDatesCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: "tour-dates",
  singularName: "tour date",
  pluralName: "tour dates",
  fields: [
    // Stored as naked-local datetime (`2026-07-15T20:00`) — no
    // timezone. The artist enters venue-local time; the renderer
    // displays it as-is. International tours where the artist
    // crosses time zones will need a `timezone` field added through
    // the schema editor; v1 keeps the seed simple.
    {
      id: TOUR_DATES_FIELD_IDS.date,
      key: "date",
      type: "date",
      required: true,
      includeTime: true,
      systemLocked: true,
    },
    {
      id: TOUR_DATES_FIELD_IDS.venue,
      key: "venue",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: TOUR_DATES_FIELD_IDS.city,
      key: "city",
      type: "text",
      required: true,
    },
    {
      id: TOUR_DATES_FIELD_IDS.country,
      key: "country",
      type: "text",
      required: false,
    },
    {
      id: TOUR_DATES_FIELD_IDS.status,
      key: "status",
      type: "select",
      required: true,
      options: selectOptionsFrom(TOUR_DATE_STATUSES, TOUR_DATE_STATUS_LABELS),
    },
    {
      id: TOUR_DATES_FIELD_IDS.ticketUrl,
      key: "ticketUrl",
      type: "url",
      required: false,
    },
    {
      id: TOUR_DATES_FIELD_IDS.notes,
      key: "notes",
      type: "longText",
      required: false,
    },
  ],
  slugSourceFieldId: TOUR_DATES_FIELD_IDS.venue,
  detailUrlPrefix: "/shows",
  // `desc` so the admin list view shows the most-recent / upcoming
  // dates first. Public Collection blocks re-sort independently via
  // their own `sort` prop (typically filtered to date >= now() and
  // sorted ascending so "next show" is at the top).
  defaultSort: { mode: "fieldSort", fieldId: TOUR_DATES_FIELD_IDS.date, direction: "desc" },
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

// ---------------------------------------------------------------------------
// Releases collection — albums / EPs / singles (ADR-009 PR 8)
// ---------------------------------------------------------------------------

const RELEASE_TYPES = ["album", "ep", "single"] as const;
const RELEASE_TYPE_LABELS: Record<(typeof RELEASE_TYPES)[number], string> = {
  album: "Album",
  ep: "EP",
  single: "Single",
};

export const RELEASES_FIELD_IDS = {
  title: "fld_releases_title",
  coverImage: "fld_releases_coverImage",
  releaseType: "fld_releases_releaseType",
  releaseDate: "fld_releases_releaseDate",
  description: "fld_releases_description",
  body: "fld_releases_body",
} as const;

export const releasesCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: "releases",
  singularName: "release",
  pluralName: "releases",
  fields: [
    {
      id: RELEASES_FIELD_IDS.title,
      key: "title",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: RELEASES_FIELD_IDS.coverImage,
      key: "coverImage",
      type: "image",
      required: true,
      systemLocked: true,
    },
    {
      id: RELEASES_FIELD_IDS.releaseType,
      key: "releaseType",
      type: "select",
      required: true,
      options: selectOptionsFrom(RELEASE_TYPES, RELEASE_TYPE_LABELS),
    },
    {
      // Optional — supports the "I'm planning a 2027 release but
      // haven't picked a date yet" workflow. Items without a
      // releaseDate sort to the end of the list (per the
      // `defaultSort` below + the store's null-sort-to-end rule),
      // which is what artists expect: dated releases on top,
      // pending below.
      id: RELEASES_FIELD_IDS.releaseDate,
      key: "releaseDate",
      type: "date",
      required: false,
    },
    {
      id: RELEASES_FIELD_IDS.description,
      key: "description",
      type: "longText",
      required: false,
    },
    {
      // Full body for streaming-link blocks, tracklist, liner notes —
      // anything the artist wants on the release's detail page beyond
      // the structured fields.
      id: RELEASES_FIELD_IDS.body,
      key: "body",
      type: "puckContent",
      systemLocked: true,
    },
  ],
  slugSourceFieldId: RELEASES_FIELD_IDS.title,
  detailUrlPrefix: "/releases",
  defaultSort: {
    mode: "fieldSort",
    fieldId: RELEASES_FIELD_IDS.releaseDate,
    direction: "desc",
  },
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

// ---------------------------------------------------------------------------
// Posts collection — blog / news (ADR-009 PR 8)
// ---------------------------------------------------------------------------

const POST_CATEGORIES = ["news", "announcement", "interview", "essay"] as const;
const POST_CATEGORY_LABELS: Record<(typeof POST_CATEGORIES)[number], string> = {
  news: "News",
  announcement: "Announcement",
  interview: "Interview",
  essay: "Essay",
};

export const POSTS_FIELD_IDS = {
  title: "fld_posts_title",
  coverImage: "fld_posts_coverImage",
  publishedAt: "fld_posts_publishedAt",
  category: "fld_posts_category",
  summary: "fld_posts_summary",
  body: "fld_posts_body",
} as const;

export const postsCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: "posts",
  singularName: "post",
  pluralName: "posts",
  fields: [
    {
      id: POSTS_FIELD_IDS.title,
      key: "title",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: POSTS_FIELD_IDS.coverImage,
      key: "coverImage",
      type: "image",
      required: false,
    },
    {
      id: POSTS_FIELD_IDS.publishedAt,
      key: "publishedAt",
      type: "date",
      required: true,
      systemLocked: true,
    },
    {
      id: POSTS_FIELD_IDS.category,
      key: "category",
      type: "select",
      required: false,
      options: selectOptionsFrom(POST_CATEGORIES, POST_CATEGORY_LABELS),
    },
    {
      id: POSTS_FIELD_IDS.summary,
      key: "summary",
      type: "longText",
      required: false,
    },
    {
      // The artist authors the full post here. Required so every post
      // has a visible body on its detail page.
      id: POSTS_FIELD_IDS.body,
      key: "body",
      type: "puckContent",
      systemLocked: true,
    },
  ],
  slugSourceFieldId: POSTS_FIELD_IDS.title,
  detailUrlPrefix: "/news",
  defaultSort: {
    mode: "fieldSort",
    fieldId: POSTS_FIELD_IDS.publishedAt,
    direction: "desc",
  },
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

// ---------------------------------------------------------------------------
// Store items collection — merch + downloads (ADR-009 PR 8)
// ---------------------------------------------------------------------------

const STORE_ITEM_KINDS = ["physical", "digital", "ticket"] as const;
const STORE_ITEM_KIND_LABELS: Record<(typeof STORE_ITEM_KINDS)[number], string> = {
  physical: "Physical",
  digital: "Digital",
  ticket: "Ticket",
};

// The common ISO 4217 currency codes most artists need. Constrained
// to a select (rather than free-text) so the public renderer can
// safely format prices and so the same currency renders consistently
// across items — the free-text alternative produced "USD" / "$" /
// "usd" inconsistencies on the same site. Artists with a less-
// common currency extend the option set via the schema editor.
const STORE_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"] as const;
const STORE_CURRENCY_LABELS: Record<(typeof STORE_CURRENCIES)[number], string> = {
  USD: "USD — US Dollar",
  EUR: "EUR — Euro",
  GBP: "GBP — British Pound",
  CAD: "CAD — Canadian Dollar",
  AUD: "AUD — Australian Dollar",
  JPY: "JPY — Japanese Yen",
};

export const STORE_ITEMS_FIELD_IDS = {
  title: "fld_store_items_title",
  image: "fld_store_items_image",
  kind: "fld_store_items_kind",
  price: "fld_store_items_price",
  currency: "fld_store_items_currency",
  description: "fld_store_items_description",
  externalUrl: "fld_store_items_externalUrl",
} as const;

export const storeItemsCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: "store-items",
  singularName: "store item",
  pluralName: "store items",
  fields: [
    {
      id: STORE_ITEMS_FIELD_IDS.title,
      key: "title",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: STORE_ITEMS_FIELD_IDS.image,
      key: "image",
      type: "image",
      required: true,
      systemLocked: true,
    },
    {
      id: STORE_ITEMS_FIELD_IDS.kind,
      key: "kind",
      type: "select",
      required: true,
      options: selectOptionsFrom(STORE_ITEM_KINDS, STORE_ITEM_KIND_LABELS),
    },
    {
      id: STORE_ITEMS_FIELD_IDS.price,
      key: "price",
      type: "number",
      required: true,
      min: 0,
    },
    {
      // Select over the common ISO 4217 codes so the public
      // renderer can format prices consistently. An artist with a
      // less-common currency extends the option set via the schema
      // editor.
      id: STORE_ITEMS_FIELD_IDS.currency,
      key: "currency",
      type: "select",
      required: true,
      options: selectOptionsFrom(STORE_CURRENCIES, STORE_CURRENCY_LABELS),
    },
    {
      id: STORE_ITEMS_FIELD_IDS.description,
      key: "description",
      type: "longText",
      required: false,
    },
    {
      // The artist's storefront link (Bandcamp / Shopify / etc).
      // Store items don't have their own detail pages — the public
      // render is "image + title + price linking out."
      id: STORE_ITEMS_FIELD_IDS.externalUrl,
      key: "externalUrl",
      type: "url",
      required: true,
      systemLocked: true,
    },
  ],
  slugSourceFieldId: STORE_ITEMS_FIELD_IDS.title,
  // No detail pages. The buy flow is external — `externalUrl` is the
  // canonical destination for each item.
  detailUrlPrefix: null,
  defaultSort: { mode: "manual" },
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

// ---------------------------------------------------------------------------
// Photos collection — image gallery (ADR-009 PR 8)
// ---------------------------------------------------------------------------

export const photosCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: PHOTOS_COLLECTION_SLUG,
  singularName: "photo",
  pluralName: "photos",
  fields: [
    {
      id: PHOTOS_FIELD_IDS.image,
      key: "image",
      type: "image",
      required: true,
      systemLocked: true,
    },
    {
      id: PHOTOS_FIELD_IDS.caption,
      key: "caption",
      type: "longText",
      required: false,
    },
    {
      id: PHOTOS_FIELD_IDS.takenAt,
      key: "takenAt",
      type: "date",
      required: false,
    },
    {
      id: PHOTOS_FIELD_IDS.credit,
      key: "credit",
      type: "text",
      required: false,
    },
  ],
  // Caption is the natural label, but it's optional and longText —
  // hard to slugify cleanly, and the Zod superRefine rejects
  // pointing slugSourceFieldId at an `image`-type field. Stays null
  // on the def; the new-item flow's `suggestSlug` special-cases
  // photos and derives a slug from the uploaded image's
  // `contentSlug` (plus a short id-hash suffix to disambiguate
  // multiple photos under the same bucket), falling back to
  // `photo-<YYYY-MM-DD>` before the upload lands. See
  // `./suggest-slug.ts`.
  slugSourceFieldId: null,
  detailUrlPrefix: null,
  defaultSort: { mode: "manual" },
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

// ---------------------------------------------------------------------------
// Videos collection — video gallery (ADR-009 PR 8)
// ---------------------------------------------------------------------------

const VIDEO_SOURCES = ["youtube", "vimeo", "upload"] as const;
const VIDEO_SOURCE_LABELS: Record<(typeof VIDEO_SOURCES)[number], string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  upload: "Self-hosted",
};

export const VIDEOS_FIELD_IDS = {
  title: "fld_videos_title",
  source: "fld_videos_source",
  embedUrl: "fld_videos_embedUrl",
  thumbnail: "fld_videos_thumbnail",
  description: "fld_videos_description",
  publishedAt: "fld_videos_publishedAt",
} as const;

export const videosCollectionDef: CollectionDef = {
  schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
  slug: "videos",
  singularName: "video",
  pluralName: "videos",
  fields: [
    {
      id: VIDEOS_FIELD_IDS.title,
      key: "title",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: VIDEOS_FIELD_IDS.source,
      key: "source",
      type: "select",
      required: true,
      options: selectOptionsFrom(VIDEO_SOURCES, VIDEO_SOURCE_LABELS),
    },
    {
      // Polymorphic with `source`: a full URL when source is youtube /
      // vimeo, a `/uploads/...` path under public/ when source is
      // upload. Typed as `text` rather than `url` because the v1 `url`
      // schema (`z.string().url()`) rejects path-only values, so the
      // upload variant couldn't otherwise round-trip through the item
      // API. The Puck block reading this dispatches embed-vs-file
      // rendering off `source`.
      id: VIDEOS_FIELD_IDS.embedUrl,
      key: "embedUrl",
      type: "text",
      required: true,
      systemLocked: true,
    },
    {
      id: VIDEOS_FIELD_IDS.thumbnail,
      key: "thumbnail",
      type: "image",
      required: false,
    },
    {
      id: VIDEOS_FIELD_IDS.description,
      key: "description",
      type: "longText",
      required: false,
    },
    {
      // Optional. Items without a publishedAt sort to the end per
      // the `defaultSort` below — same pattern as
      // `releases.releaseDate`. The artist can author videos
      // without setting a date yet; once set, they bubble to the
      // top.
      id: VIDEOS_FIELD_IDS.publishedAt,
      key: "publishedAt",
      type: "date",
      required: false,
    },
  ],
  slugSourceFieldId: VIDEOS_FIELD_IDS.title,
  // Videos render inline in Collection blocks — no per-video URL.
  // Artists who want a "music videos" page place a `VideosView`
  // block on a regular Page.
  detailUrlPrefix: null,
  defaultSort: {
    mode: "fieldSort",
    fieldId: VIDEOS_FIELD_IDS.publishedAt,
    direction: "desc",
  },
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
};

// ---------------------------------------------------------------------------
// Combined registry — what content.ts wraps and what PR 3's migration
// helper writes to disk.
// ---------------------------------------------------------------------------

export const PREBAKED_COLLECTIONS: Readonly<Record<string, CollectionDef>> = Object.freeze({
  pages: pagesCollectionDef,
  site: siteCollectionDef,
  header: headerCollectionDef,
  appearance: appearanceCollectionDef,
  "tour-dates": tourDatesCollectionDef,
  releases: releasesCollectionDef,
  posts: postsCollectionDef,
  "store-items": storeItemsCollectionDef,
  photos: photosCollectionDef,
  videos: videosCollectionDef,
});
