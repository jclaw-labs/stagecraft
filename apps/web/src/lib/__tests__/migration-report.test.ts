import { describe, it, expect } from "vitest";

import { buildMigrationReport } from "../migration/report";
import type { ExtractedSite, ExtractedPage } from "../migration/crawler";

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
  it("points artists at the site admin's image fields, not the removed asset manager (#410)", () => {
    const site = makeSite([
      makePage({ images: [{ src: "/a.jpg", alt: "" }, { src: "/b.jpg", alt: "" }] }),
    ]);
    const report = buildMigrationReport(site, noFiles, "The Band");

    const item = report.manualReviewItems.find((i) => i.label === "Images");
    expect(item?.status).toBe("manual_review");
    expect(item?.detail).toBe(
      "2 image references found. Images are not downloaded automatically — add your photos in your site's admin (/admin), using the image fields on each page or item."
    );
    expect(report.summary).toContain("Found 2 images — add photos in your site's admin (/admin) via the image fields");
    expect(JSON.stringify(report)).not.toMatch(/asset manager/i);
  });

  it("uses singular wording for one image", () => {
    const report = buildMigrationReport(
      makeSite([makePage({ images: [{ src: "/a.jpg", alt: "" }] })]),
      noFiles,
      "The Band"
    );
    expect(report.manualReviewItems.find((i) => i.label === "Images")?.detail).toMatch(/^1 image reference found\./);
    expect(report.summary).toContain("Found 1 image — add photos in your site's admin (/admin) via the image fields");
  });

  it("omits the image item and summary line when no images were found", () => {
    const report = buildMigrationReport(makeSite([makePage({})]), noFiles, "The Band");
    expect(report.manualReviewItems.some((i) => i.label === "Images")).toBe(false);
    expect(report.summary.some((l) => l.includes("image"))).toBe(false);
    expect(report.imagesFound).toBe(0);
  });
});
