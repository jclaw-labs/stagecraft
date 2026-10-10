/**
 * Migration report shape and the copy it shares with the site page.
 *
 * Kept free of crawler/mapper imports so the client-side site page can use
 * it: the page renders reports stored in SiteJob.resultPayload.report, and
 * upgrades older stored copy at render time (see upgradeStoredReport).
 */

/**
 * A link the site page attaches to a report item. The report is built at job
 * time and doesn't know where the site is hosted, so it names the destination
 * and the page builds the URL from the site's production URL.
 */
export type MigrationReportAction = "open_site_admin";

export interface MigrationReportItem {
  label: string;
  status: "imported" | "partial" | "skipped" | "manual_review";
  detail: string;
  action?: MigrationReportAction;
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

export const IMAGES_ITEM_LABEL = "Images";

/** Button text for each report action. */
export const MIGRATION_REPORT_ACTION_LABELS: Record<MigrationReportAction, string> = {
  open_site_admin: "Open site admin",
};

export function imagesItemDetail(count: number): string {
  return `${count} image reference${count === 1 ? "" : "s"} found. Images are not downloaded automatically — add your photos in your site's admin, using the image fields on each page or item.`;
}

export function imagesSummaryLine(count: number): string {
  return `Found ${count} image${count === 1 ? "" : "s"} — add photos in your site's admin via the image fields`;
}

/**
 * Every older wording the images item and summary line have been stored with:
 * from before #414 (the removed asset manager), and from #414 (an `/admin`
 * path printed in the sentence). The current wording is always stored with
 * its `action`, so it needs no upgrade.
 */
const IMAGES_DETAIL_PATTERNS = [
  /^(\d+) image references? found\. Images are not automatically downloaded — please upload your photos via the asset manager\.$/,
  /^(\d+) image references? found\. Images are not downloaded automatically — add your photos in your site's admin \(\/admin\), using the image fields on each page or item\.$/,
];

const IMAGES_SUMMARY_PATTERNS = [
  /^Found (\d+) images? — upload via asset manager to add to your site$/,
  /^Found (\d+) images? — add photos in your site's admin \(\/admin\) via the image fields$/,
];

function matchCount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

function upgradeItem(item: MigrationReportItem): MigrationReportItem {
  if (item.label !== IMAGES_ITEM_LABEL) return item;
  const count = matchCount(item.detail, IMAGES_DETAIL_PATTERNS);
  if (count === null) return item;
  return { ...item, detail: imagesItemDetail(count), action: "open_site_admin" };
}

/**
 * Rewrites the images copy of a stored report to the current wording and
 * attaches the site-admin link. Reports are built once at job time, so ones
 * stored before #414 still point at the removed asset manager. Text that
 * doesn't match a known wording is left as it is.
 */
export function upgradeStoredReport(report: MigrationReport): MigrationReport {
  return {
    ...report,
    summary: report.summary.map((line) => {
      const count = matchCount(line, IMAGES_SUMMARY_PATTERNS);
      return count === null ? line : imagesSummaryLine(count);
    }),
    importedItems: report.importedItems.map(upgradeItem),
    manualReviewItems: report.manualReviewItems.map(upgradeItem),
    skippedItems: report.skippedItems.map(upgradeItem),
  };
}

/** The admin of the artist's own site, or null without a usable production URL. */
export function siteAdminUrl(productionUrl: string | null | undefined): string | null {
  if (!productionUrl) return null;
  try {
    const url = new URL("/admin", productionUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Whether the site is serving, as far as the site page knows: `live` once the
 * latest deploy is ready, `building` while the site is being created or a
 * deploy is in flight, and `not_live` otherwise (a failed deploy, an unknown
 * deploy state, or a site that isn't active).
 */
export type SiteServingState = "live" | "building" | "not_live";

/** The report's site-admin link for a site: the URL, or why it's held back. */
export type SiteAdminLink = { state: "live"; href: string } | { state: "hidden"; hint: string };

/**
 * The site-admin link for a report, given the site's production URL and
 * whether the site is serving. Until it is, the admin doesn't load, so the
 * page says when the link will appear instead.
 */
export function siteAdminLink(
  productionUrl: string | null | undefined,
  serving: SiteServingState,
): SiteAdminLink {
  const href = siteAdminUrl(productionUrl);
  if (!href) {
    return { state: "hidden", hint: "The link to your site admin appears once your site has a production URL." };
  }
  if (serving === "live") return { state: "live", href };
  return {
    state: "hidden",
    hint:
      serving === "building"
        ? "The link to your site admin appears once your site finishes building."
        : "The link to your site admin appears once your site is live.",
  };
}
