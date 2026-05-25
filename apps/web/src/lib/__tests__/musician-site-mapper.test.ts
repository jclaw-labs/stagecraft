import { describe, it, expect } from "vitest";

import { mapToMusicianSite, PAGE_ITEM_PREFIX } from "../migration/musician-site-mapper";
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

function makeSite(overrides: Partial<ExtractedSite>): ExtractedSite {
  return {
    rootUrl: "https://band.example.com/",
    domain: "band.example.com",
    siteTitle: "The Band",
    pages: [makePage({})],
    socialLinks: [],
    inferredName: "The Band",
    ...overrides,
  };
}

const PAGE_SLUGS = ["home", "music", "about", "contact"];
const fileByPath = (files: { path: string; content: string }[], path: string) =>
  JSON.parse(files.find((f) => f.path === path)!.content);

describe("mapToMusicianSite", () => {
  it("emits the site singleton, the four seeded page items, and _order.json", () => {
    const { files } = mapToMusicianSite(makeSite({}), "The Band");
    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/content/collections/site/items/_singleton.json");
    for (const slug of PAGE_SLUGS) expect(paths).toContain(`${PAGE_ITEM_PREFIX}${slug}.json`);
    expect(paths).toContain(`${PAGE_ITEM_PREFIX}_order.json`);
  });

  it("builds a site singleton with the required fields + correct {type,value} wrappers", () => {
    const { files } = mapToMusicianSite(
      makeSite({
        pages: [makePage({ description: "We make loud music." })],
        socialLinks: [{ text: "Email", href: "mailto:hi@band.com" }],
      }),
      "The Band",
    );
    const singleton = fileByPath(files, "src/content/collections/site/items/_singleton.json");
    expect(singleton.id).toBeTruthy();
    expect(typeof singleton.createdAt).toBe("string");
    expect(singleton.values.fld_site_artistName).toEqual({ type: "text", value: "The Band" });
    expect(singleton.values.fld_site_siteTitle.value).toBe("The Band — Official Website");
    expect(singleton.values.fld_site_siteDescription).toEqual({ type: "longText", value: "We make loud music." });
    expect(singleton.values.fld_site_contactEmail).toEqual({ type: "email", value: "hi@band.com" });
    expect(singleton.values.fld_site_hasCompletedFirstRun).toEqual({ type: "boolean", value: true });
  });

  it("falls back to a domain contact email when no mailto link is crawled", () => {
    const { files } = mapToMusicianSite(makeSite({}), "The Band");
    const singleton = fileByPath(files, "src/content/collections/site/items/_singleton.json");
    expect(singleton.values.fld_site_contactEmail.value).toBe("contact@band.example.com");
  });

  it("sanitises a crawled mailto (strips query params; falls back when not a valid email)", () => {
    // mailto with a ?subject= query — the site schema requires a valid email,
    // so the query must be stripped or the migrated site 500s on every page.
    const withQuery = mapToMusicianSite(
      makeSite({ socialLinks: [{ text: "Email", href: "mailto:booking@band.com?subject=Booking%20inquiry" }] }),
      "The Band",
    );
    expect(
      fileByPath(withQuery.files, "src/content/collections/site/items/_singleton.json").values.fld_site_contactEmail.value,
    ).toBe("booking@band.com");

    // A non-address mailto falls back to the domain email rather than shipping
    // an invalid one.
    const invalid = mapToMusicianSite(
      makeSite({ socialLinks: [{ text: "Email", href: "mailto:booking" }] }),
      "The Band",
    );
    expect(
      fileByPath(invalid.files, "src/content/collections/site/items/_singleton.json").values.fld_site_contactEmail.value,
    ).toBe("contact@band.example.com");
  });

  it("builds page bodies as a Section > Heading + RichText Puck tree (RichText uses `align`)", () => {
    const { files } = mapToMusicianSite(
      makeSite({
        pages: [
          makePage({
            url: "https://band.example.com/about",
            title: "About",
            headings: ["Our Story"],
            paragraphs: ["We formed in 2010.", "We tour a lot."],
          }),
        ],
      }),
      "The Band",
    );
    const about = fileByPath(files, `${PAGE_ITEM_PREFIX}about.json`);
    expect(about.values.fld_pages_title).toEqual({ type: "text", value: "About" });

    const body = about.values.fld_pages_body;
    expect(body.type).toBe("puckContent");
    expect(body.value.root).toEqual({ props: {} });

    const section = body.value.content[0];
    expect(section.type).toBe("Section");
    expect(section.props.children[0]).toMatchObject({
      type: "Heading",
      props: { text: "Our Story", level: "h1", textAlign: "start" },
    });
    const richText = section.props.children[1];
    expect(richText).toMatchObject({
      type: "RichText",
      props: { text: "We formed in 2010.\n\nWe tour a lot." },
    });
    // RichText's prop is `align`, NOT `textAlign` (mismatch would break render).
    expect(richText.props.align).toBe("start");
    expect(richText.props.textAlign).toBeUndefined();
  });

  it("orders pages to match the template seed", () => {
    const { files } = mapToMusicianSite(makeSite({}), "The Band");
    expect(fileByPath(files, `${PAGE_ITEM_PREFIX}_order.json`)).toEqual(["home", "music", "about", "contact"]);
  });

  it("synthesises a placeholder body for a page role with no crawled match", () => {
    const { files } = mapToMusicianSite(makeSite({ pages: [makePage({ url: "https://band.example.com/" })] }), "The Band");
    const music = fileByPath(files, `${PAGE_ITEM_PREFIX}music.json`);
    expect(music.values.fld_pages_body.value.content[0].props.children[1].props.text).toContain("Music");
  });

  it("collects non-mailto social links", () => {
    const { detectedSocialLinks } = mapToMusicianSite(
      makeSite({
        socialLinks: [
          { text: "Instagram", href: "https://instagram.com/band" },
          { text: "Email", href: "mailto:hi@band.com" },
        ],
      }),
      "The Band",
    );
    expect(detectedSocialLinks).toEqual({ Instagram: "https://instagram.com/band" });
  });
});
