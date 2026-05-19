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
  type FieldId,
  type SelectOption,
} from "./schema";

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
  type ColorField,
  type SocialPlatform,
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

export const PAGES_FIELD_IDS = {
  title: "fld_pages_title",
  isSplashPage: "fld_pages_isSplashPage",
  isFooterHidden: "fld_pages_isFooterHidden",
  showInNav: "fld_pages_showInNav",
  body: "fld_pages_body",
} as const;

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

const socialFieldId = (platform: SocialPlatform): FieldId =>
  `fld_site_social_${platform}`;

export const SITE_FIELD_IDS = {
  artistName: "fld_site_artistName",
  siteTitle: "fld_site_siteTitle",
  siteDescription: "fld_site_siteDescription",
  contactEmail: "fld_site_contactEmail",
  copyrightName: "fld_site_copyrightName",
  isFooterHidden: "fld_site_isFooterHidden",
  social: (platform: SocialPlatform) => socialFieldId(platform),
} as const;

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
    // One field per social platform — flatter than the legacy
    // `socialLinks: Record<...>` shape but means the schema editor can
    // treat each as an independent slot.
    ...SOCIAL_PLATFORMS.map((platform) => ({
      id: socialFieldId(platform),
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

export const HEADER_FIELD_IDS = {
  wordmark: "fld_header_wordmark",
  wordmarkSizeAdjust: "fld_header_wordmarkSizeAdjust",
  headerMode: "fld_header_headerMode",
  headerForegroundColor: "fld_header_headerForegroundColor",
  isHeaderTextUppercase: "fld_header_isHeaderTextUppercase",
  headerSubtitle: "fld_header_headerSubtitle",
  headerLayout: "fld_header_headerLayout",
} as const;

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

const colorFieldId = (color: ColorField): FieldId => `fld_appearance_color_${color}`;

export const APPEARANCE_FIELD_IDS = {
  color: (color: ColorField) => colorFieldId(color),
  bodyFont: "fld_appearance_bodyFont",
  headingMode: "fld_appearance_headingMode",
  headingFont: "fld_appearance_headingFont",
  bodyWeight_body: "fld_appearance_bodyWeight_body",
  bodyWeight_bodyBold: "fld_appearance_bodyWeight_bodyBold",
  headingWeight_h1: "fld_appearance_headingWeight_h1",
  headingWeight_h2: "fld_appearance_headingWeight_h2",
  headingWeight_h3: "fld_appearance_headingWeight_h3",
} as const;

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
      id: colorFieldId(color),
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
// Combined registry — what content.ts wraps and what PR 3's migration
// helper writes to disk.
// ---------------------------------------------------------------------------

export const PREBAKED_COLLECTIONS: Readonly<Record<string, CollectionDef>> = Object.freeze({
  pages: pagesCollectionDef,
  site: siteCollectionDef,
  header: headerCollectionDef,
  appearance: appearanceCollectionDef,
  "tour-dates": tourDatesCollectionDef,
});
