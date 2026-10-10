import { describe, it, expect } from "vitest";

import { buildMigrationReport } from "../migration/report";
import type { ExtractedSite, ExtractedPage } from "../migration/crawler";
import { PAGE_ITEM_PREFIX, type MappedContent } from "../migration/musician-site-mapper";

function makePage(overrides: Partial<ExtractedPage>): ExtractedPage {
  return {
    url: "https://band.example.com/",
    title: "The Band",
    description: "",
    headings: [],
    paragraphs: [],
    images: [],
    embeds: [],
    navLinks: [],
    rawText: "",
    ...overrides,
  };
}

function makeSite(pages: ExtractedPage[]): ExtractedSite {
  return {
    rootUrl: "https://band.example.com/",
    domain: "band.example.com",
    siteTitle: "The Band",
    pages,
    socialLinks: [],
    inferredName: "The Band",
  };
}

const noFiles = { files: [], detectedSocialLinks: {} };

describe("buildMigrationReport — images", () => {
  it("points artists at the site admin and links it rather than printing a path (#410, #427)", () => {
    const site = makeSite([
      makePage({ images: [{ src: "/a.jpg", alt: "" }, { src: "/b.jpg", alt: "" }] }),
    ]);
    const report = buildMigrationReport(site, noFiles, "The Band");

    const item = report.manualReviewItems.find((i) => i.label === "Images");
    expect(item?.status).toBe("manual_review");
    expect(item?.detail).toBe(
      "2 image references found. Images are not downloaded automatically — add your photos in your site's admin, using the image fields on each page or item."
    );
    expect(item?.action).toBe("open_site_admin");
    expect(report.summary).toContain("Found 2 images — add photos in your site's admin via the image fields");
    expect(JSON.stringify(report)).not.toMatch(/asset manager|\/admin/i);
  });

  it("uses singular wording for one image", () => {
    const report = buildMigrationReport(
      makeSite([makePage({ images: [{ src: "/a.jpg", alt: "" }] })]),
      noFiles,
      "The Band"
    );
    expect(report.manualReviewItems.find((i) => i.label === "Images")?.detail).toMatch(/^1 image reference found\./);
    expect(report.summary).toContain("Found 1 image — add photos in your site's admin via the image fields");
  });

  it("omits the image item and summary line when no images were found", () => {
    const report = buildMigrationReport(makeSite([makePage({})]), noFiles, "The Band");
    expect(report.manualReviewItems.some((i) => i.label === "Images")).toBe(false);
    expect(report.summary.some((l) => l.includes("image"))).toBe(false);
    expect(report.imagesFound).toBe(0);
  });
});

describe("buildMigrationReport — site admin instead of the edit request flow (#455)", () => {
  const site = makeSite([
    makePage({
      embeds: [
        { type: "youtube", src: "https://www.youtube.com/embed/x" },
        { type: "spotify", src: "https://open.spotify.com/embed/y" },
      ],
    }),
    makePage({ url: "https://band.example.com/merch", title: "Merch" }),
  ]);
  const mapped: MappedContent = {
    files: [{ path: `${PAGE_ITEM_PREFIX}about.json`, content: "{}", confidence: 0.4, sourceUrl: "" }],
    detectedSocialLinks: {},
  };
  const report = buildMigrationReport(site, mapped, "The Band");

  it("never mentions the edit request flow", () => {
    expect(JSON.stringify(report)).not.toMatch(/edit request/i);
  });

  it("points the embeds item and summary line at the site admin", () => {
    const item = report.manualReviewItems.find((i) => i.label === "Embedded media");
    expect(item?.detail).toBe(
      "2 embeds found (youtube, spotify). After reviewing the site, add these in your site's admin with an Embed block on the page."
    );
    expect(item?.action).toBe("open_site_admin");
    expect(report.summary).toContain(
      "Found 2 media embeds (YouTube, Spotify, etc.) — add in your site's admin with an Embed block"
    );
  });

  it("points the limited-content item at the site admin", () => {
    const item = report.manualReviewItems.find((i) => i.label === "About page content");
    expect(item).toEqual({
      label: "About page content",
      status: "partial",
      detail: "Limited content was extracted. Review and expand this page in your site's admin.",
      action: "open_site_admin",
    });
  });

  it("points the design item at the site admin", () => {
    const item = report.manualReviewItems.find((i) => i.label === "Design & theme");
    expect(item?.detail).toMatch(/in your site's admin: colors and fonts under Appearance/);
    expect(item?.action).toBe("open_site_admin");
  });

  it("points the unmapped-page item at the site admin", () => {
    expect(report.skippedItems).toEqual([
      {
        label: "Unmapped page: Merch",
        status: "skipped",
        detail: "https://band.example.com/merch — no matching template page. Add it as a new page in your site's admin.",
        action: "open_site_admin",
      },
    ]);
  });

  it("uses singular wording for one embed", () => {
    const one = buildMigrationReport(
      makeSite([makePage({ embeds: [{ type: "bandcamp", src: "https://bandcamp.com/EmbeddedPlayer/z" }] })]),
      noFiles,
      "The Band"
    );
    expect(one.manualReviewItems.find((i) => i.label === "Embedded media")?.detail).toMatch(/^1 embed found \(bandcamp\)\./);
    expect(one.summary).toContain("Found 1 media embed (YouTube, Spotify, etc.) — add in your site's admin with an Embed block");
  });
});
