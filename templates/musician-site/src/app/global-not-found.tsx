import type { Metadata } from "next";

import PublicLayout, { generateMetadata as generatePublicLayoutMetadata } from "./(public)/layout";
import PublicNotFound from "./(public)/not-found";
import { getFsReadStore } from "@/lib/collections";
import { readSiteConfig } from "@/lib/content";

import "./globals.css";

/**
 * 404 for every URL no route serves, in the artist's theme.
 *
 * Enabled by `experimental.globalNotFound` in `next.config.ts`. Unlike a
 * root `app/not-found.tsx`, Next renders this only for unmatched URLs.
 * It isn't part of every route's tree, so admin responses don't run
 * `readAppearance` / `readSiteConfig` or carry the public theme (#390).
 *
 * It bypasses the root layout, so it brings its own `<html>`, `<body>`
 * and global stylesheet.
 *
 * Unknown `/admin/*` URLs never get here: `admin/[...unknown]` catches
 * them and renders `admin/not-found.tsx`.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <PublicLayout>
          <PublicNotFound />
        </PublicLayout>
      </body>
    </html>
  );
}

/** Same tab title and favicon the catch-all gave an unknown URL. */
export async function generateMetadata(): Promise<Metadata> {
  const [layoutMetadata, site] = await Promise.all([
    generatePublicLayoutMetadata(),
    readSiteConfig(getFsReadStore()),
  ]);
  return { ...layoutMetadata, title: site.siteTitle, description: site.siteDescription };
}
