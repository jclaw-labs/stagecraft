import { describe, it, expect } from "vitest";

import {
  imagesItemDetail,
  imagesSummaryLine,
  siteAdminLink,
  siteAdminUrl,
  upgradeStoredReport,
  type MigrationReport,
  type MigrationReportItem,
} from "./report-copy";

function makeReport(summary: string[], manualReviewItems: MigrationReportItem[]): MigrationReport {
  return {
    summary,
    overallConfidence: 0.8,
    importedItems: [{ label: "Home page", status: "imported", detail: "Content imported from https://band.example.com/" }],
    manualReviewItems,
    skippedItems: [],
    pagesCrawled: 3,
    pagesMapped: 2,
    imagesFound: 12,
    embedsFound: 0,
    socialLinksFound: 0,
  };
}

const designItem: MigrationReportItem = {
  label: "Design & theme",
  status: "manual_review",
  detail: "Colors, fonts, and layout are set to the template defaults. Customise using the edit request flow.",
};

describe("upgradeStoredReport", () => {
  it("rewrites a report stored before #414 that points at the asset manager", () => {
    const stored = makeReport(
      ["Crawled 3 pages, mapped 2 to template", "Found 12 images — upload via asset manager to add to your site"],
      [
        {
          label: "Images",
          status: "manual_review",
          detail: "12 image references found. Images are not automatically downloaded — please upload your photos via the asset manager.",
        },
        designItem,
      ]
    );

    const upgraded = upgradeStoredReport(stored);

    expect(upgraded.summary).toEqual(["Crawled 3 pages, mapped 2 to template", imagesSummaryLine(12)]);
    expect(upgraded.manualReviewItems).toEqual([
      { label: "Images", status: "manual_review", detail: imagesItemDetail(12), action: "open_site_admin" },
      designItem,
    ]);
    expect(JSON.stringify(upgraded)).not.toMatch(/asset manager/i);
  });

  it("rewrites a report stored by #414 that prints the /admin path", () => {
    const upgraded = upgradeStoredReport(
      makeReport(
        ["Found 1 image — add photos in your site's admin (/admin) via the image fields"],
        [
          {
            label: "Images",
            status: "manual_review",
            detail: "1 image reference found. Images are not downloaded automatically — add your photos in your site's admin (/admin), using the image fields on each page or item.",
          },
        ]
      )
    );

    expect(upgraded.summary).toEqual([imagesSummaryLine(1)]);
    expect(upgraded.manualReviewItems[0]).toEqual({
      label: "Images",
      status: "manual_review",
      detail: imagesItemDetail(1),
      action: "open_site_admin",
    });
  });

  it("leaves a current report unchanged", () => {
    const current = makeReport(
      [imagesSummaryLine(4)],
      [{ label: "Images", status: "manual_review", detail: imagesItemDetail(4), action: "open_site_admin" }, designItem]
    );
    expect(upgradeStoredReport(current)).toEqual(current);
  });

  it("leaves unrecognised wording and other items alone, without a link", () => {
    const odd: MigrationReportItem = { label: "Images", status: "manual_review", detail: "Some other wording." };
    const stored = makeReport(["Found lots of images somewhere"], [odd, designItem]);

    const upgraded = upgradeStoredReport(stored);

    expect(upgraded.summary).toEqual(["Found lots of images somewhere"]);
    expect(upgraded.manualReviewItems).toEqual([odd, designItem]);
    expect(upgraded.importedItems).toEqual(stored.importedItems);
  });

  it("does not modify the stored report it is given", () => {
    const stored = makeReport(
      ["Found 2 images — upload via asset manager to add to your site"],
      [
        {
          label: "Images",
          status: "manual_review",
          detail: "2 image references found. Images are not automatically downloaded — please upload your photos via the asset manager.",
        },
      ]
    );
    const snapshot = structuredClone(stored);
    upgradeStoredReport(stored);
    expect(stored).toEqual(snapshot);
  });
});

describe("siteAdminUrl", () => {
  it("appends /admin to the production URL", () => {
    expect(siteAdminUrl("https://sarah-chen.example.com")).toBe("https://sarah-chen.example.com/admin");
  });

  it("does not double the slash or keep a path from the production URL", () => {
    expect(siteAdminUrl("https://sarah-chen.example.com/")).toBe("https://sarah-chen.example.com/admin");
    expect(siteAdminUrl("https://sarah-chen.example.com/music")).toBe("https://sarah-chen.example.com/admin");
  });

  it("returns null without a usable production URL", () => {
    expect(siteAdminUrl(undefined)).toBeNull();
    expect(siteAdminUrl(null)).toBeNull();
    expect(siteAdminUrl("")).toBeNull();
    expect(siteAdminUrl("sarah-chen.example.com")).toBeNull();
    expect(siteAdminUrl("javascript:alert(1)")).toBeNull();
  });

  it("returns null for a production URL that isn't http or https", () => {
    expect(siteAdminUrl("ftp://sarah-chen.example.com")).toBeNull();
    expect(siteAdminUrl("file:///etc")).toBeNull();
    expect(siteAdminUrl("javascript://sarah-chen.example.com/x")).toBeNull();
  });
});

describe("siteAdminLink", () => {
  const url = "https://sarah-chen.example.com";

  it("links the admin once the site is live", () => {
    expect(siteAdminLink(url, "live")).toEqual({ state: "live", href: "https://sarah-chen.example.com/admin" });
  });

  it("holds the link back while the site is building", () => {
    expect(siteAdminLink(url, "building")).toEqual({
      state: "hidden",
      hint: "The link to your site admin appears once your site finishes building.",
    });
  });

  it("holds the link back without claiming a build when the site isn't live", () => {
    expect(siteAdminLink(url, "not_live")).toEqual({
      state: "hidden",
      hint: "The link to your site admin appears once your site is live.",
    });
  });

  it("asks for a production URL first, whatever the serving state", () => {
    const noUrl = { state: "hidden", hint: "The link to your site admin appears once your site has a production URL." };
    expect(siteAdminLink(undefined, "live")).toEqual(noUrl);
    expect(siteAdminLink("ftp://sarah-chen.example.com", "live")).toEqual(noUrl);
    expect(siteAdminLink(undefined, "building")).toEqual(noUrl);
  });
});
