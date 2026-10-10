/**
 * Migration report generator — v1
 *
 * Produces a human-readable migration report from the extraction and mapping
 * results. The report is stored in SiteJob.resultPayload and surfaced in the UI.
 */

import { capitalise } from "@stagecraft/shared";
import type { ExtractedSite } from "./crawler";
import { PAGE_ITEM_PREFIX, type MappedContent, type MappedFile } from "./musician-site-mapper";

/** A page item file (excludes the pages `_order.json`). */
const isPageItem = (path: string) => path.startsWith(PAGE_ITEM_PREFIX) && !path.endsWith("_order.json");
const pageSlug = (path: string) => path.slice(PAGE_ITEM_PREFIX.length).replace(/\.json$/, "");

export interface MigrationReportItem {
  label: string;
  status: "imported" | "partial" | "skipped" | "manual_review";
  detail: string;
}

export interface MigrationReport {
  /** Short summary lines shown at the top of the report */
  summary: string[];
  /** Overall confidence score 0.0–1.0 */
  overallConfidence: number;
  /** Items that were successfully imported */
  importedItems: MigrationReportItem[];
  /** Items that need the user to review or complete manually */
  manualReviewItems: MigrationReportItem[];
  /** Items that could not be imported at all */
  skippedItems: MigrationReportItem[];
  /** Total pages crawled */
  pagesCrawled: number;
  /** Total pages mapped to template pages */
  pagesMapped: number;
  /** Total images found (references only — actual download not in v1) */
  imagesFound: number;
  /** Total embeds found */
  embedsFound: number;
  /** Social links detected */
  socialLinksFound: number;
}

// ─── Confidence helpers ───────────────────────────────────────────────────────

function averageConfidence(files: MappedFile[]): number {
  if (files.length === 0) return 0;
  return files.reduce((sum, f) => sum + f.confidence, 0) / files.length;
}

// ─── Report builders ──────────────────────────────────────────────────────────

function buildImportedItems(
  extracted: ExtractedSite,
  mapped: MappedContent
): MigrationReportItem[] {
  const items: MigrationReportItem[] = [];

  const pageFiles = mapped.files.filter((f) => isPageItem(f.path));
  for (const file of pageFiles) {
    const pageName = pageSlug(file.path);
    items.push({
      label: `${capitalise(pageName)} page`,
      status: file.confidence >= 0.7 ? "imported" : "partial",
      detail: file.sourceUrl
        ? `Content imported from ${file.sourceUrl}`
        : "Content synthesised from site title",
    });
  }

  if (extracted.socialLinks.filter((l) => !l.href.startsWith("mailto:")).length > 0) {
    const platforms = extracted.socialLinks
      .filter((l) => !l.href.startsWith("mailto:"))
      .map((l) => l.text)
      .join(", ");
    items.push({
      label: "Social links",
      status: "imported",
      detail: `Detected: ${platforms}`,
    });
  }

  const emailLink = extracted.socialLinks.find((l) => l.href.startsWith("mailto:"));
  if (emailLink) {
    items.push({
      label: "Contact email",
      status: "imported",
      detail: emailLink.href.replace("mailto:", ""),
    });
  }

  return items;
}

function buildManualReviewItems(
  extracted: ExtractedSite,
  mapped: MappedContent
): MigrationReportItem[] {
  const items: MigrationReportItem[] = [];

  // Images — referenced but not downloaded in v1
  const totalImages = extracted.pages.reduce((sum, p) => sum + p.images.length, 0);
  if (totalImages > 0) {
    items.push({
      label: "Images",
      status: "manual_review",
      detail: `${totalImages} image reference${totalImages === 1 ? "" : "s"} found. Images are not downloaded automatically — add your photos in your site's admin (/admin), using the image fields on each page or item.`,
    });
  }

  // Embeds
  const totalEmbeds = extracted.pages.reduce((sum, p) => sum + p.embeds.length, 0);
  if (totalEmbeds > 0) {
    const types = [
      ...new Set(extracted.pages.flatMap((p) => p.embeds.map((e) => e.type))),
    ].join(", ");
    items.push({
      label: "Embedded media",
      status: "manual_review",
      detail: `${totalEmbeds} embed${totalEmbeds === 1 ? "" : "s"} found (${types}). Add these via the edit request flow after reviewing the site.`,
    });
  }

  // Low-confidence pages
  const lowConfidence = mapped.files.filter(
    (f) => isPageItem(f.path) && f.confidence < 0.7
  );
  for (const file of lowConfidence) {
    const pageName = pageSlug(file.path);
    items.push({
      label: `${capitalise(pageName)} page content`,
      status: "partial",
      detail: "Limited content was extracted. Review and expand this page using the edit request flow.",
    });
  }

  // Theme/design
  items.push({
    label: "Design & theme",
    status: "manual_review",
    detail: "Colors, fonts, and layout are set to the template defaults. Customise using the edit request flow.",
  });

  return items;
}

