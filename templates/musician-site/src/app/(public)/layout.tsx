import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";

import { AppearanceStyles } from "@/components/AppearanceStyles";
import { readAppearance, readSiteConfig } from "@/lib/content";
import type { ImageMetadata } from "@/lib/image-types";

/**
 * Public-site layout wrapper.
 *
 * Loaded only by routes inside `src/app/(public)/` — not by `/admin` or
 * `/api/*`. Injects the appearance-driven CSS variables and Google Fonts
 * link so every public page renders with the artist's chosen palette and
 * typography without each page handler having to opt in.
 *
 * Header + Footer are rendered per-page (not here) so individual pages can
 * suppress them (splash pages skip both; the per-page "Hide footer" toggle
 * drops just the footer).
 *
 * Site-level chrome surfaced here (parity with the legacy template):
 *   - `siteConfig.favicon` → `<link rel="icon">` via Next's metadata API
 *   - `siteConfig.pageBackground` → CSS `background-image` on the
 *     `.stagecraft-site` wrapper
 */
export async function generateMetadata(): Promise<Metadata> {
  const site = await readSiteConfig();
  if (!site.favicon) return {};
  return { icons: { icon: imageOriginalUrl(site.favicon) } };
}

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [appearance, site] = await Promise.all([readAppearance(), readSiteConfig()]);

  // CSS-background approach (not a `<picture>` underlay) because a
  // background needs `background-size` / `background-position` /
  // `background-attachment` controls that `<picture>` doesn't surface.
  // Uses the original upload, not a sharp variant — variants ≤
  // source width may not exist (the artist uploaded a 256x256
  // favicon, etc.), and the variant pipeline isn't sized for full-
  // viewport background bandwidth tuning yet. Future: pick the
  // largest variant ≤ viewport width via JS, or render a `<picture>`
  // underlay positioned absolute.
  const wrapperStyle: CSSProperties | undefined = site.pageBackground
    ? {
        backgroundImage: `url("${imageOriginalUrl(site.pageBackground)}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }
    : undefined;

  return (
    <div className="stagecraft-site" style={wrapperStyle}>
      <AppearanceStyles appearance={appearance} />
      {children}
    </div>
  );
}

/**
 * Path to the original uploaded image on disk. Used for the two
 * site-level image fields (favicon, pageBackground) where a single
 * URL is wanted rather than the responsive `<picture>` srcSet the
 * `Image` component emits.
 */
function imageOriginalUrl(image: ImageMetadata): string {
  return `/images/${image.contentSlug}/${image.id}/original.${image.originalExt}`;
}
