import type { CSSProperties } from "react";

import { Image as PublicImage } from "@/components/Image";
import type { ImageMetadata } from "@/lib/image-types";

/**
 * A posts grid embedded on a hand-authored page (e.g. a News / blog page).
 * Data-bound: the public page server-component resolves the artist's `posts`
 * collection items and injects them (see
 * lib/collections/resolve-page-collections). Posts with no cover image show a
 * themed gradient placeholder (cover art is optional).
 *
 * Pure + client-safe (no node imports) so the Puck block render in
 * src/puck/config.tsx can delegate to it. Cover cropping lives in
 * globals.css (`[data-post-cover]`), same approach as ReleasesView / Gallery.
 */

export type ResolvedPost = {
  title: string;
  /** Null when the artist hasn't uploaded a cover image → themed placeholder. */
  coverImage: ImageMetadata | null;
  /** Raw value: "news" | "announcement" | "interview" | "essay" (or "" if unset). */
  category: string;
  /** ISO date string (publishedAt). */
  publishedAt: string;
  summary: string;
};

const POST_CATEGORY_LABELS: Record<string, string> = {
  news: "News",
  announcement: "Announcement",
  interview: "Interview",
  essay: "Essay",
};

/** "May 10, 2026" — published date in UTC, matching the template's date convention. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Interview · May 10, 2026" — category label + date, omitting whichever is unset. */
function metaLine(category: string, publishedAt: string): string {
  const categoryLabel = POST_CATEGORY_LABELS[category] ?? "";
  return [categoryLabel, formatDate(publishedAt)].filter(Boolean).join(" · ");
}

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
  gap: "var(--space-5)",
};

const titleStyle: CSSProperties = {
  margin: "var(--space-2) 0 0",
  fontSize: "var(--font-size-lg)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text)",
};

const metaStyle: CSSProperties = {
  margin: "var(--space-1) 0 0",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
};

const summaryStyle: CSSProperties = {
  ...metaStyle,
  lineHeight: "var(--line-height-base)",
};

export function PostsList({ items }: { items: ResolvedPost[] }) {
  if (items.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
        No posts yet — add one in the Posts panel.
      </p>
    );
  }
  return (
    <div style={gridStyle}>
      {items.map((post, i) => {
        const meta = metaLine(post.category, post.publishedAt);
        return (
          <article key={i}>
            <div data-post-cover>
              {post.coverImage ? (
                <PublicImage image={post.coverImage} sizes="(max-width: 768px) 100vw, 33vw" />
              ) : (
                <div
                  aria-hidden
                  style={{
                    background:
                      "linear-gradient(135deg, var(--color-accent), var(--color-primary), var(--color-secondary))",
                  }}
                />
              )}
            </div>
            <h3 style={titleStyle}>{post.title}</h3>
            {meta ? <p style={metaStyle}>{meta}</p> : null}
            {post.summary ? <p style={summaryStyle}>{post.summary}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

/** Editor stand-in — the live data only resolves on the published page. */
export function PostsPlaceholder() {
  return (
    <div
      style={{
        padding: "var(--space-6)",
        border: "1px dashed var(--color-border)",
        borderRadius: "var(--radius)",
        color: "var(--color-text-muted)",
        textAlign: "center",
        fontSize: "var(--font-size-sm)",
      }}
    >
      Your posts appear here — add them in the Posts panel.
    </div>
  );
}
