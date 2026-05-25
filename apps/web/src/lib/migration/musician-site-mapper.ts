/**
 * Migration content mapper — musician-site (Next.js + Puck, unified-collection
 * model per ADR-009).
 *
 * Converts crawled site content into OVERLAY files for the musician-site
 * template that migrate-site pushes on top of the template copy:
 *   - src/content/collections/site/items/_singleton.json  (identity + contact)
 *   - src/content/collections/pages/items/{home,music,about,contact}.json
 *   - src/content/collections/pages/items/_order.json
 *
 * Page bodies use a minimal, render-safe block set (Section > Heading +
 * RichText) whose shapes mirror the template seeds exactly; the artist
 * refines layout in the Puck editor at /admin. The item/field/block shapes
 * are pinned by musician-site-mapper.test.ts and are validated against the
 * template's Zod schema on read
 * (templates/musician-site/src/lib/collections/schema.ts) — only
 * `fld_pages_title` / `fld_site_{artistName,siteTitle,contactEmail}` are
 * strictly required, but we emit the full seed field set.
 *
 * NOTE: `RichText` uses prop `align` (not `textAlign`); `Heading`/`Section`
 * use `textAlign`. The page `_order.json` and the four seeded slugs are kept
 * in sync so no template demo content survives the overlay.
 */

import type { ExtractedSite, ExtractedPage } from "./crawler";

export interface MappedFile {
  path: string;
  content: string;
  /** 0.0–1.0 confidence that this content is accurate and complete */
  confidence: number;
  /** Source URL the content was drawn from, empty if synthesised */
  sourceUrl: string;
}

export interface MappedContent {
  files: MappedFile[];
  /** Detected social links (label → url), excluding mailto: */
  detectedSocialLinks: Record<string, string>;
}

type PageRole = "home" | "about" | "music" | "contact";

/** The pages the musician-site template seeds, in nav order (_order.json). */
const PAGE_ORDER: PageRole[] = ["home", "music", "about", "contact"];

/** Path prefix for page item files (also used by the report builder). */
export const PAGE_ITEM_PREFIX = "src/content/collections/pages/items/";

const ROLE_TITLE: Record<PageRole, string> = {
  home: "Home",
  about: "About",
  music: "Music",
  contact: "Contact",
};

const ROLE_KEYWORDS: Record<PageRole, string[]> = {
  home: ["home", "index", "main", "start", "welcome"],
  about: ["about", "bio", "biography", "story", "who", "artist", "band"],
  music: ["music", "album", "releases", "discography", "listen", "songs", "tracks", "singles"],
  contact: ["contact", "booking", "hire", "reach", "email", "message"],
};

function scorePageForRole(page: ExtractedPage, role: PageRole): number {
  const combined = `${page.url} ${page.title} ${page.headings.join(" ")}`.toLowerCase();
  let score = 0;
  for (const kw of ROLE_KEYWORDS[role]) if (combined.includes(kw)) score++;
  return score;
}

function pickPageForRole(pages: ExtractedPage[], role: PageRole): ExtractedPage | null {
  if (role === "home") {
    const root = pages.find((p) => {
      try {
        const path = new URL(p.url).pathname;
        return path === "/" || path === "" || path === "/index.html";
      } catch {
        return false;
      }
    });
    return root ?? pages[0] ?? null;
  }
  const scored = pages
    .map((p) => ({ page: p, score: scorePageForRole(p, role) }))
    .sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score > 0 ? scored[0].page : null;
}

// ─── field-value + Puck-block helpers (shapes mirror the template seeds) ───────

const textField = (value: string) => ({ type: "text" as const, value });
const longTextField = (value: string) => ({ type: "longText" as const, value });
const emailField = (value: string) => ({ type: "email" as const, value });
const boolField = (value: boolean) => ({ type: "boolean" as const, value });

function pageBodyValue(slug: string, heading: string, body: string) {
  return {
    content: [
      {
        type: "Section",
        props: {
          id: `${slug}-section`,
          width: "lg",
          textAlign: "start",
          variant: "plain",
          children: [
            { type: "Heading", props: { id: `${slug}-heading`, text: heading, level: "h1", textAlign: "start" } },
            { type: "RichText", props: { id: `${slug}-richtext`, text: body, align: "start" } },
          ],
        },
      },
    ],
    root: { props: {} },
  };
}

// ─── main ──────────────────────────────────────────────────────────────────────

/**
 * Map an `ExtractedSite` into musician-site overlay files.
 * Returns a `MappedContent` ready to overlay on the template copy.
 */
export function mapToMusicianSite(extracted: ExtractedSite, artistName: string): MappedContent {
  const now = new Date().toISOString();
  const files: MappedFile[] = [];

  // Site singleton — identity + contact. contactEmail must be a valid email
  // (the template's Zod schema enforces z.string().email()), so fall back to a
  // domain-based address rather than an empty string when none is crawled.
  const mailto = extracted.socialLinks.find((l) => l.href.startsWith("mailto:"));
  const contactEmail = mailto ? mailto.href.replace("mailto:", "") : `contact@${extracted.domain}`;
  const siteDescription = extracted.pages[0]?.description || `Official website of ${artistName}.`;

  files.push({
    path: "src/content/collections/site/items/_singleton.json",
    content:
      JSON.stringify(
        {
          id: "item_migrated_site",
          createdAt: now,
          updatedAt: now,
          values: {
            fld_site_artistName: textField(artistName),
            fld_site_siteTitle: textField(`${artistName} — Official Website`),
            fld_site_siteDescription: longTextField(siteDescription),
            fld_site_contactEmail: emailField(contactEmail),
            fld_site_copyrightName: textField(artistName),
            fld_site_isFooterHidden: boolField(false),
            fld_site_hasCompletedFirstRun: boolField(true),
          },
        },
        null,
        2,
      ) + "\n",
    confidence: 0.85,
    sourceUrl: extracted.rootUrl,
  });

  // Page items — overlay every seeded page so no template demo content ships.
  for (const role of PAGE_ORDER) {
    const page = pickPageForRole(extracted.pages, role);
    const heading = page?.headings[0]?.trim() || ROLE_TITLE[role];
    const body =
      page && page.paragraphs.length > 0
        ? page.paragraphs.join("\n\n")
        : `This is your ${ROLE_TITLE[role]} page. Edit it in the visual editor.`;
    const confidence = page ? (page.paragraphs.length > 2 ? 0.8 : 0.5) : 0.3;

    files.push({
      path: `${PAGE_ITEM_PREFIX}${role}.json`,
      content:
        JSON.stringify(
          {
            id: `item_migrated_${role}`,
            createdAt: now,
            updatedAt: now,
            values: {
              fld_pages_title: textField(ROLE_TITLE[role]),
              fld_pages_isSplashPage: boolField(false),
              fld_pages_isFooterHidden: boolField(false),
              fld_pages_showInNav: boolField(true),
              fld_pages_body: { type: "puckContent" as const, value: pageBodyValue(role, heading, body) },
            },
          },
          null,
          2,
        ) + "\n",
      confidence,
      sourceUrl: page?.url ?? "",
    });
  }

  // Pages order — matches the seeded set/order.
  files.push({
    path: `${PAGE_ITEM_PREFIX}_order.json`,
    content: JSON.stringify(PAGE_ORDER, null, 2) + "\n",
    confidence: 1,
    sourceUrl: "",
  });

  const detectedSocialLinks: Record<string, string> = {};
  for (const link of extracted.socialLinks) {
    if (!link.href.startsWith("mailto:")) detectedSocialLinks[link.text] = link.href;
  }

  return { files, detectedSocialLinks };
}