function buildSkippedItems(extracted: ExtractedSite): MigrationReportItem[] {
  const items: MigrationReportItem[] = [];

  // Pages we couldn't map to a known role
  const KNOWN_PATHS = ["/", "/about", "/music", "/press", "/contact", "/tour"];
  const unmapped = extracted.pages.filter((p) => {
    try {
      const path = new URL(p.url).pathname;
      return !KNOWN_PATHS.some((kp) => path === kp || path.startsWith(kp + "/"));
    } catch {
      return false;
    }
  });

  for (const page of unmapped.slice(0, 5)) {
    items.push({
      label: `Unmapped page: ${page.title || page.url}`,
      status: "skipped",
      detail: `${page.url} — no matching template page. Add content manually via the edit request flow.`,
    });
  }

  return items;
}

function buildSummary(
  extracted: ExtractedSite,
  mapped: MappedContent,
  artistName: string
): string[] {
  const lines: string[] = [];
  const pageCount = mapped.files.filter((f) => isPageItem(f.path)).length;
  const imageCount = extracted.pages.reduce((sum, p) => sum + p.images.length, 0);
  const embedCount = extracted.pages.reduce((sum, p) => sum + p.embeds.length, 0);
  const socialCount = extracted.socialLinks.filter((l) => !l.href.startsWith("mailto:")).length;

  lines.push(`Migrated "${artistName}" from ${extracted.rootUrl}`);
  lines.push(`Crawled ${extracted.pages.length} page${extracted.pages.length === 1 ? "" : "s"}, mapped ${pageCount} to template`);

  if (imageCount > 0) {
    lines.push(`Found ${imageCount} image${imageCount === 1 ? "" : "s"} — add photos in your site's admin (/admin) via the image fields`);
  }
  if (embedCount > 0) {
    lines.push(`Found ${embedCount} media embed${embedCount === 1 ? "" : "s"} (YouTube, Spotify, etc.) — add via edit request`);
  }
  if (socialCount > 0) {
    lines.push(`Detected ${socialCount} social link${socialCount === 1 ? "" : "s"} and imported into site config`);
  }

  return lines;
}

// ─── Main report builder ──────────────────────────────────────────────────────

export function buildMigrationReport(
  extracted: ExtractedSite,
  mapped: MappedContent,
  artistName: string
): MigrationReport {
  const importedItems = buildImportedItems(extracted, mapped);
  const manualReviewItems = buildManualReviewItems(extracted, mapped);
  const skippedItems = buildSkippedItems(extracted);

  const pageFiles = mapped.files.filter((f) => isPageItem(f.path));
  const overallConfidence = Math.round(averageConfidence(pageFiles) * 100) / 100;

  return {
    summary: buildSummary(extracted, mapped, artistName),
    overallConfidence,
    importedItems,
    manualReviewItems,
    skippedItems,
    pagesCrawled: extracted.pages.length,
    pagesMapped: pageFiles.length,
    imagesFound: extracted.pages.reduce((sum, p) => sum + p.images.length, 0),
    embedsFound: extracted.pages.reduce((sum, p) => sum + p.embeds.length, 0),
    socialLinksFound: extracted.socialLinks.filter((l) => !l.href.startsWith("mailto:")).length,
  };
}
