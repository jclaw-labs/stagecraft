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
 *   2. Specialised renderer here, if the slug has one *and* the
 *      collection's live schema still satisfies the view's required
 *      fields (`specialisedRendererForDef`, #352).
 *   3. `DefaultItemRender` — the universal field-stack fallback.
 *
 * Adding a new specialisation: declare its fields in
 * `view-requirements.ts`, write a tile component that reads them via
 * `resolveViewFields`, and register it in `SPECIALISED_RENDERERS`.
 * CSS for the surrounding grid layout
 * lives in `globals.css` keyed off `[data-collection-view="<slug>"]`.
 */

import type { CSSProperties, ReactNode } from "react";

import { Image } from "@/components/Image";
import { largestVariantUrl } from "@/lib/image-urls";
import type { ImageMetadata } from "@/lib/image-types";
import { itemDetailUrl } from "../routing";
import type { CollectionDef, Item } from "../schema";
// Field access goes through the per-view requirement declarations
// (#352): each tile reads its fields by role, gated by the live schema,
// so an artist's delete / retype hides an optional piece or — for a
// required field — makes `specialisedRendererForDef` fall back to the
// default card. The field-id constants live in `view-requirements.ts`.
import {
  isSpecialisedViewSlug,
  resolveViewFields,
  type SpecialisedViewSlug,
} from "./view-requirements";

// ---------------------------------------------------------------------------
// Photo tile — Image + optional caption
// ---------------------------------------------------------------------------

/**
 * One photo in the photos grid. Rendered inside the `PhotosView`
 * Collection block's wrapper, which carries the grid layout via
 * `[data-collection-view="photos"]` CSS.
 *
 * Caption renders as `<figcaption>` when present. The anchor is the
 * progressive-enhancement fallback: with JS disabled (or before the
 * `PhotoLightboxBoot` client component hydrates), clicking opens the
 * original in a new tab; with JS the boot intercepts the click,
 * preventDefault, and dispatches an event that opens the lightbox
 * modal in place. Data attributes on the anchor carry the
 * lightbox-friendly metadata so the boot doesn't have to re-parse
 * the figcaption text.
 */
function PhotoTile({ item, def }: SpecialisedRendererArgs): ReactNode {
  const fields = resolveViewFields(def, "photos");
  if (!fields) return null;
  const image = fields.image(item, "image");
  if (!image) return null;
  // Per-item fields are the override; image-level metadata
  // (set in the picker once, reused across slots) is the default.
  // The two-layer model lets the artist keep a default caption /
  // credit on the image and override it for specific contexts
  // (e.g. a press kit photo with a venue-specific caption).
  const caption = fields.string(item, "caption") ?? image.caption ?? null;
  const credit = fields.string(item, "credit") ?? image.credit ?? null;
  // The lightbox image source is the largest sharp variant (1600.webp
  // for typical artist uploads) — full-screen viewing doesn't need
  // the multi-MB original, and the variant is what's already cached
  // for thumbnails. The new-tab fallback (JS-disabled path) opens
  // the same URL.
  const lightboxUrl = largestVariantUrl(image);
  return (
    <figure style={photoFigureStyle}>
      <a
        href={lightboxUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${image.alt || "photo"} at full size`}
        data-photo-tile
        data-photo-alt={image.alt}
        data-photo-caption={caption ?? ""}
        data-photo-credit={credit ?? ""}
        data-photo-width={image.width}
        data-photo-height={image.height}
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
function VideoTile({ item, def }: SpecialisedRendererArgs): ReactNode {
  const fields = resolveViewFields(def, "videos");
  if (!fields) return null;
  const source = fields.string(item, "source");
  // Source-specific title fallback so multiple untitled videos on a
  // page get distinguishable screen-reader announcements rather than
  // a chorus of "Video iframe, Video iframe...". The iframe's
  // `title` attribute is the accessible name.
  const titleFallback =
    source === "youtube" ? "YouTube video"
    : source === "vimeo" ? "Vimeo video"
    : source === "upload" ? "Hosted video"
    : "Video";
  const title = fields.string(item, "title") ?? titleFallback;
  const embedUrl = fields.string(item, "embedUrl");
  const thumbnail = fields.image(item, "thumbnail");
  const description = fields.string(item, "description");
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
// Tour-date row — date · venue · city + a Tickets CTA
// ---------------------------------------------------------------------------

/** "Sat · Aug 1" — short weekday + month + day, UTC (matches the template's
 *  UTC date convention). Empty for an unparseable / missing date. */
function formatTourDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${weekday} · ${month} ${d.getUTCDate()}`;
}

/**
 * One tour-date row, rendered inside the `TourDatesView` Collection block's
 * `[data-collection-view="tour-dates"]` wrapper (which carries the list
 * layout + the per-row rule via CSS). Ports the bespoke `TourDatesList` row:
 * date · venue · city, country + a Tickets link (disabled when no URL). The
 * upcoming / exclude-cancelled filtering + soonest-first sort are applied by
 * the Collection block (its `filter`/`sort` props), not here.
 *
 * When the artist removed (or incompatibly retyped) the ticket-link field,
 * the Tickets affordance is dropped entirely rather than shown disabled on
 * every row.
 */
function TourDateRow({ item, def }: SpecialisedRendererArgs): ReactNode {
  const fields = resolveViewFields(def, "tour-dates");
  if (!fields) return null;
  const date = formatTourDate(fields.string(item, "date"));
  const venue = fields.string(item, "venue");
  const city = fields.string(item, "city");
  const country = fields.string(item, "country");
  const ticketUrl = fields.string(item, "ticketUrl");
  return (
    <div style={tourRowStyle}>
      <span>
        {date ? <strong>{date}</strong> : null}
        {venue ? ` — ${venue}` : ""}
        {city ? ` — ${city}${country ? `, ${country}` : ""}` : ""}
      </span>
      {!fields.has("ticketUrl") ? null : ticketUrl ? (
        <a href={ticketUrl} target="_blank" rel="noopener noreferrer" style={tourTicketStyle}>
          Tickets
        </a>
      ) : (
        <span style={{ ...tourTicketStyle, opacity: 0.5 }} aria-disabled="true">
          Tickets
        </span>
      )}
    </div>
  );
}

const tourRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-4)",
  padding: "var(--space-3) 0",
  borderBottom: "var(--rule-width, 1px) solid var(--rule-color, var(--color-border))",
};

const tourTicketStyle: CSSProperties = {
  flexShrink: 0,
  display: "inline-block",
  padding: "var(--space-1) var(--space-3)",
  borderRadius: "var(--btn-radius, var(--radius))",
  border: "var(--border-width) solid var(--color-text)",
  color: "var(--color-text)",
  textDecoration: "none",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

// ---------------------------------------------------------------------------
// Release card — square cover + title + "type · year" meta + description
// ---------------------------------------------------------------------------

const RELEASE_TYPE_LABELS: Record<string, string> = {
  album: "Album",
  ep: "EP",
  single: "Single",
};

/** "Album · 2026" — release-type label + release year, each dropped if unset. */
function releaseMetaLine(releaseType: string, releaseDate: string): string {
  const typeLabel = RELEASE_TYPE_LABELS[releaseType] ?? "";
  const ms = Date.parse(releaseDate);
  const year = Number.isNaN(ms) ? "" : String(new Date(ms).getUTCFullYear());
  return [typeLabel, year].filter(Boolean).join(" · ");
}

/**
 * One release card inside the `ReleasesView` Collection block's
 * `[data-collection-view="releases"]` grid. Ports the bespoke ReleasesList
 * card: square cover (themed gradient placeholder when no art) + title +
 * type · year meta + description. Cover cropping is the shared
 * `[data-release-cover]` CSS. Cover + title link to the release's detail
 * page when the collection has one.
 */
function ReleaseTile({ item, def }: SpecialisedRendererArgs): ReactNode {
  const fields = resolveViewFields(def, "releases");
  if (!fields) return null;
  const cover = fields.image(item, "coverImage");
  const title = fields.string(item, "title") ?? "";
  const releaseType = fields.string(item, "releaseType") ?? "";
  const releaseDate = fields.string(item, "releaseDate") ?? "";
  const description = fields.string(item, "description") ?? "";
  const meta = releaseMetaLine(releaseType, releaseDate);
  return (
    <article>
      <CardLink href={itemDetailUrl(def, item.slug)}>
        <div data-release-cover>
          {cover ? (
            <Image image={cover} sizes="(max-width: 768px) 50vw, 25vw" />
          ) : (
            <div aria-hidden style={tileCoverPlaceholderStyle} />
          )}
        </div>
        <h3 style={tileTitleStyle}>{title}</h3>
      </CardLink>
      {meta ? <p style={tileMetaStyle}>{meta}</p> : null}
      {description ? <p style={tileBodyStyle}>{description}</p> : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Post card — 16:9 cover + title + "category · date" meta + summary
// ---------------------------------------------------------------------------

const POST_CATEGORY_LABELS: Record<string, string> = {
  news: "News",
  announcement: "Announcement",
  interview: "Interview",
  essay: "Essay",
};

/** "May 10, 2026" — published date in UTC. */
function formatPostDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Interview · May 10, 2026" — category label + date, each dropped if unset. */
function postMetaLine(category: string, publishedAt: string): string {
  return [POST_CATEGORY_LABELS[category] ?? "", formatPostDate(publishedAt)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One post card inside the `PostsView` Collection block's
 * `[data-collection-view="posts"]` grid. Ports the bespoke PostsList card:
 * 16:9 cover (themed gradient placeholder when no image) + title +
 * category · date meta + summary. Cover cropping is the shared
 * `[data-post-cover]` CSS. Cover + title link to the post's detail page when
 * the collection has one.
 */
function PostTile({ item, def }: SpecialisedRendererArgs): ReactNode {
  const fields = resolveViewFields(def, "posts");
  if (!fields) return null;
  const cover = fields.image(item, "coverImage");
  const title = fields.string(item, "title") ?? "";
  const category = fields.string(item, "category") ?? "";
  const publishedAt = fields.string(item, "publishedAt") ?? "";
  const summary = fields.string(item, "summary") ?? "";
  const meta = postMetaLine(category, publishedAt);
  return (
    <article>
      <CardLink href={itemDetailUrl(def, item.slug)}>
        <div data-post-cover>
          {cover ? (
            <Image image={cover} sizes="(max-width: 768px) 100vw, 33vw" />
          ) : (
            <div aria-hidden style={tileCoverPlaceholderStyle} />
          )}
        </div>
        <h3 style={tilePostTitleStyle}>{title}</h3>
      </CardLink>
      {meta ? <p style={tileMetaStyle}>{meta}</p> : null}
      {summary ? <p style={tileBodyStyle}>{summary}</p> : null}
    </article>
  );
}

/**
 * Wraps a card's cover + title in a link to the item's detail page.
 * Renders the children bare when the collection has no detail pages
 * (`detailUrlPrefix: null`), so the card degrades to its unlinked form.
 * Colour / underline rules are the `[data-card-link]` CSS in globals.css.
 */
function CardLink({ href, children }: { href: string | null; children: ReactNode }): ReactNode {
  if (!href) return children;
  return (
    <a href={href} data-card-link>
      {children}
    </a>
  );
}

// Shared release/post card styles (the post title is a touch larger, matching
// the two bespoke views). Gradient placeholder uses palette tokens.
const tileCoverPlaceholderStyle: CSSProperties = {
  background:
    "linear-gradient(135deg, var(--color-accent), var(--color-primary), var(--color-secondary))",
};
const tileTitleStyle: CSSProperties = {
  margin: "var(--space-2) 0 0",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text)",
};
const tilePostTitleStyle: CSSProperties = { ...tileTitleStyle, fontSize: "var(--font-size-lg)" };
const tileMetaStyle: CSSProperties = {
  margin: "var(--space-1) 0 0",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
};
const tileBodyStyle: CSSProperties = { ...tileMetaStyle, lineHeight: "var(--line-height-base)" };

// ---------------------------------------------------------------------------
// Registry — collection-block.tsx consults this before falling back to
// DefaultItemRender. Adding a new specialisation: register here.
// ---------------------------------------------------------------------------

/** `def` is the source collection's live def — the cards read its `detailUrlPrefix`. */
export type SpecialisedRendererArgs = { item: Item; def: CollectionDef };
export type SpecialisedRenderer = (args: SpecialisedRendererArgs) => ReactNode;

/** Keyed by the same slug union as `VIEW_REQUIREMENTS`, so a renderer
 *  can't ship without declaring the fields it reads (and vice versa). */
export const SPECIALISED_RENDERERS: Readonly<Record<SpecialisedViewSlug, SpecialisedRenderer>> =
  Object.freeze({
    photos: PhotoTile,
    videos: VideoTile,
    "tour-dates": TourDateRow,
    releases: ReleaseTile,
    posts: PostTile,
  });

/**
 * Convenience: look up a specialisation by slug. Returns null when
 * the slug doesn't have one (the common case — most collections
 * fall through to the default fallback). Doesn't check the schema —
 * render paths use `specialisedRendererForDef`.
 */
export function specialisedRendererFor(slug: string): SpecialisedRenderer | null {
  return isSpecialisedViewSlug(slug) ? SPECIALISED_RENDERERS[slug] : null;
}

/**
 * The specialisation to render `def`'s items with, or null to use the
 * default card. Null when the slug has no specialisation *or* when the
 * artist's schema no longer satisfies one of the view's required fields
 * (deleted, or retyped to a type the card can't render) — so an edited
 * schema degrades to the generic field stack instead of a broken card.
 */
export function specialisedRendererForDef(
  def: Pick<CollectionDef, "slug" | "fields">,
): SpecialisedRenderer | null {
  if (!isSpecialisedViewSlug(def.slug)) return null;
  if (!resolveViewFields(def, def.slug)) return null;
  return SPECIALISED_RENDERERS[def.slug];
}

// ---------------------------------------------------------------------------
// Empty-state copy — restored from the bespoke TourDatesList / ReleasesList /
// PostsList (ADR-015 step 5). The generic CollectionBlockRender consults this
// when its resolved item set is empty.
// ---------------------------------------------------------------------------

const EMPTY_VIEW_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "tour-dates": "No upcoming shows right now — check back soon.",
  releases: "No releases yet — add one in the Releases panel.",
  posts: "No posts yet — add one in the Posts panel.",
});

/**
 * Friendly per-slug message for a Collection block whose resolved items are
 * empty — the copy the three bespoke `*List` components showed before the
 * convergence. Returns null for collections without bespoke copy; the block
 * then renders an empty wrapper (its prior behaviour for arbitrary
 * collections).
 */
export function emptyMessageFor(slug: string): string | null {
  return EMPTY_VIEW_MESSAGES[slug] ?? null;
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
