/**
 * URL extractor cases (ports of the legacy template's
 * VideoGallery/toEmbeddable.test.ts) + tile-render snapshots for the
 * two specialised renderers (`PhotoTile` / `VideoTile`).
 *
 * The tile components aren't exported — they're internal to
 * `specialized-views.tsx`. Tested via `specialisedRendererFor("photos")`
 * / `("videos")`, which is the dispatch the collection-block consumes.
 * Renderers take `{ item }` and return JSX; SSR snapshotted with
 * `renderToStaticMarkup` (same pattern the rest of the public-render
 * components use).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  extractVimeoId,
  extractYouTubeId,
  specialisedRendererFor,
  SPECIALISED_RENDERERS,
} from "./specialized-views";
import {
  PHOTOS_FIELD_IDS,
  VIDEOS_FIELD_IDS,
} from "../seeds";
import type { Item } from "../schema";
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

describe("SPECIALISED_RENDERERS / specialisedRendererFor", () => {
  it("registers photos + videos and nothing else by default", () => {
    expect(Object.keys(SPECIALISED_RENDERERS).sort()).toEqual(["photos", "videos"]);
  });
  it("looks up by slug, null for unregistered", () => {
    expect(specialisedRendererFor("photos")).toBeTypeOf("function");
    expect(specialisedRendererFor("videos")).toBeTypeOf("function");
    expect(specialisedRendererFor("releases")).toBeNull();
    expect(specialisedRendererFor("tour-dates")).toBeNull();
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
  const PhotoTile = specialisedRendererFor("photos")!;
  return renderToStaticMarkup(<>{PhotoTile({ item })}</>);
}

describe("PhotoTile", () => {
  it("renders the image wrapped in a link to the original upload (lightbox-lite)", () => {
    const html = renderPhoto(photoItem());
    // Image goes through the responsive `<picture>` renderer; the
    // anchor opens the full-size original in a new tab. v1 stand-in
    // for a real lightbox.
    expect(html).toContain("<picture>");
    expect(html).toContain('href="/images/home/abc1234567890def/original.jpg"');
    expect(html).toContain('target="_blank"');
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
    const PhotoTile = specialisedRendererFor("photos")!;
    expect(PhotoTile({ item })).toBeNull();
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
  const VideoTile = specialisedRendererFor("videos")!;
  return renderToStaticMarkup(<>{VideoTile({ item })}</>);
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
    const VideoTile = specialisedRendererFor("videos")!;
    expect(VideoTile({ item })).toBeNull();
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
      return renderToStaticMarkup(<>{specialisedRendererFor("videos")!({ item })}</>);
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
    const def = {
      schemaVersion: 1 as const,
      slug: "photos",
      singularName: "photo",
      pluralName: "photos",
      fields: [],
      slugSourceFieldId: null,
      detailUrlPrefix: null,
      defaultSort: null,
      itemTemplate: null, // no override → specialisation fires
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
    // PhotoTile-specific markers: <figure>, the original-link anchor.
    expect(html).toMatch(/<figure/);
    expect(html).toContain("Soundcheck");
    expect(html).toContain('href="/images/home/abc1234567890def/original.jpg"');
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
