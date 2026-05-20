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

  it("produces a home page seed using the artist name as the hero heading", () => {
    const seed = buildFirstRunSeed("Nova Reyes", "Home", NOW);
    expect(seed.homePage.slug).toBe("home");

    const heading = seed.homePage.data.content.find((c) => c.type === "Heading");
    expect(heading).toBeDefined();
    expect((heading as { props: { text: string } }).props.text).toBe("Nova Reyes");
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
    const heading = seed.homePage.data.content.find((c) => c.type === "Heading");
    expect((heading as { props: { text: string } }).props.text).toBe(
      "Artist Name",
    );
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
