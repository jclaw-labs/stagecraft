/**
 * Head metadata for a collection item's detail page (`/news/<slug>`,
 * `/releases/<slug>`, `/shows/<slug>`, and any artist-created
 * collection with a `detailUrlPrefix`).
 *
 * Title and cover come from `itemDetailSections`, so the tab title and
 * the share image match the heading and cover the default detail layout
 * shows.
 */

import type { Metadata } from "next";

import { largestVariantUrl } from "@/lib/image-urls";
import { IMAGE_VARIANT_WIDTHS, isVectorExt } from "@/lib/image-types";
import type { SiteConfig } from "@/lib/site-config-types";

import type { CollectionDef, Item } from "../schema";
import { itemDetailSections } from "./item-detail";

/**
 * Field keys whose value reads as a one-paragraph summary of the item,
 * in order of preference: posts carry `summary`; releases, store items
 * and videos carry `description`.
 */
const SUMMARY_FIELD_KEYS = ["summary", "description"] as const;

/**
 * Longest meta description, in characters, before it is cut at a word
 * boundary. Search results show about this much; link previews show
 * more, but cut mid-word where they stop.
 */
export const META_DESCRIPTION_MAX_LENGTH = 160;

/**
 * `<item title> — <artist name>` as the document title; the item's
 * summary or description as the meta description, falling back to the
 * site description; the cover as `og:image` when there is one.
 *
 * The summary has its whitespace collapsed and is cut to
 * `META_DESCRIPTION_MAX_LENGTH`: release descriptions run to several
 * paragraphs.
 *
 * Raster covers use the largest webp variant rather than the original,
 * which can run to the 25 MB upload limit and past what the scrapers
 * will fetch. A cover with no variant gets no `og:image`: that is a
 * vector (SVG, ICO) or a raster narrower than the smallest variant,
 * whose original may be AVIF, and link-preview scrapers render neither
 * reliably.
 */
export function itemDetailMetadata(
  def: CollectionDef,
  item: Item,
  site: Pick<SiteConfig, "artistName" | "siteDescription">,
): Metadata {
  const { title, cover } = itemDetailSections(def, item);
  const metadata: Metadata = {
    title: `${title} — ${site.artistName}`,
    description: itemSummary(def, item) ?? site.siteDescription,
  };
  if (cover && !isVectorExt(cover.originalExt) && cover.width >= IMAGE_VARIANT_WIDTHS[0]) {
    metadata.openGraph = { images: [{ url: largestVariantUrl(cover), alt: cover.alt }] };
  }
  return metadata;
}

function itemSummary(def: CollectionDef, item: Item): string | null {
  for (const key of SUMMARY_FIELD_KEYS) {
    const field = def.fields.find((f) => f.key === key);
    const value = field ? item.values[field.id] : undefined;
    if ((value?.type === "text" || value?.type === "longText") && value.value.trim()) {
      return metaDescription(value.value);
    }
  }
  return null;
}

/**
 * `text` on one line, cut at the last word boundary that fits in
 * `META_DESCRIPTION_MAX_LENGTH` with an ellipsis. A single word longer
 * than the limit is cut mid-word.
 */
export function metaDescription(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= META_DESCRIPTION_MAX_LENGTH) return oneLine;
  const room = oneLine.slice(0, META_DESCRIPTION_MAX_LENGTH - 1);
  // A word that ends exactly at the cut fits whole.
  const end = oneLine[room.length] === " " ? room.length : room.lastIndexOf(" ");
  const cut = end > 0 ? room.slice(0, end) : room;
  return `${cut.replace(/[\s.,;:!?—–-]+$/, "")}…`;
}
