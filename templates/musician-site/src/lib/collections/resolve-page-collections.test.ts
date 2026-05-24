import type { Data } from "@measured/puck";
import { describe, expect, it, vi } from "vitest";

// `read-store` transitively imports server-only modules (next/headers via
// publish → draft-branch → auth). Mock it so this unit test loads in the
// node env, and so the async path has deterministic, far-future items
// (a real date would bit-rot past the "upcoming" filter).
vi.mock("./read-store", () => ({
  getFsReadStore: () => ({
    readCollectionDef: async () => ({ slug: "tour-dates", fields: [] }),
    listItemsInOrder: async () => [
      {
        id: "i_far",
        slug: "far-future",
        createdAt: "",
        updatedAt: "",
        values: {
          fld_tour_dates_date: { type: "date", value: "2099-06-01T20:00:00.000Z" },
          fld_tour_dates_venue: { type: "text", value: "Royal Hall" },
          fld_tour_dates_city: { type: "text", value: "London" },
        },
      },
    ],
  }),
}));

import {
  injectResolvedTourDates,
  mapToResolvedTourDates,
  resolvePageCollectionBlocks,
} from "./resolve-page-collections";
import { TOUR_DATES_FIELD_IDS } from "./field-ids";
import type { Item } from "./schema";
import type { ResolvedTourDate } from "@/components/TourDatesView";

const NOW = new Date("2026-06-01T12:00:00.000Z");

function tourItem(
  slug: string,
  date: string,
  extra: Partial<Record<"venue" | "city" | "country" | "ticketUrl" | "status", string>> = {},
): Item {
  const values: Record<string, { type: string; value: string }> = {
    [TOUR_DATES_FIELD_IDS.date]: { type: "date", value: date },
    [TOUR_DATES_FIELD_IDS.venue]: { type: "text", value: extra.venue ?? "Venue" },
    [TOUR_DATES_FIELD_IDS.city]: { type: "text", value: extra.city ?? "City" },
    [TOUR_DATES_FIELD_IDS.status]: { type: "select", value: extra.status ?? "on_sale" },
  };
  if (extra.country) values[TOUR_DATES_FIELD_IDS.country] = { type: "text", value: extra.country };
  if (extra.ticketUrl) {
    values[TOUR_DATES_FIELD_IDS.ticketUrl] = { type: "url", value: extra.ticketUrl };
  }
  return { id: `item_${slug}`, slug, createdAt: "", updatedAt: "", values } as unknown as Item;
}

const sample: ResolvedTourDate[] = [
  { date: "2026-07-01", venue: "A", city: "X", country: "", ticketUrl: "" },
  { date: "2026-08-01", venue: "B", city: "Y", country: "", ticketUrl: "" },
  { date: "2026-09-01", venue: "C", city: "Z", country: "", ticketUrl: "" },
];

describe("mapToResolvedTourDates", () => {
  it("drops past shows, keeps today + future, and sorts soonest-first", () => {
    const items = [
      tourItem("future-late", "2026-09-10T20:00:00.000Z", { venue: "Late" }),
      tourItem("past", "2026-01-10T20:00:00.000Z", { venue: "Old" }),
      tourItem("today", "2026-06-01T20:00:00.000Z", { venue: "Today" }),
      tourItem("future-early", "2026-07-04T20:00:00.000Z", { venue: "Early" }),
    ];
    const result = mapToResolvedTourDates(items, NOW);
    expect(result.map((r) => r.venue)).toEqual(["Today", "Early", "Late"]);
  });

  it("maps every presentational field from the item values", () => {
    const [r] = mapToResolvedTourDates(
      [
        tourItem("x", "2026-12-01T20:00:00.000Z", {
          venue: "The Echo",
          city: "Los Angeles",
          country: "United States",
          ticketUrl: "https://tix.example/echo",
        }),
      ],
      NOW,
    );
    expect(r).toEqual({
      date: "2026-12-01T20:00:00.000Z",
      venue: "The Echo",
      city: "Los Angeles",
      country: "United States",
      ticketUrl: "https://tix.example/echo",
    });
  });

  it("skips items with a missing or unparseable date", () => {
    const items = [
      tourItem("ok", "2026-10-01T20:00:00.000Z", { venue: "Good" }),
      { id: "i_bad", slug: "bad", createdAt: "", updatedAt: "", values: {} } as unknown as Item,
    ];
    expect(mapToResolvedTourDates(items, NOW).map((r) => r.venue)).toEqual(["Good"]);
  });

  it("excludes cancelled shows (a cancelled gig isn't upcoming)", () => {
    const items = [
      tourItem("live", "2026-08-01T20:00:00.000Z", { venue: "Live", status: "on_sale" }),
      tourItem("off", "2026-08-15T20:00:00.000Z", { venue: "Off", status: "cancelled" }),
      tourItem("soldout", "2026-09-01T20:00:00.000Z", { venue: "SoldOut", status: "sold_out" }),
    ];
    // sold_out + on_sale stay (still happening); cancelled is dropped.
    expect(mapToResolvedTourDates(items, NOW).map((r) => r.venue)).toEqual(["Live", "SoldOut"]);
  });

  it("orders by chronological instant even when timezone offsets differ", () => {
    // Same calendar day, different offsets: 18:00-04:00 (22:00Z) is later than
    // 20:00Z, but a lexical string sort would rank "...T18:00:00.000-04:00"
    // before "...T20:00:00.000Z". Instant-based sort gets it right.
    const items = [
      tourItem("a", "2026-08-01T18:00:00.000-04:00", { venue: "Later" }),
      tourItem("b", "2026-08-01T20:00:00.000Z", { venue: "Earlier" }),
    ];
    expect(mapToResolvedTourDates(items, NOW).map((r) => r.venue)).toEqual(["Earlier", "Later"]);
  });
});

