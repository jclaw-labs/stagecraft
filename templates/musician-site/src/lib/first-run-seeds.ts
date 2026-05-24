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
 * The home page mirrors the theme comps: a hero (name + tagline + CTA +
 * banner), a latest-release row (album art + blurb + buttons), a tour
 * placeholder, and a gallery. Imagery uses empty `Image` blocks, which
 * render a theme-driven gradient placeholder until the artist uploads —
 * so no image binary ships with the template. Releases as a structured
 * collection record still aren't seeded (the coverImage field is
 * required); the home page's release row stands in for one.
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

// One composed tour row: date + venue on the left, a Tickets CTA on the
// right. Returned as a loose block literal — the whole page data is cast
// to PuckData below.
function tourRow(
  id: string,
  date: string,
  venue: string,
): { type: string; props: Record<string, unknown> } {
  return {
    type: "Columns",
    props: {
      id,
      layout: "2-1",
      col1: [
        {
          type: "RichText",
          props: { id: `${id}-text`, text: `${date} — ${venue}` },
        },
      ],
      col2: [
        {
          type: "Button",
          props: {
            id: `${id}-btn`,
            text: "Tickets",
            href: "#",
            variant: "outline",
            isExternal: false,
          },
        },
      ],
      col3: [],
    },
  };
}

// One tracklist row: track number + title on the left, duration on the right.
function trackRow(
  id: string,
  num: number,
  title: string,
  duration: string,
): { type: string; props: Record<string, unknown> } {
  return {
    type: "Columns",
    props: {
      id,
      layout: "2-1",
      col1: [{ type: "RichText", props: { id: `${id}-t`, text: `${num}. ${title}` } }],
      col2: [{ type: "RichText", props: { id: `${id}-d`, text: duration } }],
      col3: [],
    },
  };
}

function buildHomePageSeed(
  artistName: string,
  title: string,
  slug: string,
): FirstRunPageSeed {
  const data = {
    content: [
      // Hero — centered name + tagline + CTA, then a wide themed gradient
      // banner (an empty Image the artist swaps for a real photo).
      {
        type: "Section",
        props: {
          id: "fr-hero",
          width: "lg",
          textAlign: "center",
          children: [
            {
              type: "Eyebrow",
              props: { id: "fr-hero-eyebrow", text: "New record · Out now", textAlign: "center" },
            },
            {
              type: "Heading",
              props: { id: "fr-hero-title", text: artistName, level: "h1", textAlign: "center" },
            },
            {
              type: "RichText",
              props: {
                id: "fr-hero-sub",
                text: "New record. New tour. Same restless heart.",
              },
            },
            {
              type: "Button",
              props: {
                id: "fr-hero-cta",
                text: "Listen now",
                href: "#",
                variant: "primary",
                isExternal: false,
              },
            },
            {
              type: "Image",
              props: {
                id: "fr-hero-image",
                image: null,
                caption: "",
                aspectRatio: "16/9",
                tone: "accent",
              },
            },
          ],
        },
      },

      // Latest release — album art beside title / blurb / two CTAs.
      {
        type: "Section",
        props: {
          id: "fr-release",
          width: "lg",
          textAlign: "start",
          variant: "card",
          children: [
            {
              type: "Columns",
              props: {
                id: "fr-release-cols",
                layout: "1-2",
                col1: [
                  {
                    type: "Image",
                    props: {
                      id: "fr-release-art",
                      image: null,
                      caption: "",
                      aspectRatio: "1/1",
                      tone: "primary",
                    },
                  },
                ],
                col2: [
                  {
                    type: "Eyebrow",
                    props: { id: "fr-release-eyebrow", text: "Latest release", textAlign: "start" },
                  },
                  {
                    type: "Heading",
                    props: {
                      id: "fr-release-title",
                      text: "The Long Way Home",
                      level: "h2",
                      textAlign: "start",
                    },
                  },
                  {
                    type: "RichText",
                    props: {
                      id: "fr-release-body",
                      text:
                        "The new record — ten songs cut live to tape. Out now " +
                        "everywhere. Swap in your own cover art and links from " +
                        "the editor.",
                    },
                  },
                  {
                    type: "ButtonRow",
                    props: {
                      id: "fr-release-cta",
                      align: "start",
                      buttons: [
                        { text: "Stream", href: "#", variant: "primary", isExternal: false },
                        { text: "Order vinyl", href: "#", variant: "outline", isExternal: false },
                      ],
                    },
                  },
                ],
                col3: [],
              },
            },
          ],
        },
      },

      // The record — tracklist, separate from the release card above.
      {
        type: "Section",
        props: {
          id: "fr-tracklist",
          width: "lg",
          textAlign: "start",
          children: [
            {
              type: "Eyebrow",
              props: { id: "fr-tracklist-eyebrow", text: "The record", textAlign: "start" },
            },
            trackRow("fr-track-1", 1, "Stone Chapel", "3:42"),
            trackRow("fr-track-2", 2, "Ash & Iron", "4:05"),
            trackRow("fr-track-3", 3, "The Long Way Home", "3:58"),
            trackRow("fr-track-4", 4, "Halflight", "5:12"),
          ],
        },
      },

      // On the road — composed example rows (date/venue + a Tickets CTA).
      // A real, data-bound tour-dates block on a general page needs the
      // collection-block system wired into the page renderer (deferred —
      // see design/comp-fidelity-plan.md); these rows give the comp look
      // and the artist edits them in place.
      {
        type: "Section",
        props: {
          id: "fr-tour",
          width: "md",
          textAlign: "start",
          children: [
            {
              type: "Eyebrow",
              props: { id: "fr-tour-eyebrow", text: "On tour", textAlign: "start" },
            },
            {
              type: "Heading",
              props: { id: "fr-tour-title", text: "On the road", level: "h2", textAlign: "start" },
            },
            tourRow("fr-tour-1", "Fri · Jun 18", "Mercury Lounge — New York, NY"),
            { type: "Divider", props: { id: "fr-tour-d1", inset: false } },
            tourRow("fr-tour-2", "Sat · Jul 11", "Mississippi Studios — Portland, OR"),
            { type: "Divider", props: { id: "fr-tour-d2", inset: false } },
            tourRow("fr-tour-3", "Thu · Aug 6", "The Echo — Los Angeles, CA"),
          ],
        },
      },

      // Gallery — three themed gradient tiles to swap for photos.
      {
        type: "Section",
        props: {
          id: "fr-gallery",
          width: "lg",
          textAlign: "start",
          children: [
            {
              type: "Eyebrow",
              props: { id: "fr-gallery-eyebrow", text: "Gallery", textAlign: "start" },
            },
            {
              type: "Heading",
              props: { id: "fr-gallery-title", text: "On stage & off", level: "h2", textAlign: "start" },
            },
            {
              type: "Columns",
              props: {
                id: "fr-gallery-cols",
                layout: "1-1-1",
                col1: [
                  {
                    type: "Image",
                    props: {
                      id: "fr-gallery-1",
                      image: null,
                      caption: "",
                      aspectRatio: "1/1",
                      tone: "accent",
                    },
                  },
                ],
                col2: [
                  {
                    type: "Image",
                    props: {
                      id: "fr-gallery-2",
                      image: null,
                      caption: "",
                      aspectRatio: "1/1",
                      tone: "primary",
                    },
                  },
                ],
                col3: [
                  {
                    type: "Image",
                    props: {
                      id: "fr-gallery-3",
                      image: null,
                      caption: "",
                      aspectRatio: "1/1",
                      tone: "secondary",
                    },
                  },
                ],
              },
            },
          ],
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
