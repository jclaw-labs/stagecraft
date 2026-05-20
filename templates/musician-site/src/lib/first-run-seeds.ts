/**
 * Sample content generators for the first-run welcome wizard
 * (Hybrid approach — PR 7).
 *
 * After the artist finishes the wizard, the welcome API seeds a small
 * starter set so /admin/pages isn't empty. Voice/tone: "atmospheric
 * demo" — opinionated copy that uses the artist's name and reads like
 * a real site so the editor doesn't feel like a blank Word document.
 * The artist edits in place.
 *
 * Releases are deliberately NOT seeded — the releases collection's
 * coverImage field is required, and shipping a real image binary in
 * the template would be its own pipeline. The home page hints at
 * latest-release with a Section the artist can swap a real one into.
 *
 * Everything here is pure — these functions only build value-shapes.
 * The welcome route owns the write-through-publish side, so this file
 * is safe to import from anywhere (no node:fs dependency).
 */

import type { Data as PuckData } from "@measured/puck";

import { PAGES_FIELD_IDS } from "./collections/field-ids";
import type { FieldValue } from "./collections/schema";

export type ItemValuesMap = Record<string, FieldValue>;

export type FirstRunPageSeed = {
  slug: string;
  /**
   * Puck `Data` shape with our `BlockProps`-shaped content. Typed
   * generically (no `<BlockProps>` parameter) because Puck's
   * `Data["root"]["props"]` is `{ title?: string }` by default —
   * the page-level `isSplashPage` / `isFooterHidden` we use as root
   * props live there too, and `pageDataToItem` extracts them
   * dynamically. Same widening pattern as `emptyPageData` in
   * content.ts.
   */
  data: PuckData;
};

export type FirstRunTourDateSeed = {
  slug: string;
  values: ItemValuesMap;
};

export type FirstRunSeed = {
  /** Home page, titled with whatever the artist typed in the wizard. */
  homePage: FirstRunPageSeed;
  /** Two illustrative tour dates a few months out. */
  tourDates: FirstRunTourDateSeed[];
};

/**
 * Build the seed payload for the welcome wizard.
 *
 * `artistName` is interpolated into the home page's hero so the very
 * first thing the artist sees on /admin/pages reflects their name —
 * which makes the demo content feel like a draft of their site, not
 * a stranger's. `firstPageTitle` defaults to "Home" upstream when the
 * artist didn't type anything; we don't second-guess it here.
 *
 * `now` parameterises the tour-date seed dates so they're always a
 * few months out from when the wizard runs — the alternative
 * (hardcoded calendar dates) bit-rots into the past within a year,
 * exactly the demo-content-the-artist-forgot-to-clean-up failure
 * mode this seed pack tries to avoid. Tests pass a fixed `Date` for
 * snapshot stability.
 *
 * `slugify` matches the rule applied to artist-typed page titles in
 * the create-page form (`/admin/pages` inline form): lowercase ASCII,
 * spaces → dashes, strip anything else. We only need it for the home
 * page slug because the tour-date slugs are hand-picked.
 */
export function buildFirstRunSeed(
  artistName: string,
  firstPageTitle: string,
  now: Date = new Date(),
): FirstRunSeed {
  const trimmedName = artistName.trim() || "Artist Name";
  const title = firstPageTitle.trim() || "Home";
  const homeSlug = slugifyForSeed(title);
  return {
    homePage: buildHomePageSeed(trimmedName, title, homeSlug),
    tourDates: buildTourDateSeeds(now),
  };
}

