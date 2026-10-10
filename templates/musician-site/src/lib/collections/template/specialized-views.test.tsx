/**
 * URL extractor cases (ports of the legacy template's
 * VideoGallery/toEmbeddable.test.ts) + tile-render snapshots for the
 * two specialised renderers (`PhotoTile` / `VideoTile`).
 *
 * The tile components aren't exported — they're internal to
 * `specialized-views.tsx`. Tested via `SPECIALISED_RENDERERS.photos` /
 * `.videos`, the registry `specialisedRendererForDef` dispatches through.
 * Renderers take `{ item }` and return JSX; SSR snapshotted with
 * `renderToStaticMarkup` (same pattern the rest of the public-render
 * components use).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  emptyMessageFor,
  extractVimeoId,
  extractYouTubeId,
  specialisedRendererForDef,
  SPECIALISED_RENDERERS,
} from "./specialized-views";
import {
  PHOTOS_FIELD_IDS,
  POSTS_FIELD_IDS,
  RELEASES_FIELD_IDS,
  TOUR_DATES_FIELD_IDS,
  VIDEOS_FIELD_IDS,
} from "../field-ids";
import type { CollectionDef, Item } from "../schema";
import {
  photosCollectionDef,
  postsCollectionDef,
  releasesCollectionDef,
  tourDatesCollectionDef,
  videosCollectionDef,
} from "../seeds";
import { asImageId, type ImageMetadata } from "@/lib/image-types";

const TS = { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

const IMAGE_FIXTURE: ImageMetadata = {
  id: asImageId("abc1234567890def"),
  alt: "A photo",
  width: 1600,
  height: 1067,
  placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
  contentSlug: "home",
  originalExt: "jpg",
};

// ---------------------------------------------------------------------------
// URL extractors — direct ports of the legacy test cases. The
// renderers depend on these working for every URL shape an artist
// might paste.
// ---------------------------------------------------------------------------

describe("extractYouTubeId", () => {
  it("parses watch URLs", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses youtu.be short URLs", () => {
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses embed URLs", () => {
    expect(extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses shorts URLs", () => {
    expect(extractYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses m.youtube.com URLs", () => {
    expect(extractYouTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("returns null for non-YouTube URLs", () => {
    expect(extractYouTubeId("https://example.com/watch?v=nope")).toBeNull();
  });
  it("returns null for malformed URLs", () => {
    expect(extractYouTubeId("not a url")).toBeNull();
  });
});

describe("extractVimeoId", () => {
  it("parses vimeo.com/ID URLs", () => {
    expect(extractVimeoId("https://vimeo.com/123456789")).toBe("123456789");
  });
  it("parses player.vimeo.com/video/ID URLs", () => {
    expect(extractVimeoId("https://player.vimeo.com/video/123456789")).toBe("123456789");
  });
  it("returns null for non-Vimeo URLs", () => {
    expect(extractVimeoId("https://youtube.com/watch?v=abc")).toBeNull();
  });
  it("returns null when the path segment is not numeric", () => {
    expect(extractVimeoId("https://vimeo.com/channels/staffpicks")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("SPECIALISED_RENDERERS", () => {
  it("registers photos, videos, tour-dates, releases, posts", () => {
    expect(Object.keys(SPECIALISED_RENDERERS).sort()).toEqual([
      "photos",
      "posts",
      "releases",
      "tour-dates",
      "videos",
    ]);
  });
});

// ---------------------------------------------------------------------------
// PhotoTile
// ---------------------------------------------------------------------------

function photoItem(opts: { image?: typeof IMAGE_FIXTURE | null; caption?: string; credit?: string } = {}) {
  const values: Item["values"] = {};
  if (opts.image !== null) {
    values[PHOTOS_FIELD_IDS.image] = { type: "image", value: opts.image ?? IMAGE_FIXTURE };
  }
  if (opts.caption) {
    values[PHOTOS_FIELD_IDS.caption] = { type: "longText", value: opts.caption };
  }
  if (opts.credit) {
    values[PHOTOS_FIELD_IDS.credit] = { type: "text", value: opts.credit };
  }
  return { id: "item_p", slug: "p1", ...TS, values } satisfies Item;
}

function renderPhoto(item: Item): string {
  const PhotoTile = SPECIALISED_RENDERERS.photos;
  return renderToStaticMarkup(<>{PhotoTile({ item, def: photosCollectionDef })}</>);
}

describe("PhotoTile", () => {
  it("renders the image wrapped in a link to the largest sharp variant", () => {
    // Image goes through the responsive `<picture>` renderer; the
    // anchor carries the largest available sharp variant. With JS,
    // the `PhotoLightboxBoot` client component intercepts the click
    // and opens the modal in place; without JS, the anchor falls
    // back to opening the variant in a new tab. Either way, the
    // 1600.webp is what's served — multi-MB originals are wasteful
    // when the variant is already cached.
    const html = renderPhoto(photoItem());
    expect(html).toContain("<picture>");
    expect(html).toContain('href="/images/home/abc1234567890def/1600.webp"');
    expect(html).toContain('target="_blank"');
  });

  it("exposes lightbox-friendly data attributes on the anchor", () => {
    // The PhotoLightboxBoot client component reads these to build
    // the modal's image list — declarative; no figcaption re-
    // parsing.
    const html = renderPhoto(
      photoItem({ caption: "Soundcheck note", credit: "Photo by Jane" }),
    );
    expect(html).toMatch(/data-photo-tile/);
    expect(html).toContain('data-photo-alt="A photo"');
    expect(html).toContain('data-photo-caption="Soundcheck note"');
    expect(html).toContain('data-photo-credit="Photo by Jane"');
  });

  it("threads intrinsic dimensions via data-photo-width / data-photo-height", () => {
    // The lightbox uses these to reserve aspect-ratio-correct
    // layout space for the modal image so the figure doesn't
    // snap-resize as each photo paints.
    const html = renderPhoto(photoItem());
    expect(html).toContain('data-photo-width="1600"');
    expect(html).toContain('data-photo-height="1067"');
  });

  it("falls back to the original URL for vector (SVG) photos", () => {
    // The variant pipeline doesn't emit sharp variants for SVG /
    // ICO; `largestVariantUrl` returns the original on the vector
    // branch. The PhotoTile anchor href should match.
    const svgImage = { ...IMAGE_FIXTURE, originalExt: "svg" as const };
    const html = renderPhoto(photoItem({ image: svgImage }));
    expect(html).toContain('href="/images/home/abc1234567890def/original.svg"');
    expect(html).not.toContain(".webp");
  });

  it("emits empty-string data attributes when caption / credit are unset", () => {
    // The boot reads `data-photo-caption ?? ""`; we emit the
    // attribute with an empty value rather than omitting it so the
    // shape stays uniform across tiles.
    const html = renderPhoto(photoItem());
    expect(html).toContain('data-photo-caption=""');
    expect(html).toContain('data-photo-credit=""');
  });

  it("renders caption + credit when present", () => {
    const html = renderPhoto(photoItem({ caption: "Soundcheck", credit: "Photo by Jane" }));
    expect(html).toMatch(/<figcaption/);
    expect(html).toContain("Soundcheck");
    expect(html).toContain("Photo by Jane");
  });

  it("omits the figcaption entirely when neither caption nor credit set", () => {
    const html = renderPhoto(photoItem());
    expect(html).not.toMatch(/<figcaption/);
  });

  it("renders null when no image is present (no broken anchor)", () => {
    const item = { id: "i", slug: "p1", ...TS, values: {} } satisfies Item;
    const PhotoTile = SPECIALISED_RENDERERS.photos;
    expect(PhotoTile({ item, def: photosCollectionDef })).toBeNull();
  });

  // Two-layer caption / credit model: per-item fields override
  // image-level metadata. Lets an artist set a default caption /
  // credit on the image once (in the picker) and override it for
  // specific contexts. Matches the legacy template's behaviour.

  it("falls back to image.caption / image.credit when per-item fields are unset", () => {
    const image = { ...IMAGE_FIXTURE, caption: "Image-level caption", credit: "Image-level credit" };
    const html = renderPhoto(photoItem({ image }));
    expect(html).toMatch(/<figcaption/);
    expect(html).toContain("Image-level caption");
    expect(html).toContain("Image-level credit");
  });

  it("per-item caption / credit override the image-level defaults", () => {
    const image = { ...IMAGE_FIXTURE, caption: "Image default", credit: "Image default credit" };
    const html = renderPhoto(
      photoItem({
        image,
        caption: "Item override",
        credit: "Item override credit",
      }),
    );
    expect(html).toContain("Item override");
    expect(html).toContain("Item override credit");
    expect(html).not.toContain("Image default");
  });
});

// ---------------------------------------------------------------------------
// VideoTile
// ---------------------------------------------------------------------------

function videoItem(opts: {
  title?: string;
  source: "youtube" | "vimeo" | "upload" | string;
  embedUrl: string;
  thumbnail?: typeof IMAGE_FIXTURE | null;
  description?: string;
}) {
  const values: Item["values"] = {
    [VIDEOS_FIELD_IDS.title]: { type: "text", value: opts.title ?? "My Video" },
    [VIDEOS_FIELD_IDS.source]: { type: "select", value: opts.source },
    [VIDEOS_FIELD_IDS.embedUrl]: { type: "text", value: opts.embedUrl },
  };
  if (opts.thumbnail) {
    values[VIDEOS_FIELD_IDS.thumbnail] = { type: "image", value: opts.thumbnail };
  }
  if (opts.description) {
    values[VIDEOS_FIELD_IDS.description] = { type: "longText", value: opts.description };
  }
  return { id: "item_v", slug: "v1", ...TS, values } satisfies Item;
}

function renderVideo(item: Item): string {
  const VideoTile = SPECIALISED_RENDERERS.videos;
  return renderToStaticMarkup(<>{VideoTile({ item, def: videosCollectionDef })}</>);
}

describe("VideoTile", () => {
  it("renders a youtube-nocookie iframe for source=youtube", () => {
    const html = renderVideo(
      videoItem({ source: "youtube", embedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    );
    // youtube-nocookie.com is the privacy-enhanced host — same
    // choice the legacy template made.
    expect(html).toMatch(/<iframe/);
    expect(html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    // React serialises the prop as `allowFullScreen=""` — case
    // preserved by `react-dom/server`. The HTML spec accepts both
    // casings; what matters is the attribute is present.
    expect(html).toMatch(/allowFullScreen=""|allowfullscreen=""/);
  });

  it("renders a player.vimeo.com iframe for source=vimeo", () => {
    const html = renderVideo(
      videoItem({ source: "vimeo", embedUrl: "https://vimeo.com/123456789" }),
    );
    expect(html).toMatch(/<iframe/);
    expect(html).toContain("player.vimeo.com/video/123456789");
  });

  it("renders a <video> element with poster for source=upload", () => {
    const html = renderVideo(
      videoItem({
        source: "upload",
        embedUrl: "/uploads/my-song.mp4",
        thumbnail: IMAGE_FIXTURE,
      }),
    );
    expect(html).toMatch(/<video[^>]+src="\/uploads\/my-song\.mp4"/);
    expect(html).toContain("controls");
    expect(html).toContain('poster="/images/home/abc1234567890def/original.jpg"');
    expect(html).not.toMatch(/<iframe/);
  });

  it("renders a fallback link for unparsable YouTube URL (no broken iframe)", () => {
    const html = renderVideo(
      videoItem({ source: "youtube", embedUrl: "https://example.com/not-youtube" }),
    );
    expect(html).not.toMatch(/<iframe/);
    expect(html).toContain('href="https://example.com/not-youtube"');
    expect(html).toContain("Watch");
  });

  it("renders title + description chrome around every embed variant", () => {
    const html = renderVideo(
      videoItem({
        title: "Live at the Apollo",
        description: "From the 2026 tour.",
        source: "youtube",
        embedUrl: "https://youtu.be/dQw4w9WgXcQ",
      }),
    );
    expect(html).toContain("Live at the Apollo");
    expect(html).toContain("From the 2026 tour.");
  });

  it("renders null when the embedUrl is missing", () => {
    // Build the item without embedUrl. The schema would normally
    // reject this on write (embedUrl is required), but a corrupt /
    // partial file could land here; defensive against rendering
    // a broken iframe.
    const item = {
      id: "i",
      slug: "v1",
      ...TS,
      values: {
        [VIDEOS_FIELD_IDS.title]: { type: "text" as const, value: "Untitled" },
        [VIDEOS_FIELD_IDS.source]: { type: "select" as const, value: "youtube" },
      },
    } satisfies Item;
    const VideoTile = SPECIALISED_RENDERERS.videos;
    expect(VideoTile({ item, def: videosCollectionDef })).toBeNull();
  });

  it("uses a source-specific title fallback when title is unset (a11y)", () => {
    // Multiple videos with no title on a page would all render the
    // same `title="Video"` on their iframes — screen readers can't
    // disambiguate them. The source-specific fallback gives each
    // iframe at least a category-distinct accessible name.
    const renderWithoutTitle = (source: string) => {
      const item: Item = {
        id: "v",
        slug: "v1",
        ...TS,
        values: {
          [VIDEOS_FIELD_IDS.source]: { type: "select", value: source },
          [VIDEOS_FIELD_IDS.embedUrl]: {
            type: "text",
            value:
              source === "youtube"
                ? "https://youtu.be/abc"
                : source === "vimeo"
                ? "https://vimeo.com/123"
                : "/uploads/x.mp4",
          },
        },
      };
      return renderToStaticMarkup(<>{SPECIALISED_RENDERERS.videos({ item, def: videosCollectionDef })}</>);
    };
    expect(renderWithoutTitle("youtube")).toContain('title="YouTube video"');
    expect(renderWithoutTitle("vimeo")).toContain('title="Vimeo video"');
    // upload uses <video> not <iframe>; the fallback shows up in
    // the visible <h3> title chrome instead.
    expect(renderWithoutTitle("upload")).toContain("Hosted video");
  });
});

// ---------------------------------------------------------------------------
// Dispatch through CollectionBlockItem — the actual consumer of the
// specialised registry. Verifies the priority ordering documented at the
// dispatch site (itemTemplate > specialised > default).
// ---------------------------------------------------------------------------

describe("CollectionBlockRender — specialised dispatch", () => {
  /**
   * The dispatch site (`CollectionBlockItem` inside collection-block.tsx)
   * doesn't directly export; we exercise it via the public
   * `CollectionBlockRender` which renders one item per child. A
   * single-item render asserts the right tile component fires.
   */
  it("dispatches to the photos specialisation when the source slug is `photos`", async () => {
    const { CollectionBlockRender } = await import("./collection-block");
    const item: Item = {
      id: "p1",
      slug: "p1",
      ...TS,
      values: {
        [PHOTOS_FIELD_IDS.image]: { type: "image", value: IMAGE_FIXTURE },
        [PHOTOS_FIELD_IDS.caption]: { type: "longText", value: "Soundcheck" },
      },
    };
    // The seed's fields: the specialisation only fires when the live
    // schema satisfies the view's required fields (#352).
    const def = {
      ...photosCollectionDef,
      itemTemplate: null, // no override → specialisation fires
    };
    const html = renderToStaticMarkup(
      <>
        {CollectionBlockRender({
          items: [item],
          sourceDef: def,
          hideFields: [],
          currentItem: item,
        })}
      </>,
    );
    // PhotoTile-specific markers: <figure>, the variant-link anchor.
    expect(html).toMatch(/<figure/);
    expect(html).toContain("Soundcheck");
    expect(html).toContain('href="/images/home/abc1234567890def/1600.webp"');
  });

  it("respects an explicit `itemTemplate` over the specialisation", async () => {
    // When the artist has authored a custom layout, the
    // specialised renderer must NOT fire. This test verifies the
    // dispatch priority documented at the dispatch site: a
    // non-null itemTemplate routes through the template renderer
    // path, not the registry.
    const { CollectionBlockRender } = await import("./collection-block");
    const item: Item = {
      id: "p1",
      slug: "p1",
      ...TS,
      values: {
        [PHOTOS_FIELD_IDS.image]: { type: "image", value: IMAGE_FIXTURE },
      },
    };
    const customTemplate = {
      content: [
        {
          type: "Text",
          props: {
            id: "x",
            content: { kind: "literal", value: "CUSTOM-TEMPLATE-MARKER" },
          },
        },
      ],
      root: { props: {} },
    };
    const def = {
      schemaVersion: 1 as const,
      slug: "photos",
      singularName: "photo",
      pluralName: "photos",
      fields: [],
      slugSourceFieldId: null,
      detailUrlPrefix: null,
      defaultSort: null,
      itemTemplate: customTemplate, // present → wins over specialisation
      detailTemplate: null,
      listTemplate: null,
      isSingleton: false,
    };
    const html = renderToStaticMarkup(
      <>
        {CollectionBlockRender({
          items: [item],
          sourceDef: def,
          hideFields: [],
          currentItem: item,
        })}
      </>,
    );
    // Custom-template marker rendered; PhotoTile markers absent.
    expect(html).toContain("CUSTOM-TEMPLATE-MARKER");
    expect(html).not.toMatch(/<figure/);
  });
});

