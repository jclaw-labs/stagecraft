/**
 * Per-slug specialised renderers for Collection blocks. The generic
 * `CollectionBlockItem` consults the registry below before falling
 * back to `DefaultItemRender`; collections that ship a specialised
 * renderer (today: `photos`, `videos`) get a hand-tuned layout
 * matching what the legacy template offered (`PhotoGallery`,
 * `VideoGallery`).
 *
 * Priority order at the call site (`collection-block.tsx`):
 *   1. The artist's custom `itemTemplate`, if set — explicit
 *      authoring always wins.
 *   2. Specialised renderer here, if the slug has one.
 *   3. `DefaultItemRender` — the universal field-stack fallback.
 *
 * Adding a new specialisation: write a tile component + register it
 * in `SPECIALISED_RENDERERS`. CSS for the surrounding grid layout
 * lives in `globals.css` keyed off `[data-collection-view="<slug>"]`.
 */

import type { CSSProperties, ReactNode } from "react";

import { Image } from "@/components/Image";
import type { ImageMetadata } from "@/lib/image-types";
import {
  getImageOrNull,
  getLongTextOrNull,
  getSelectOrNull,
  getTextOrNull,
} from "../accessors";
// Always import field-id constants directly from `../field-ids`, never
// via `seeds.ts`'s convenience re-export — `seeds.ts` pulls
// `schema.ts → node:crypto` into the bundle, which webpack rejects
// whenever this module ends up inside a `"use client"` chain (today
// via `collection-block.tsx` → `TemplateEditorClient`). The rule
// applies to every client-reachable file; see CLAUDE.md "Client-bundle
// discipline."
import {
  PHOTOS_FIELD_IDS,
  VIDEOS_FIELD_IDS,
} from "../field-ids";
import type { Item } from "../schema";

// ---------------------------------------------------------------------------
// Photo tile — Image + optional caption
// ---------------------------------------------------------------------------

/**
 * One photo in the photos grid. Rendered inside the `PhotosView`
 * Collection block's wrapper, which carries the grid layout via
 * `[data-collection-view="photos"]` CSS.
 *
 * Caption renders as `<figcaption>` when present. Without a real
 * lightbox (out of scope for v1 — would need client-side
 * interactivity), the tile links to the original upload so a click
 * opens the full-resolution image in a new tab. Cheap, accessible,
 * good-enough.
 */
