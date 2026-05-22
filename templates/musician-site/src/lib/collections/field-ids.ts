/**
 * Stable field-id constants for the prebaked collections.
 *
 * Lives in its own file (not in `seeds.ts`) so client components can
 * import the IDs without dragging `node:crypto` into the browser
 * bundle via `seeds.ts → schema.ts → randomUUID`. Same
 * client-bundling discipline as `filter-schema.ts` /
 * `field-classification.ts` / `puck-content-value.ts`.
 *
 * Field IDs are picked once at migration time (ADR-009 §13) and never
 * rename — existing artist content references them. New fields get new
 * IDs (additive only).
 *
 * `seeds.ts` re-exports these for source-compat with callers that
 * consumed them from the seeds module before the split.
 */

import type { FieldId } from "./schema";
import type { ColorField, SocialPlatform } from "../site-config-types";

const socialFieldId = (platform: SocialPlatform): FieldId =>
  `fld_site_social_${platform}`;

const colorFieldId = (color: ColorField): FieldId =>
  `fld_appearance_color_${color}`;

export const PAGES_FIELD_IDS = {
  title: "fld_pages_title",
  isSplashPage: "fld_pages_isSplashPage",
  isFooterHidden: "fld_pages_isFooterHidden",
  showInNav: "fld_pages_showInNav",
  body: "fld_pages_body",
} as const;

export const SITE_FIELD_IDS = {
  artistName: "fld_site_artistName",
  siteTitle: "fld_site_siteTitle",
  siteDescription: "fld_site_siteDescription",
  contactEmail: "fld_site_contactEmail",
  copyrightName: "fld_site_copyrightName",
  isFooterHidden: "fld_site_isFooterHidden",
  hasCompletedFirstRun: "fld_site_hasCompletedFirstRun",
  // Site-wide chrome customisation — parity with the legacy
  // template's `siteConfig.favicon` / `siteConfig.pageBackground`.
  // Both go through the standard image pipeline (sharp variants +
  // LQIP); favicons that don't need bigger variants just don't get
  // upsized (sharp skips widths > source width).
  favicon: "fld_site_favicon",
  pageBackground: "fld_site_pageBackground",
  // 0..1 black-tint opacity painted over `pageBackground` for
  // text-legibility on bright / busy backgrounds.
  pageBackgroundOverlay: "fld_site_pageBackgroundOverlay",
  social: (platform: SocialPlatform) => socialFieldId(platform),
} as const;

export const HEADER_FIELD_IDS = {
  wordmark: "fld_header_wordmark",
  wordmarkSizeAdjust: "fld_header_wordmarkSizeAdjust",
  headerMode: "fld_header_headerMode",
  headerForegroundColor: "fld_header_headerForegroundColor",
  isHeaderTextUppercase: "fld_header_isHeaderTextUppercase",
  headerSubtitle: "fld_header_headerSubtitle",
  headerLayout: "fld_header_headerLayout",
} as const;

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

export const PHOTOS_FIELD_IDS = {
  image: "fld_photos_image",
  caption: "fld_photos_caption",
  takenAt: "fld_photos_takenAt",
  credit: "fld_photos_credit",
} as const;

export const VIDEOS_FIELD_IDS = {
  title: "fld_videos_title",
  source: "fld_videos_source",
  embedUrl: "fld_videos_embedUrl",
  thumbnail: "fld_videos_thumbnail",
  description: "fld_videos_description",
  publishedAt: "fld_videos_publishedAt",
} as const;

export const TOUR_DATES_FIELD_IDS = {
  date: "fld_tour_dates_date",
  venue: "fld_tour_dates_venue",
  city: "fld_tour_dates_city",
  country: "fld_tour_dates_country",
  status: "fld_tour_dates_status",
  ticketUrl: "fld_tour_dates_ticketUrl",
  notes: "fld_tour_dates_notes",
} as const;

export const RELEASES_FIELD_IDS = {
  title: "fld_releases_title",
  coverImage: "fld_releases_coverImage",
  releaseType: "fld_releases_releaseType",
  releaseDate: "fld_releases_releaseDate",
  description: "fld_releases_description",
  body: "fld_releases_body",
} as const;

export const POSTS_FIELD_IDS = {
  title: "fld_posts_title",
  coverImage: "fld_posts_coverImage",
  publishedAt: "fld_posts_publishedAt",
  category: "fld_posts_category",
  summary: "fld_posts_summary",
  body: "fld_posts_body",
} as const;

export const STORE_ITEMS_FIELD_IDS = {
  title: "fld_store_items_title",
  image: "fld_store_items_image",
  kind: "fld_store_items_kind",
  price: "fld_store_items_price",
  currency: "fld_store_items_currency",
  description: "fld_store_items_description",
  externalUrl: "fld_store_items_externalUrl",
} as const;

/**
 * Slug of the photos collection. Carved out as a const because
 * `suggest-slug.ts` special-cases this collection, and a bare
 * string equality there would silently break if the seed slug was
 * ever renamed. Used by both `seeds.ts` and `suggest-slug.ts`.
 */
export const PHOTOS_COLLECTION_SLUG = "photos";