function buildHomePageSeed(
  artistName: string,
  title: string,
  slug: string,
): FirstRunPageSeed {
  const data = {
    content: [
      {
        type: "Heading",
        props: {
          id: "first-run-heading-hero",
          text: artistName,
          level: "h1",
          textAlign: "center",
        },
      },
      {
        type: "Section",
        props: {
          id: "first-run-section-tagline",
          width: "lg",
          headline: "New record. New tour. Same restless heart.",
          body:
            "Welcome to the new site — a home for the work, the road, " +
            "and everything that happens between. Drift in for a while.",
          textAlign: "center",
        },
      },
      {
        type: "Section",
        props: {
          id: "first-run-section-shows",
          width: "md",
          headline: "On the road",
          body:
            "A few dates already on the books — there's a tour-dates " +
            "block ready to drop here from the Insert menu. Edit the " +
            "venues from the Tour Dates panel on the left.",
          textAlign: "start",
        },
      },
      {
        type: "Section",
        props: {
          id: "first-run-section-listen",
          width: "md",
          headline: "Latest release",
          body:
            "Add an Image block above (or a release record under " +
            "Releases) and the home page starts to feel like home.",
          textAlign: "start",
        },
      },
    ],
    root: {
      props: {
        title,
        isSplashPage: false,
        isFooterHidden: false,
      },
    },
  } as PuckData;
  return { slug, data };
}

function buildTourDateSeeds(now: Date): FirstRunTourDateSeed[] {
  // Dates picked ~3 and ~4 months out from `now` so they always
  // feel current to whoever bootstraps a site. The artist replaces
  // these immediately — the important thing is that the Tour Dates
  // panel and the public shows page have something to render on
  // day one.
  const first = addMonths(now, 3).toISOString();
  const second = addMonths(now, 4).toISOString();
  return [
    {
      slug: "mercury-lounge-new-york",
      values: {
        fld_tour_dates_date: { type: "date", value: first },
        fld_tour_dates_venue: { type: "text", value: "Mercury Lounge" },
        fld_tour_dates_city: { type: "text", value: "New York" },
        fld_tour_dates_country: { type: "text", value: "United States" },
        fld_tour_dates_status: { type: "select", value: "on_sale" },
        fld_tour_dates_notes: {
          type: "longText",
          value: "Replace with a real show — or delete from Tour Dates.",
        },
      },
    },
    {
      slug: "mississippi-studios-portland",
      values: {
        fld_tour_dates_date: { type: "date", value: second },
        fld_tour_dates_venue: { type: "text", value: "Mississippi Studios" },
        fld_tour_dates_city: { type: "text", value: "Portland" },
        fld_tour_dates_country: { type: "text", value: "United States" },
        fld_tour_dates_status: { type: "select", value: "on_sale" },
        fld_tour_dates_notes: {
          type: "longText",
          value: "Replace with a real show — or delete from Tour Dates.",
        },
      },
    },
  ];
}

// Date.setMonth handles month rollover (Nov + 3 → Feb) and keeps the
// time-of-day component; we set the hour to 20:00 UTC so the
// renderer always shows an evening start time regardless of when
// the wizard ran.
function addMonths(d: Date, months: number): Date {
  const next = new Date(d);
  next.setUTCMonth(next.getUTCMonth() + months);
  next.setUTCHours(20, 0, 0, 0);
  return next;
}

/**
 * Minimal page-title → slug converter that matches the one the
 * inline "Add page" form on /admin/pages uses. Kept local because
 * the seed only ever runs once per site and pulling in the heavier
 * `slug-suggest` helper would needlessly couple this file to the
 * admin form.
 */
export function slugifyForSeed(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : "home";
}

/** Build pages-item values for the home page seed. Pure shape helper. */
export function homePageItemValues(seed: FirstRunPageSeed): ItemValuesMap {
  return {
    [PAGES_FIELD_IDS.title]: {
      type: "text",
      value: typeof seed.data.root?.props?.title === "string"
        ? (seed.data.root.props.title as string)
        : "Home",
    },
    [PAGES_FIELD_IDS.isSplashPage]: { type: "boolean", value: false },
    [PAGES_FIELD_IDS.isFooterHidden]: { type: "boolean", value: false },
    [PAGES_FIELD_IDS.showInNav]: { type: "boolean", value: true },
    [PAGES_FIELD_IDS.body]: {
      type: "puckContent",
      value: {
        content: seed.data.content ?? [],
        root: { props: {} },
      } as PuckData,
    },
  };
}