function PhotoTile({ item }: { item: Item }): ReactNode {
  const image = getImageOrNull(item, PHOTOS_FIELD_IDS.image);
  if (!image) return null;
  // Per-item fields are the override; image-level metadata
  // (set in the picker once, reused across slots) is the default.
  // The two-layer model lets the artist keep a default caption /
  // credit on the image and override it for specific contexts
  // (e.g. a press kit photo with a venue-specific caption).
  const caption =
    getLongTextOrNull(item, PHOTOS_FIELD_IDS.caption) ?? image.caption ?? null;
  const credit =
    getTextOrNull(item, PHOTOS_FIELD_IDS.credit) ?? image.credit ?? null;
  const originalUrl = `/images/${image.contentSlug}/${image.id}/original.${image.originalExt}`;
  return (
    <figure style={photoFigureStyle}>
      <a
        href={originalUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${image.alt || "photo"} at full size`}
      >
        <Image image={image} sizes="(max-width: 600px) 100vw, 33vw" />
      </a>
      {caption || credit ? (
        <figcaption style={photoCaptionStyle}>
          {caption ? <span>{caption}</span> : null}
          {credit ? (
            <span style={photoCreditStyle}>
              {caption ? " — " : ""}
              {credit}
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Video tile — iframe for YouTube/Vimeo, <video> for self-hosted
// ---------------------------------------------------------------------------

/**
 * One video in the videos grid. Three variants by `source`:
 *
 *   - youtube → 16:9 iframe at youtube-nocookie.com/embed (privacy-
 *     enhanced mode, drops the standard `youtube.com` tracking
 *     cookies — same choice the legacy template made).
 *   - vimeo   → 16:9 iframe at player.vimeo.com/video.
 *   - upload  → native `<video controls>` with the thumbnail as
 *     poster (when set). The artist supplies the file path
 *     (e.g. `/uploads/song.mp4`); we render `<source>` and let the
 *     browser pick the codec.
 *
 * URL parsing reuses the legacy template's extractors verbatim
 * (`extractYouTubeId` / `extractVimeoId`) — every URL shape they
 * cover is one the artist might paste. Unparsable URLs fall back to
 * a link-out card so the artist's bad data doesn't render a broken
 * iframe.
 */
function VideoTile({ item }: { item: Item }): ReactNode {
  const source = getSelectOrNull(item, VIDEOS_FIELD_IDS.source);
  // Source-specific title fallback so multiple untitled videos on a
  // page get distinguishable screen-reader announcements rather than
  // a chorus of "Video iframe, Video iframe...". The iframe's
  // `title` attribute is the accessible name.
  const titleFallback =
    source === "youtube" ? "YouTube video"
    : source === "vimeo" ? "Vimeo video"
    : source === "upload" ? "Hosted video"
    : "Video";
  const title = getTextOrNull(item, VIDEOS_FIELD_IDS.title) ?? titleFallback;
  const embedUrl = getTextOrNull(item, VIDEOS_FIELD_IDS.embedUrl);
  const thumbnail = getImageOrNull(item, VIDEOS_FIELD_IDS.thumbnail);
  const description = getLongTextOrNull(item, VIDEOS_FIELD_IDS.description);
  if (!embedUrl) return null;

  return (
    <article style={videoTileStyle}>
      <div style={videoFrameStyle}>
        <VideoEmbed
          source={source}
          embedUrl={embedUrl}
          thumbnail={thumbnail}
          title={title}
        />
      </div>
      <h3 style={videoTitleStyle}>{title}</h3>
      {description ? <p style={videoDescriptionStyle}>{description}</p> : null}
    </article>
  );
}

/**
 * Inner dispatch for the three source variants. Pulled out so the
 * outer chrome (title, description) is identical regardless of
 * which embed mechanism fires. Returns a link-out card when the URL
 * can't be parsed — better than a broken iframe.
 */
function VideoEmbed({
  source,
  embedUrl,
  thumbnail,
  title,
}: {
  source: string | null;
  embedUrl: string;
  thumbnail: ImageMetadata | null;
  title: string;
}): ReactNode {
  if (source === "youtube") {
    const id = extractYouTubeId(embedUrl);
    if (id) {
      return (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?rel=0`}
          title={title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={videoIframeStyle}
        />
      );
    }
  }
  if (source === "vimeo") {
    const id = extractVimeoId(embedUrl);
    if (id) {
      return (
        <iframe
          src={`https://player.vimeo.com/video/${id}`}
          title={title}
          loading="lazy"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          style={videoIframeStyle}
        />
      );
    }
  }
  if (source === "upload") {
    const poster = thumbnail
      ? `/images/${thumbnail.contentSlug}/${thumbnail.id}/original.${thumbnail.originalExt}`
      : undefined;
    return (
      <video
        src={embedUrl}
        controls
        preload="metadata"
        poster={poster}
        style={videoIframeStyle}
      />
    );
  }
  // Unrecognised source or unparsable URL — link out instead of
  // rendering a broken iframe. Arrow is decorative; `aria-hidden`
  // so screen readers don't announce "north-east arrow" after
  // "Watch."
  return (
    <a
      href={embedUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={videoFallbackLinkStyle}
    >
      Watch{" "}
      <span aria-hidden="true">↗</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// URL extractors — direct ports of the legacy template's helpers.
// Kept in this file (rather than a new url-utils module) because they
// only have one consumer; lift if a second one appears.
// ---------------------------------------------------------------------------

/**
 * Extract a YouTube video ID from common URL shapes:
 *   https://www.youtube.com/watch?v=ID
 *   https://youtu.be/ID
 *   https://www.youtube.com/embed/ID
 *   https://www.youtube.com/shorts/ID
 *
 * Returns null for any URL the artist couldn't reasonably have
 * pasted (private/non-YouTube hosts).
 */
export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id || null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && ["embed", "shorts", "v"].includes(parts[0]!)) {
        return parts[1] ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract a Vimeo numeric video ID from common URL shapes:
 *   https://vimeo.com/12345678
 *   https://player.vimeo.com/video/12345678
 */
export function extractVimeoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const candidate = parts[0] === "video" ? parts[1] : parts[0];
    if (candidate && /^\d+$/.test(candidate)) return candidate;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registry — collection-block.tsx consults this before falling back to
// DefaultItemRender. Adding a new specialisation: register here.
// ---------------------------------------------------------------------------

export type SpecialisedRenderer = (args: { item: Item }) => ReactNode;

export const SPECIALISED_RENDERERS: Readonly<Record<string, SpecialisedRenderer>> =
  Object.freeze({
    photos: PhotoTile,
    videos: VideoTile,
  });

/**
 * Convenience: look up a specialisation by slug. Returns null when
 * the slug doesn't have one (the common case — most collections
 * fall through to the default fallback).
 */
export function specialisedRendererFor(slug: string): SpecialisedRenderer | null {
  return SPECIALISED_RENDERERS[slug] ?? null;
}

// ---------------------------------------------------------------------------
// Styles — inline because these tiles are server-rendered and the public
// site stylesheet is owned by globals.css + appearance tokens. The
// wrapper-level grid layout lives in globals.css keyed off the
// `data-collection-view` attribute; per-tile styles stay here.
// ---------------------------------------------------------------------------

const photoFigureStyle: CSSProperties = {
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const photoCaptionStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
  lineHeight: "var(--line-height-base)",
};

const photoCreditStyle: CSSProperties = {
  fontStyle: "italic",
};

const videoTileStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const videoFrameStyle: CSSProperties = {
  position: "relative",
  aspectRatio: "16 / 9",
  background: "var(--color-surface-raised)",
  borderRadius: "var(--radius-sm)",
  overflow: "hidden",
};

const videoIframeStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  border: 0,
};

const videoTitleStyle: CSSProperties = {
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  margin: 0,
};

const videoDescriptionStyle: CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
  margin: 0,
  lineHeight: "var(--line-height-base)",
};

const videoFallbackLinkStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "var(--color-text)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  textDecoration: "none",
};
