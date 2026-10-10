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
import { isVectorExt } from "@/lib/image-types";
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
 * `<item title> — <artist name>` as the document title; the item's
 * summary or description as the meta description, falling back to the
 * site description; the cover as `og:image` when there is one.
 *
 * Vector covers (SVG, ICO) get no `og:image`: link-preview scrapers
 * don't render them. Raster covers use the largest webp variant rather
 * than the original, which can run to the 25 MB upload limit and past
 * what the scrapers will fetch.
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
  if (cover && !isVectorExt(cover.originalExt)) {
    metadata.openGraph = { images: [{ url: largestVariantUrl(cover), alt: cover.alt }] };
  }
  return metadata;
}

function itemSummary(def: CollectionDef, item: Item): string | null {
  for (const key of SUMMARY_FIELD_KEYS) {
    const field = def.fields.find((f) => f.key === key);
    const value = field ? item.values[field.id] : undefined;
    if ((value?.type === "text" || value?.type === "longText") && value.value.trim()) {
      return value.value.trim();
    }
  }
  return null;
}
