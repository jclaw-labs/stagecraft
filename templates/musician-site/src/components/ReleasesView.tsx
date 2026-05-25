import type { CSSProperties } from "react";

import { Image as PublicImage } from "@/components/Image";
import type { ImageMetadata } from "@/lib/image-types";

/**
 * A releases grid embedded on a hand-authored page (e.g. a Music /
 * discography page). Data-bound: the public page server-component resolves
 * the artist's `releases` collection items and injects them (see
 * lib/collections/resolve-page-collections). Releases with no cover art show
 * a themed gradient placeholder (cover art is optional).
 *
 * Pure + client-safe (no node imports) so the Puck block render in
 * src/puck/config.tsx can delegate to it. Cover cropping lives in
 * globals.css (`[data-release-cover]`), same approach as the Gallery block.
 */

export type ResolvedRelease = {
  title: string;
  /** Null when the artist hasn't uploaded cover art → themed placeholder. */
  coverImage: ImageMetadata | null;
  /** Raw value: "album" | "ep" | "single" (or "" if unset). */
  releaseType: string;
  /** ISO date string, or "" when undated. */
  releaseDate: string;
  description: string;
};

const RELEASE_TYPE_LABELS: Record<string, string> = {
  album: "Album",
  ep: "EP",
  single: "Single",
};

/** "Album · 2026" — type label + release year, omitting whichever is unset. */
function metaLine(releaseType: string, releaseDate: string): string {
  const typeLabel = RELEASE_TYPE_LABELS[releaseType] ?? "";
  const ms = Date.parse(releaseDate);
  const year = Number.isNaN(ms) ? "" : String(new Date(ms).getUTCFullYear());
  return [typeLabel, year].filter(Boolean).join(" · ");
}

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: "var(--space-5)",
};

const titleStyle: CSSProperties = {
  margin: "var(--space-2) 0 0",
  fontSize: "var(--font-size-base)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text)",
};

const metaStyle: CSSProperties = {
  margin: "var(--space-1) 0 0",
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
};

const descStyle: CSSProperties = {
  ...metaStyle,
  lineHeight: "var(--line-height-base)",
};

export function ReleasesList({ items }: { items: ResolvedRelease[] }) {
  if (items.length === 0) {
    return (
      <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
        No releases yet — add one in the Releases panel.
      </p>
    );
  }
  return (
    <div style={gridStyle}>
      {items.map((release, i) => {
        const meta = metaLine(release.releaseType, release.releaseDate);
        return (
          <article key={i}>
            <div data-release-cover>
              {release.coverImage ? (
                <PublicImage image={release.coverImage} sizes="(max-width: 768px) 50vw, 25vw" />
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
            <h3 style={titleStyle}>{release.title}</h3>
            {meta ? <p style={metaStyle}>{meta}</p> : null}
            {release.description ? <p style={descStyle}>{release.description}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

/** Editor stand-in — the live data only resolves on the published page. */
export function ReleasesPlaceholder() {
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
      Your releases appear here — add them in the Releases panel.
    </div>
  );
}