// ---------------------------------------------------------------------------
// TourDateRow (tour-dates specialisation)
// ---------------------------------------------------------------------------

function tourDateItem(
  opts: { date?: string; venue?: string; city?: string; country?: string; ticketUrl?: string } = {},
): Item {
  const values: Item["values"] = {};
  if (opts.date) values[TOUR_DATES_FIELD_IDS.date] = { type: "date", value: opts.date };
  if (opts.venue) values[TOUR_DATES_FIELD_IDS.venue] = { type: "text", value: opts.venue };
  if (opts.city) values[TOUR_DATES_FIELD_IDS.city] = { type: "text", value: opts.city };
  if (opts.country) values[TOUR_DATES_FIELD_IDS.country] = { type: "text", value: opts.country };
  if (opts.ticketUrl) {
    values[TOUR_DATES_FIELD_IDS.ticketUrl] = { type: "url", value: opts.ticketUrl };
  }
  return { id: "item_t", slug: "t1", ...TS, values } satisfies Item;
}

function renderTourDate(item: Item): string {
  const TourDateRow = SPECIALISED_RENDERERS["tour-dates"];
  return renderToStaticMarkup(<>{TourDateRow({ item, def: tourDatesCollectionDef })}</>);
}

describe("TourDateRow", () => {
  it("renders date · venue · city, country + a Tickets link", () => {
    const html = renderTourDate(
      tourDateItem({
        date: "2026-08-01",
        venue: "Sala Apolo",
        city: "Madrid",
        country: "Spain",
        ticketUrl: "https://tix.example/madrid",
      }),
    );
    expect(html).toContain("Aug 1"); // UTC-formatted date
    expect(html).toContain("Sala Apolo");
    expect(html).toContain("Madrid");
    expect(html).toContain("Spain");
    expect(html).toContain('href="https://tix.example/madrid"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Tickets");
  });

  it("formats the date in UTC (no drift across midnight)", () => {
    const html = renderTourDate(tourDateItem({ date: "2026-08-01T23:30:00.000Z", venue: "V" }));
    expect(html).toContain("Aug 1");
  });

  it("renders a disabled Tickets affordance when there's no ticket URL", () => {
    const html = renderTourDate(tourDateItem({ date: "2026-08-01", venue: "V", city: "C" }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("<a "); // no real link
  });

  it("shows the country alone when there's no city", () => {
    const html = renderTourDate(tourDateItem({ date: "2026-08-01", venue: "V", country: "Spain" }));
    expect(html).toContain("V — Spain");
  });

  it("omits the date element when the date is missing", () => {
    const html = renderTourDate(tourDateItem({ venue: "V", city: "C" }));
    expect(html).not.toContain("<strong>");
    expect(html).toContain("V");
  });
});

// ---------------------------------------------------------------------------
// ReleaseTile / PostTile (releases + posts specialisations)
// ---------------------------------------------------------------------------

function releaseItem(
  opts: { title?: string; type?: string; date?: string; description?: string; cover?: ImageMetadata } = {},
): Item {
  const values: Item["values"] = {
    [RELEASES_FIELD_IDS.title]: { type: "text", value: opts.title ?? "Untitled" },
  };
  if (opts.cover) values[RELEASES_FIELD_IDS.coverImage] = { type: "image", value: opts.cover };
  if (opts.type) values[RELEASES_FIELD_IDS.releaseType] = { type: "select", value: opts.type };
  if (opts.date) values[RELEASES_FIELD_IDS.releaseDate] = { type: "date", value: opts.date };
  if (opts.description) {
    values[RELEASES_FIELD_IDS.description] = { type: "longText", value: opts.description };
  }
  return { id: "item_r", slug: "r1", ...TS, values } satisfies Item;
}

function renderRelease(item: Item): string {
  return renderToStaticMarkup(<>{SPECIALISED_RENDERERS.releases({ item, def: releasesCollectionDef })}</>);
}

describe("ReleaseTile", () => {
  it("renders cover frame, title, type · year meta, and description", () => {
    const html = renderRelease(
      releaseItem({ title: "The Long Way Home", type: "album", date: "2026-03-01", description: "Ten songs." }),
    );
    expect(html).toContain("data-release-cover");
    expect(html).toContain("The Long Way Home");
    expect(html).toContain("Album · 2026");
    expect(html).toContain("Ten songs.");
  });

  it("shows a themed gradient placeholder (no <img>) when there's no cover art", () => {
    const html = renderRelease(releaseItem({ title: "X", type: "ep", date: "2025-01-01" }));
    expect(html).toContain("linear-gradient");
    expect(html).not.toContain("<img");
    expect(html).toContain("EP · 2025");
  });

  it("renders a cover <img> when art is present", () => {
    const html = renderRelease(releaseItem({ title: "X", cover: IMAGE_FIXTURE }));
    expect(html).toContain("<img");
  });

  it("drops the meta line when both type and date are unset", () => {
    const html = renderRelease(releaseItem({ title: "Bare" }));
    expect(html).toContain("Bare");
    expect(html).not.toContain(" · ");
  });

  it("drops an unknown release type from the meta but keeps the year", () => {
    const html = renderRelease(releaseItem({ title: "X", type: "boxset", date: "2026-01-01" }));
    expect(html).not.toContain("boxset");
    expect(html).toContain("2026");
  });
});

function postItem(
  opts: { title?: string; category?: string; date?: string; summary?: string; cover?: ImageMetadata } = {},
): Item {
  const values: Item["values"] = {
    [POSTS_FIELD_IDS.title]: { type: "text", value: opts.title ?? "Untitled" },
  };
  if (opts.cover) values[POSTS_FIELD_IDS.coverImage] = { type: "image", value: opts.cover };
  if (opts.category) values[POSTS_FIELD_IDS.category] = { type: "select", value: opts.category };
  if (opts.date) values[POSTS_FIELD_IDS.publishedAt] = { type: "date", value: opts.date };
  if (opts.summary) values[POSTS_FIELD_IDS.summary] = { type: "longText", value: opts.summary };
  return { id: "item_post", slug: "p1", ...TS, values } satisfies Item;
}

function renderPost(item: Item): string {
  return renderToStaticMarkup(<>{SPECIALISED_RENDERERS.posts({ item, def: postsCollectionDef })}</>);
}

describe("PostTile", () => {
  it("renders cover frame, title, category · full-date meta, and summary", () => {
    const html = renderPost(
      postItem({ title: "On the Road", category: "interview", date: "2026-05-10", summary: "A chat." }),
    );
    expect(html).toContain("data-post-cover");
    expect(html).toContain("On the Road");
    expect(html).toContain("Interview · May 10, 2026");
    expect(html).toContain("A chat.");
  });

  it("formats the published date in UTC (no drift) and shows a gradient when no cover", () => {
    const html = renderPost(postItem({ title: "X", category: "news", date: "2026-05-10T23:30:00.000Z" }));
    expect(html).toContain("News · May 10, 2026");
    expect(html).toContain("linear-gradient");
    expect(html).not.toContain("<img");
  });

  it("renders a cover <img> when an image is present", () => {
    const html = renderPost(postItem({ title: "X", cover: IMAGE_FIXTURE }));
    expect(html).toContain("<img");
  });
});

// ---------------------------------------------------------------------------
// Empty-state copy — restored from the bespoke *List components (ADR-015).
// ---------------------------------------------------------------------------

describe("emptyMessageFor", () => {
  it("returns the bespoke copy for the three demo collections", () => {
    expect(emptyMessageFor("tour-dates")).toBe(
      "No upcoming shows right now — check back soon.",
    );
    expect(emptyMessageFor("releases")).toBe("No releases yet — add one in the Releases panel.");
    expect(emptyMessageFor("posts")).toBe("No posts yet — add one in the Posts panel.");
  });

  it("returns null for collections without bespoke copy", () => {
    expect(emptyMessageFor("store-items")).toBeNull();
    expect(emptyMessageFor("photos")).toBeNull();
  });
});

describe("CollectionBlockRender — empty state", () => {
  const defFor = (slug: string) => ({
    schemaVersion: 1 as const,
    slug,
    singularName: slug,
    pluralName: slug,
    fields: [],
    slugSourceFieldId: null,
    detailUrlPrefix: null,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: false,
  });

  it("renders the per-slug message (no grid wrapper) when items is empty", async () => {
    const { CollectionBlockRender } = await import("./collection-block");
    const item: Item = { id: "x", slug: "x", ...TS, values: {} };
    const html = renderToStaticMarkup(
      <>
        {CollectionBlockRender({
          items: [],
          sourceDef: defFor("tour-dates"),
          hideFields: [],
          currentItem: item,
        })}
      </>,
    );
    expect(html).toContain("No upcoming shows right now — check back soon.");
    // Plain paragraph — not the data-collection-view grid wrapper.
    expect(html).not.toContain("data-collection-view");
  });

  it("renders an empty data-collection-view wrapper for slugs without copy", async () => {
    const { CollectionBlockRender } = await import("./collection-block");
    const item: Item = { id: "x", slug: "x", ...TS, values: {} };
    const html = renderToStaticMarkup(
      <>
        {CollectionBlockRender({
          items: [],
          sourceDef: defFor("store-items"),
          hideFields: [],
          currentItem: item,
        })}
      </>,
    );
    expect(html).toContain('data-collection-view="store-items"');
  });
});

// ---------------------------------------------------------------------------
// Card → detail-page links
// ---------------------------------------------------------------------------

describe("card links to detail pages", () => {
  it("links a release card's cover + title to /releases/<slug>", () => {
    const html = renderRelease(releaseItem({ title: "Halflight", description: "Four tracks." }));
    expect(html).toMatch(/<a href="\/releases\/r1" data-card-link[^>]*>.*data-release-cover.*Halflight<\/h3><\/a>/);
    // The description stays outside the link.
    expect(html).toMatch(/<\/a><p[^>]*>Four tracks\.<\/p>/);
  });

  it("links a post card's cover + title to /news/<slug>", () => {
    const html = renderPost(postItem({ title: "On the Road" }));
    expect(html).toMatch(/<a href="\/news\/p1" data-card-link[^>]*>.*data-post-cover.*On the Road<\/h3><\/a>/);
  });

  it("follows the collection's live prefix, not a hard-coded one", () => {
    const def = { ...postsCollectionDef, detailUrlPrefix: "/journal" };
    const html = renderToStaticMarkup(
      <>{SPECIALISED_RENDERERS.posts({ item: postItem({ title: "X" }), def })}</>,
    );
    expect(html).toContain('href="/journal/p1"');
  });

  it("leaves the card unlinked when the collection has no detail pages", () => {
    const def = { ...releasesCollectionDef, detailUrlPrefix: null };
    const html = renderToStaticMarkup(
      <>{SPECIALISED_RENDERERS.releases({ item: releaseItem({ title: "X" }), def })}</>,
    );
    expect(html).not.toContain("<a ");
    expect(html).toContain("X</h3>");
  });

  it("keeps tour-date rows linking to tickets, not to /shows/<slug>", () => {
    const html = renderTourDate(
      tourDateItem({ date: "2026-08-01", venue: "V", ticketUrl: "https://tix.example/v" }),
    );
    expect(html).toContain('href="https://tix.example/v"');
    expect(html).not.toContain("/shows/");
  });
});

// ---------------------------------------------------------------------------
// Schema-edit resilience (#352) — views resolve fields through
// `view-requirements.ts`; a broken required field falls back to the default
// card, a missing optional one just doesn't render.
// ---------------------------------------------------------------------------

describe("specialisedRendererForDef", () => {
  const withoutField = (def: CollectionDef, fieldId: string): CollectionDef => ({
    ...def,
    fields: def.fields.filter((f) => f.id !== fieldId),
  });
  const withFieldAs = (fieldId: string, type: "number" | "longText"): CollectionDef => ({
    ...tourDatesCollectionDef,
    fields: tourDatesCollectionDef.fields.map((f) =>
      f.id === fieldId ? { id: f.id, key: f.key, type, required: true } : f,
    ),
  });

  it("returns the specialisation when the schema satisfies the view", () => {
    expect(specialisedRendererForDef(tourDatesCollectionDef)).toBe(
      SPECIALISED_RENDERERS["tour-dates"],
    );
  });

  it("returns null for slugs without a specialisation", () => {
    expect(specialisedRendererForDef({ slug: "store-items", fields: [] })).toBeNull();
  });

  it("returns null when a required field was deleted", () => {
    expect(
      specialisedRendererForDef(withoutField(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.venue)),
    ).toBeNull();
  });

  it("returns null when a required field was retyped to an incompatible type", () => {
    expect(specialisedRendererForDef(withFieldAs(TOUR_DATES_FIELD_IDS.venue, "number"))).toBeNull();
  });

  it("keeps the tour-dates row when city is deleted — city is optional", () => {
    const def = withoutField(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.city);
    const item = tourDateItem({ date: "2026-08-01", venue: "Sala Apolo", city: "Madrid", country: "Spain" });
    const html = renderToStaticMarkup(<>{specialisedRendererForDef(def)!({ item, def })}</>);
    expect(html).toContain("Sala Apolo — Spain");
    expect(html).not.toContain("Madrid"); // stale value under the removed id
  });

  it("reads a re-added field with the same name (new id) after the original was removed", () => {
    const base = withoutField(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.city);
    const def: CollectionDef = {
      ...base,
      fields: [...base.fields, { id: "fld_readded_city", key: "City", type: "text", required: false }],
    };
    const item = tourDateItem({ date: "2026-08-01", venue: "Sala Apolo" });
    item.values["fld_readded_city"] = { type: "text", value: "Lisbon" };
    const html = renderToStaticMarkup(<>{specialisedRendererForDef(def)!({ item, def })}</>);
    expect(html).toContain("Sala Apolo — Lisbon");
  });

  it("keeps the specialisation when only an optional field was deleted", () => {
    expect(
      specialisedRendererForDef(withoutField(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.ticketUrl)),
    ).not.toBeNull();
  });

  it("drops the Tickets affordance entirely once the ticketUrl field is gone", () => {
    const def = withoutField(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.ticketUrl);
    const html = renderToStaticMarkup(
      <>
        {SPECIALISED_RENDERERS["tour-dates"]({
          item: tourDateItem({ date: "2026-08-01", venue: "V", city: "Madrid" }),
          def,
        })}
      </>,
    );
    expect(html).toContain("Madrid");
    expect(html).not.toContain("Tickets");
  });

  it("renders a lossless retype (city text → longText) in the specialised row", () => {
    const def = withFieldAs(TOUR_DATES_FIELD_IDS.city, "longText");
    const item = tourDateItem({ date: "2026-08-01", venue: "V" });
    item.values[TOUR_DATES_FIELD_IDS.city] = { type: "longText", value: "Lisbon" };
    const html = renderToStaticMarkup(<>{specialisedRendererForDef(def)!({ item, def })}</>);
    expect(html).toContain("Lisbon");
  });

  it("falls back to the default card in CollectionBlockRender when a required field is missing", async () => {
    const { CollectionBlockRender } = await import("./collection-block");
    const def = withoutField(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.venue);
    const item = tourDateItem({
      date: "2026-08-01",
      city: "Madrid",
      country: "Spain",
      ticketUrl: "https://tix.example/madrid",
    });
    const html = renderToStaticMarkup(
      <>{CollectionBlockRender({ items: [item], sourceDef: def, hideFields: [], currentItem: item })}</>,
    );
    // Default field stack: "<key>: value" rows, every remaining field shown.
    expect(html).toContain("<strong>city:</strong> Madrid");
    expect(html).toContain("<strong>country:</strong> Spain");
    expect(html).toContain('href="https://tix.example/madrid"');
    // Not the specialised row (whose CTA is the literal "Tickets").
    expect(html).not.toContain(">Tickets<");
    // Nor the view's layout wrapper: default cards stack in normal flow.
    expect(html).not.toContain("data-collection-view");
  });

  it("keeps a fallen-back slug's wrapper when an itemTemplate renders the items", async () => {
    const { CollectionBlockRender } = await import("./collection-block");
    const def: CollectionDef = {
      ...withoutField(tourDatesCollectionDef, TOUR_DATES_FIELD_IDS.venue),
      itemTemplate: { root: { props: {} }, content: [] },
    };
    const item = tourDateItem({ date: "2026-08-01" });
    const html = renderToStaticMarkup(
      <>{CollectionBlockRender({ items: [item], sourceDef: def, hideFields: [], currentItem: item })}</>,
    );
    expect(html).toContain('data-collection-view="tour-dates"');
  });

  it("renders the specialised row in CollectionBlockRender when the schema is intact", async () => {
    const { CollectionBlockRender } = await import("./collection-block");
    const item = tourDateItem({ date: "2026-08-01", venue: "Sala Apolo", city: "Madrid" });
    const html = renderToStaticMarkup(
      <>
        {CollectionBlockRender({
          items: [item],
          sourceDef: tourDatesCollectionDef,
          hideFields: [],
          currentItem: item,
        })}
      </>,
    );
    expect(html).toContain(">Tickets<");
    expect(html).not.toContain("<strong>venue:</strong>");
    expect(html).toContain('data-collection-view="tour-dates"');
  });
});
