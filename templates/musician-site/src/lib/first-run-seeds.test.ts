import { describe, expect, it } from "vitest";

import {
  buildFirstRunSeed,
  homePageItemValues,
  slugifyForSeed,
} from "./first-run-seeds";
import { PAGES_FIELD_IDS } from "./collections/field-ids";

describe("slugifyForSeed", () => {
  it("lowercases, swaps spaces for dashes, strips punctuation", () => {
    expect(slugifyForSeed("Hello World!")).toBe("hello-world");
    expect(slugifyForSeed("Sunset BLVD.")).toBe("sunset-blvd");
    expect(slugifyForSeed("   spaced   out   ")).toBe("spaced-out");
  });

  it("falls back to 'home' on empty / all-punctuation input", () => {
    expect(slugifyForSeed("")).toBe("home");
    expect(slugifyForSeed("   ")).toBe("home");
    expect(slugifyForSeed("!@#$%")).toBe("home");
  });

  it("collapses repeated dashes", () => {
    expect(slugifyForSeed("a -- b --- c")).toBe("a-b-c");
  });
});

describe("buildFirstRunSeed", () => {
  // Fixed `now` so tour-date assertions are stable across runs.
  const NOW = new Date("2026-05-20T00:00:00.000Z");

  // The hero h1 lives inside the hero Section's `children` slot.
  function heroHeadingText(seed: ReturnType<typeof buildFirstRunSeed>): string | undefined {
    type Block = { type: string; props: Record<string, unknown> };
    const blocks = seed.homePage.data.content as unknown as Block[];
    const hero = blocks.find((c) => c.props.id === "fr-hero");
    const children = (hero?.props.children as Block[] | undefined) ?? [];
    const h1 = children.find((c) => c.type === "Heading" && c.props.level === "h1");
    return h1?.props.text as string | undefined;
  }

  it("produces a home page seed using the artist name as the hero heading", () => {
    const seed = buildFirstRunSeed("Nova Reyes", "Home", NOW);
    expect(seed.homePage.slug).toBe("home");
    expect(heroHeadingText(seed)).toBe("Nova Reyes");
  });

  it("seeds imagery + CTAs so the home reads like the theme comps, not a wall of text", () => {
    // Regression guard: the original seed placed only Heading/RichText/
    // Section, so the rendered site (and PR screenshots) looked nothing
    // like the comps — no images, no buttons. Walk the whole block tree
    // (slots nest inside children / col1-3).
    type Block = { type: string; props: Record<string, unknown> };
    const SLOTS = ["children", "col1", "col2", "col3"];
    const types = new Set<string>();
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        types.add(b.type);
        for (const slot of SLOTS) {
          const nested = b.props[slot];
          if (Array.isArray(nested)) walk(nested as Block[]);
        }
      }
    };
    const seed = buildFirstRunSeed("Nova Reyes", "Home", NOW);
    walk(seed.homePage.data.content as unknown as Block[]);
    expect(types).toContain("Image");
    expect(types).toContain("Button");
    expect(types).toContain("Columns");
  });

  it("honours a custom first-page title", () => {
    const seed = buildFirstRunSeed("Test Artist", "Halflight", NOW);
    expect(seed.homePage.slug).toBe("halflight");
    expect(seed.homePage.data.root?.props?.title).toBe("Halflight");
  });

  it("defaults to 'Home' when the first-page title is blank", () => {
    const seed = buildFirstRunSeed("Test Artist", "   ", NOW);
    expect(seed.homePage.slug).toBe("home");
    expect(seed.homePage.data.root?.props?.title).toBe("Home");
  });

  it("defaults to 'Artist Name' when the artist name is blank", () => {
    const seed = buildFirstRunSeed("", "Home", NOW);
    expect(heroHeadingText(seed)).toBe("Artist Name");
  });

  it("Section blocks ship populated `children` arrays (no headline/body string drop)", () => {
    // Section moved from textarea body to a children slot. Brand-new
    // artists land in the welcome flow; if a seed's Section still
    // carried `headline`/`body` strings, Puck would render an empty
    // <section> on first paint and the artist's first impression of
    // the editor would be broken sample content.
    const seed = buildFirstRunSeed("Nova Reyes", "Home", NOW);
    const sections = seed.homePage.data.content.filter((c) => c.type === "Section");
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const props = (section as { props: Record<string, unknown> }).props;
      expect(Array.isArray(props.children)).toBe(true);
      expect((props.children as unknown[]).length).toBeGreaterThan(0);
      // The pre-slot fields shouldn't sneak back in via copy-paste.
      expect(props.headline).toBeUndefined();
      expect(props.body).toBeUndefined();
    }
  });

  it("seeds Music / About / Contact starter pages so the nav isn't one link", () => {
    const seed = buildFirstRunSeed("Nova Reyes", "Home", NOW);
    expect(seed.starterPages.map((p) => p.slug)).toEqual(["music", "about", "contact"]);
    // The Contact page ships a working ContactForm block.
    const contact = seed.starterPages.find((p) => p.slug === "contact");
    expect(JSON.stringify(contact?.data.content ?? [])).toContain("ContactForm");
  });

  it("binds the home tour section to a real TourDatesView (no faked rows or tracklist)", () => {
    type Block = { type: string; props: Record<string, unknown> };
    const seed = buildFirstRunSeed("Nova Reyes", "Home", NOW);
    const blocks = seed.homePage.data.content as unknown as Block[];
    const tour = blocks.find((b) => b.props.id === "fr-tour");
    const tourKids = (tour?.props.children as Block[] | undefined) ?? [];
    // The section is data-bound, not a stack of hand-faked Columns/Divider rows.
    expect(tourKids.some((k) => k.type === "TourDatesView")).toBe(true);
    expect(tourKids.some((k) => k.type === "Columns" || k.type === "Divider")).toBe(false);
    // The collection-less fake tracklist section is gone entirely.
    expect(blocks.some((b) => b.props.id === "fr-tracklist")).toBe(false);
    expect(JSON.stringify(seed.homePage.data.content)).not.toContain("Stone Chapel");
  });

  it("seeds exactly two tour dates with required fields populated", () => {
    const seed = buildFirstRunSeed("Test", "Home", NOW);
    expect(seed.tourDates).toHaveLength(2);
    for (const item of seed.tourDates) {
      expect(item.values.fld_tour_dates_date?.type).toBe("date");
      expect(item.values.fld_tour_dates_venue?.type).toBe("text");
      expect(item.values.fld_tour_dates_city?.type).toBe("text");
      expect(item.values.fld_tour_dates_status?.type).toBe("select");
      const status = item.values.fld_tour_dates_status;
      // narrow for type-safe value access
      if (status && status.type === "select") {
        expect(["on_sale", "sold_out", "cancelled", "free"]).toContain(
          status.value,
        );
      }
    }
  });

  it("tour-date dates are derived from the passed `now` (3 and 4 months out)", () => {
    const seed = buildFirstRunSeed("Test", "Home", NOW);
    // NOW = 2026-05-20 → +3mo = 2026-08-20, +4mo = 2026-09-20.
    // Hour is normalised to 20:00 UTC by addMonths.
    expect(seed.tourDates[0].values.fld_tour_dates_date).toEqual({
      type: "date",
      value: "2026-08-20T20:00:00.000Z",
    });
    expect(seed.tourDates[1].values.fld_tour_dates_date).toEqual({
      type: "date",
      value: "2026-09-20T20:00:00.000Z",
    });
  });

  it("tour-date dates default to relative-to-now when no `now` is passed", () => {
    const before = new Date();
    const seed = buildFirstRunSeed("Test", "Home");
    const after = new Date();
    const firstDate = new Date(
      (seed.tourDates[0].values.fld_tour_dates_date as { value: string }).value,
    );
    // First seed is ~3 months out — should be well after `before + 2 months`
    // and well before `after + 5 months`, regardless of when the test runs.
    const minMs = before.getTime() + 2 * 30 * 24 * 60 * 60 * 1000;
    const maxMs = after.getTime() + 5 * 30 * 24 * 60 * 60 * 1000;
    expect(firstDate.getTime()).toBeGreaterThan(minMs);
    expect(firstDate.getTime()).toBeLessThan(maxMs);
  });

  it("tour-date slugs are unique within the seed", () => {
    const seed = buildFirstRunSeed("Test", "Home", NOW);
    const slugs = seed.tourDates.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("homePageItemValues", () => {
  const NOW = new Date("2026-05-20T00:00:00.000Z");

  it("produces values keyed by PAGES_FIELD_IDS and preserves the title", () => {
    const seed = buildFirstRunSeed("Test Artist", "Halflight", NOW);
    const values = homePageItemValues(seed.homePage);
    expect(values[PAGES_FIELD_IDS.title]).toEqual({
      type: "text",
      value: "Halflight",
    });
    expect(values[PAGES_FIELD_IDS.isSplashPage]).toEqual({
      type: "boolean",
      value: false,
    });
    expect(values[PAGES_FIELD_IDS.showInNav]).toEqual({
      type: "boolean",
      value: true,
    });
    expect(values[PAGES_FIELD_IDS.body]?.type).toBe("puckContent");
  });

  it("strips root props from the body's Puck data (they belong on the item, not the body)", () => {
    const seed = buildFirstRunSeed("Test Artist", "Home", NOW);
    const values = homePageItemValues(seed.homePage);
    const body = values[PAGES_FIELD_IDS.body];
    if (body && body.type === "puckContent") {
      expect(body.value.root?.props).toEqual({});
    } else {
      throw new Error("expected puckContent body");
    }
  });
});
