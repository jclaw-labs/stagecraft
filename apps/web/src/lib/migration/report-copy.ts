/**
 * Migration report shape and the copy it shares with the site page.
 *
 * Kept free of crawler/mapper imports so the client-side site page can use
 * it: the page renders reports stored in SiteJob.resultPayload.report, and
 * upgrades older stored copy at render time (see upgradeStoredReport).
 */

import { pluralise } from "@stagecraft/shared";

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
export const EMBEDS_ITEM_LABEL = "Embedded media";
export const DESIGN_ITEM_LABEL = "Design & theme";

/** Button text for each report action. */
export const MIGRATION_REPORT_ACTION_LABELS: Record<MigrationReportAction, string> = {
  open_site_admin: "Open site admin",
};

export function imagesItemDetail(count: number): string {
  return `${pluralise(count, "image reference")} found. Images are not downloaded automatically — add your photos in your site's admin, using the image fields on each page or item.`;
}

export function imagesSummaryLine(count: number): string {
  return `Found ${pluralise(count, "image")} — add photos in your site's admin via the image fields`;
}

/** `types` is the comma-separated list of embed types found, e.g. "youtube, spotify". */
export function embedsItemDetail(count: number, types: string): string {
  return `${pluralise(count, "embed")} found (${types}). After reviewing the site, add these in your site's admin with an Embed block on the page.`;
}

export function embedsSummaryLine(count: number): string {
  return `Found ${pluralise(count, "media embed")} (YouTube, Spotify, etc.) — add in your site's admin with an Embed block`;
}

/** Label of the item for a page mapped with low confidence; `pageName` is already capitalised. */
export function pageContentItemLabel(pageName: string): string {
  return `${pageName} page content`;
}

export const PAGE_CONTENT_ITEM_DETAIL =
  "Limited content was extracted. Review and expand this page in your site's admin.";

export const DESIGN_ITEM_DETAIL =
  "Colors, fonts, and layout are set to the template defaults. Customise them in your site's admin: colors and fonts under Appearance, layout in each page's editor.";

export function unmappedPageItemLabel(titleOrUrl: string): string {
  return `Unmapped page: ${titleOrUrl}`;
}

export function unmappedPageItemDetail(url: string): string {
  return `${url} — no matching template page. Add it as a new page in your site's admin.`;
}

// ─── Upgrading stored reports ─────────────────────────────────────────────────

/**
 * One piece of report copy and every older wording it has been stored with.
 * The current wording is always stored with its `action`, so it needs no
 * upgrade. `current` rebuilds the copy from the old wording's captures (a
 * count, the embed types, a page URL), so stored values are preserved.
 */
interface CopyUpgrade {
  /** The item label the entry applies to; a pattern for per-page items. */
  label: string | RegExp;
  patterns: RegExp[];
  current: (match: RegExpExecArray) => string;
}

/**
 * Older wordings: images from before #414 (the removed asset manager) and
 * from #414 (an `/admin` path printed in the sentence); the rest from before
 * #455, which pointed at the edit request flow removed in #435.
 */
const ITEM_UPGRADES: CopyUpgrade[] = [
  {
    label: IMAGES_ITEM_LABEL,
    patterns: [
      /^(\d+) image references? found\. Images are not automatically downloaded — please upload your photos via the asset manager\.$/,
      /^(\d+) image references? found\. Images are not downloaded automatically — add your photos in your site's admin \(\/admin\), using the image fields on each page or item\.$/,
    ],
    current: (m) => imagesItemDetail(Number(m[1])),
  },
  {
    label: EMBEDS_ITEM_LABEL,
    patterns: [/^(\d+) embeds? found \((.*)\)\. Add these via the edit request flow after reviewing the site\.$/],
    current: (m) => embedsItemDetail(Number(m[1]), m[2]),
  },
  {
    label: /^.+ page content$/,
    patterns: [/^Limited content was extracted\. Review and expand this page using the edit request flow\.$/],
    current: () => PAGE_CONTENT_ITEM_DETAIL,
  },
  {
    label: DESIGN_ITEM_LABEL,
    patterns: [/^Colors, fonts, and layout are set to the template defaults\. Customise using the edit request flow\.$/],
    current: () => DESIGN_ITEM_DETAIL,
  },
  {
    label: /^Unmapped page: /,
    patterns: [/^(.*) — no matching template page\. Add content manually via the edit request flow\.$/],
    current: (m) => unmappedPageItemDetail(m[1]),
  },
];

const SUMMARY_UPGRADES: Omit<CopyUpgrade, "label">[] = [
  {
    patterns: [
      /^Found (\d+) images? — upload via asset manager to add to your site$/,
      /^Found (\d+) images? — add photos in your site's admin \(\/admin\) via the image fields$/,
    ],
    current: (m) => imagesSummaryLine(Number(m[1])),
  },
  {
    patterns: [/^Found (\d+) media embeds? \(YouTube, Spotify, etc\.\) — add via edit request$/],
    current: (m) => embedsSummaryLine(Number(m[1])),
  },
];

/** The current wording for `text`, or null when it matches no older wording. */
function upgradeText(text: string, upgrades: Omit<CopyUpgrade, "label">[]): string | null {
  for (const upgrade of upgrades) {
    for (const pattern of upgrade.patterns) {
      const match = pattern.exec(text);
      if (match) return upgrade.current(match);
    }
  }
  return null;
}

const labelMatches = (label: string, matcher: string | RegExp) =>
  typeof matcher === "string" ? label === matcher : matcher.test(label);

function upgradeItem(item: MigrationReportItem): MigrationReportItem {
  const upgrades = ITEM_UPGRADES.filter((u) => labelMatches(item.label, u.label));
  const detail = upgradeText(item.detail, upgrades);
  return detail === null ? item : { ...item, detail, action: "open_site_admin" };
}

/**
 * Rewrites superseded copy in a stored report to the current wording and
 * attaches the site-admin link. Reports are built once at job time, so older
 * ones still point at the removed asset manager (#427) or the removed edit
 * request flow (#455). Text that doesn't match a known wording is left as it is.
 */
export function upgradeStoredReport(report: MigrationReport): MigrationReport {
  return {
    ...report,
    summary: report.summary.map((line) => upgradeText(line, SUMMARY_UPGRADES) ?? line),
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

/**
 * The site page's deploy flags as a serving state. The link follows the
 * Production URL row: live once the latest deploy is ready, or during the
 * first status check, when a freshly active site is presumed up.
 */
export function siteServingState(flags: {
  isReady: boolean;
  isCheckingStatus: boolean;
  isCreating: boolean;
  isBuilding: boolean;
}): SiteServingState {
  if (flags.isReady || flags.isCheckingStatus) return "live";
  if (flags.isCreating || flags.isBuilding) return "building";
  return "not_live";
}

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
