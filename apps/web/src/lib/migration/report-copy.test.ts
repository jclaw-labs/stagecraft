import { describe, it, expect } from "vitest";

import {
  DESIGN_ITEM_DETAIL,
  PAGE_CONTENT_ITEM_DETAIL,
  embedsItemDetail,
  embedsSummaryLine,
  imagesItemDetail,
  imagesSummaryLine,
  siteAdminLink,
  siteAdminUrl,
  siteServingState,
  upgradeStoredReport,
  unmappedPageItemDetail,
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
  detail: DESIGN_ITEM_DETAIL,
  action: "open_site_admin",
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

type ItemList = "manualReviewItems" | "skippedItems";

/**
 * One case per item wording that pointed at the removed edit request flow
 * (#455): the stored item, and what it upgrades to.
 */
const EDIT_REQUEST_ITEM_CASES: {
  name: string;
  list: ItemList;
  label: string;
  status: MigrationReportItem["status"];
  old: string;
  current: string;
}[] = [
  {
    name: "embeds item",
    list: "manualReviewItems",
    label: "Embedded media",
    status: "manual_review",
    old: "3 embeds found (youtube, spotify). Add these via the edit request flow after reviewing the site.",
    current: embedsItemDetail(3, "youtube, spotify"),
  },
  {
    name: "embeds item, singular",
    list: "manualReviewItems",
    label: "Embedded media",
    status: "manual_review",
    old: "1 embed found (bandcamp). Add these via the edit request flow after reviewing the site.",
    current: embedsItemDetail(1, "bandcamp"),
  },
  {
    name: "limited-content item",
    list: "manualReviewItems",
    label: "About page content",
    status: "partial",
    old: "Limited content was extracted. Review and expand this page using the edit request flow.",
    current: PAGE_CONTENT_ITEM_DETAIL,
  },
  {
    name: "design item",
    list: "manualReviewItems",
    label: "Design & theme",
    status: "manual_review",
    old: "Colors, fonts, and layout are set to the template defaults. Customise using the edit request flow.",
    current: DESIGN_ITEM_DETAIL,
  },
  {
    name: "unmapped-page item",
    list: "skippedItems",
    label: "Unmapped page: Merch",
    status: "skipped",
    old: "https://band.example.com/merch — no matching template page. Add content manually via the edit request flow.",
    current: unmappedPageItemDetail("https://band.example.com/merch"),
  },
];

function reportWithItem(list: ItemList, item: MigrationReportItem): MigrationReport {
  const report = makeReport([], []);
  return { ...report, [list]: [item] };
}

describe("upgradeStoredReport — edit request flow copy (#455)", () => {
  for (const c of EDIT_REQUEST_ITEM_CASES) {
    describe(c.name, () => {
      it("rewrites the old wording, keeping its values, and links the site admin", () => {
        const upgraded = upgradeStoredReport(
          reportWithItem(c.list, { label: c.label, status: c.status, detail: c.old })
        );
        expect(upgraded[c.list]).toEqual([
          { label: c.label, status: c.status, detail: c.current, action: "open_site_admin" },
        ]);
        expect(JSON.stringify(upgraded)).not.toMatch(/edit request/i);
      });

      it("leaves the current wording unchanged", () => {
        const current = reportWithItem(c.list, {
          label: c.label,
          status: c.status,
          detail: c.current,
          action: "open_site_admin",
        });
        expect(upgradeStoredReport(current)).toEqual(current);
      });

      it("leaves unknown wording alone, without a link", () => {
        const odd: MigrationReportItem = { label: c.label, status: c.status, detail: "Some other wording." };
        expect(upgradeStoredReport(reportWithItem(c.list, odd))[c.list]).toEqual([odd]);
      });
    });
  }

  it("only upgrades a wording under the item label it was stored with", () => {
    const misplaced: MigrationReportItem = {
      label: "Images",
      status: "manual_review",
      detail: "Colors, fonts, and layout are set to the template defaults. Customise using the edit request flow.",
    };
    expect(upgradeStoredReport(makeReport([], [misplaced])).manualReviewItems).toEqual([misplaced]);
  });

  it("keeps a page URL containing a dash when upgrading an unmapped page", () => {
    const url = "https://band.example.com/live — 2024";
    const upgraded = upgradeStoredReport(
      reportWithItem("skippedItems", {
        label: "Unmapped page: Live",
        status: "skipped",
        detail: `${url} — no matching template page. Add content manually via the edit request flow.`,
      })
    );
    expect(upgraded.skippedItems[0].detail).toBe(unmappedPageItemDetail(url));
  });

  it("rewrites the old embeds summary line, keeping the count", () => {
    const upgraded = upgradeStoredReport(
      makeReport(
        [
          "Found 3 media embeds (YouTube, Spotify, etc.) — add via edit request",
          "Found 1 media embed (YouTube, Spotify, etc.) — add via edit request",
        ],
        []
      )
    );
    expect(upgraded.summary).toEqual([embedsSummaryLine(3), embedsSummaryLine(1)]);
  });

  it("leaves the current and unknown embeds summary lines alone", () => {
    const lines = [embedsSummaryLine(2), "Found 2 media embeds — add them somehow"];
    expect(upgradeStoredReport(makeReport(lines, [])).summary).toEqual(lines);
  });

  it("upgrades a whole pre-#455 report, images included", () => {
    const stored = makeReport(
      [
        "Found 2 images — upload via asset manager to add to your site",
        "Found 3 media embeds (YouTube, Spotify, etc.) — add via edit request",
      ],
      EDIT_REQUEST_ITEM_CASES.filter((c) => c.list === "manualReviewItems").map((c) => ({
        label: c.label,
        status: c.status,
        detail: c.old,
      }))
    );
    const upgraded = upgradeStoredReport(stored);
    expect(JSON.stringify(upgraded)).not.toMatch(/edit request|asset manager/i);
    expect(upgraded.manualReviewItems.every((i) => i.action === "open_site_admin")).toBe(true);
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

describe("siteServingState", () => {
  const none = { isReady: false, isCheckingStatus: false, isCreating: false, isBuilding: false };

  it("is live once the latest deploy is ready, or during the first status check", () => {
    expect(siteServingState({ ...none, isReady: true })).toBe("live");
    expect(siteServingState({ ...none, isCheckingStatus: true })).toBe("live");
  });

  it("is building while the site is created or a deploy is in flight", () => {
    expect(siteServingState({ ...none, isCreating: true })).toBe("building");
    expect(siteServingState({ ...none, isBuilding: true })).toBe("building");
  });

  it("is not live otherwise: a failed or unknown deploy, or an inactive site", () => {
    expect(siteServingState(none)).toBe("not_live");
  });
});
