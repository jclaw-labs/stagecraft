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
 * banner), a latest-release row (album art + blurb + buttons), a
 * data-bound tour list, and a gallery. The tour section uses a real
 * `TourDatesView` block bound to the seeded `tour-dates` collection — not
 * hand-faked rows — so the homepage and the Tour Dates panel never drift
 * apart. Imagery uses empty `Image` blocks, which render a theme-driven
 * gradient placeholder until the artist uploads — so no image binary ships
 * with the template. Releases as a structured collection record still
 * aren't seeded (the coverImage field is required); the home page's
 * release row stands in for one.
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
  /**
   * Light starter pages (Music / About / Contact) so the nav isn't a
   * single link out of the box. Seeded only on the content-ful start;
   * the artist edits or deletes them.
   */
  starterPages: FirstRunPageSeed[];
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
    starterPages: buildStarterPages(trimmedName),
    tourDates: buildTourDateSeeds(now),
  };
}

// A light starter page: eyebrow + title + a paragraph or two, optionally
// followed by extra blocks (e.g. a contact form). Kept minimal — the point
// is a real, editable page so the nav has somewhere to go.
function starterPageSeed(
  slug: string,
  title: string,
  eyebrow: string,
  paragraphs: string[],
  extra: Array<{ type: string; props: Record<string, unknown> }> = [],
): FirstRunPageSeed {
  return {
    slug,
    data: {
      content: [
        {
          type: "Section",
          props: {
            id: `sp-${slug}`,
            width: "lg",
            textAlign: "start",
            variant: "plain",
            children: [
              { type: "Eyebrow", props: { id: `sp-${slug}-eyebrow`, text: eyebrow, textAlign: "start" } },
              { type: "Heading", props: { id: `sp-${slug}-title`, text: title, level: "h1", textAlign: "start" } },
              ...paragraphs.map((text, i) => ({
                type: "RichText",
                props: { id: `sp-${slug}-p${i}`, text, align: "start" },
              })),
              ...extra,
            ],
          },
        },
      ],
      root: { props: { title, isSplashPage: false, isFooterHidden: false } },
    } as PuckData,
  };
}

function buildStarterPages(artistName: string): FirstRunPageSeed[] {
  return [
    starterPageSeed("music", "Music", "Listen", [
      "Streams, releases, and where to find the records. Drop release links " +
        "or an embed here, or build it out from the editor.",
    ]),
    starterPageSeed("about", "About", "Bio", [
      `${artistName} — your story goes here. Where you're from, what the ` +
        "music is about, who you make it with.",
      "Edit this page in the editor: add photos, a press quote, links.",
    ]),
    starterPageSeed("contact", "Contact", "Get in touch", [
      "Booking, press, or just to say hello — the form goes to your contact email.",
    ], [{ type: "ContactForm", props: { id: "sp-contact-form" } }]),
  ];
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

      // On the road — a real, data-bound tour list. TourDatesView reads the
      // artist's tour-dates collection at render (items injected server-side
      // by resolvePageCollectionBlocks; a placeholder shows in the editor).
      // No more hand-faked rows that drift from the actual Tour Dates panel.
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
            { type: "TourDatesView", props: { id: "fr-tour-list", limit: 5 } },
          ],
        },
      },

      // Gallery — a tiled photo grid. The Gallery block's arrangement is
      // theme-driven (galleryLayout token); empty tiles render themed
      // gradient stand-ins until the artist uploads real photos.
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
              type: "Gallery",
              props: {
                id: "fr-gallery-grid",
                images: [
                  { image: null },
                  { image: null },
                  { image: null },
                  { image: null },
                  { image: null },
                  { image: null },
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