describe("injectResolvedTourDates", () => {
  function page(content: unknown[]): Data {
    return { root: { props: {} }, content } as unknown as Data;
  }

  it("injects items into a top-level TourDatesView block", () => {
    const data = page([{ type: "TourDatesView", props: { id: "t", limit: 5 } }]);
    const out = injectResolvedTourDates(data, sample);
    const block = (out.content as Array<{ props: { items?: ResolvedTourDate[] } }>)[0];
    expect(block.props.items).toEqual(sample);
  });

  it("respects each block's limit", () => {
    const data = page([{ type: "TourDatesView", props: { id: "t", limit: 2 } }]);
    const out = injectResolvedTourDates(data, sample);
    const block = (out.content as Array<{ props: { items?: ResolvedTourDate[] } }>)[0];
    expect(block.props.items).toHaveLength(2);
    expect(block.props.items?.[1].venue).toBe("B");
  });

  it("injects into blocks nested inside a slot (Section.children)", () => {
    const data = page([
      {
        type: "Section",
        props: {
          id: "s",
          children: [
            { type: "Heading", props: { id: "h", text: "On the road" } },
            { type: "TourDatesView", props: { id: "t" } },
          ],
        },
      },
    ]);
    const out = injectResolvedTourDates(data, sample);
    const section = (out.content as Array<{ props: { children: Array<{ type: string; props: { items?: ResolvedTourDate[] } }> } }>)[0];
    const view = section.props.children.find((c) => c.type === "TourDatesView");
    expect(view?.props.items).toEqual(sample);
  });

  it("leaves non-tour blocks untouched and does not mutate the input", () => {
    const content = [{ type: "Heading", props: { id: "h", text: "Hi" } }];
    const data = page(content);
    const out = injectResolvedTourDates(data, sample);
    expect((out.content as Array<{ props: Record<string, unknown> }>)[0].props.items).toBeUndefined();
    // Input untouched.
    expect((content[0] as { props: Record<string, unknown> }).props.items).toBeUndefined();
  });
});

describe("resolvePageCollectionBlocks", () => {
  it("is a no-op (returns the same object) when no collection block is present", async () => {
    const data = { root: { props: {} }, content: [{ type: "Heading", props: { id: "h" } }] } as unknown as Data;
    const out = await resolvePageCollectionBlocks(data);
    expect(out).toBe(data);
  });

  it("loads the collection and injects resolved items when a block is present", async () => {
    const data = {
      root: { props: {} },
      content: [{ type: "TourDatesView", props: { id: "t", limit: 5 } }],
    } as unknown as Data;
    const out = await resolvePageCollectionBlocks(data);
    const block = (out.content as Array<{ props: { items?: ResolvedTourDate[] } }>)[0];
    expect(block.props.items).toEqual([
      { date: "2099-06-01T20:00:00.000Z", venue: "Royal Hall", city: "London", country: "", ticketUrl: "" },
    ]);
  });
});
