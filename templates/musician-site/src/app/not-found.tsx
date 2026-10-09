import type { Metadata } from "next";
import Link from "next/link";

import PublicLayout, { generateMetadata as generatePublicLayoutMetadata } from "./(public)/layout";
import { getFsReadStore } from "@/lib/collections";
import { readSiteConfig } from "@/lib/content";

/**
 * Root 404 for every URL no route serves.
 *
 * The public catch-all is prerendered with `dynamicParams = false`, so
 * an unknown URL never reaches it and Next serves this page instead.
 * Rendering inside the public layout keeps the artist's theme
 * (appearance tokens, fonts, page background, favicon), matching what
 * the catch-all's `notFound()` rendered when it ran per request.
 *
 * The body is local rather than Next's built-in 404 UI, which lives
 * under an internal `next/dist` path a Next upgrade could move. Its
 * colours, type and spacing come from theme tokens or the theme's own
 * element rules, so it follows the artist's palette and fonts.
 *
 * `/admin/*` has its own `admin/not-found.tsx` in the admin look.
 */
export default function NotFound() {
  return (
    <PublicLayout>
      <main
        style={{
          // One viewport tall, with border-box keeping the padding inside
          // that height at any theme density. The page still scrolls by
          // the body's UA margin (8px each side) because nothing resets
          // it: AppearanceStyles' `.stagecraft-site body` selector never
          // matches, since <body> is never inside the wrapper. That same
          // margin is the light frame around every public page, and #388
          // owns the fix (a `body:has(> .stagecraft-site)` rule). Once it
          // lands, this height is exact, with no margin arithmetic here.
          boxSizing: "border-box",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-8) var(--space-4)",
          textAlign: "center",
        }}
      >
        {/* Unstyled on purpose: the theme's own h1 rule sets its font,
            weight and display scale. */}
        <h1 style={{ margin: 0 }}>404</h1>
        <p
          style={{
            margin: "var(--space-2) 0 var(--space-6)",
            color: "var(--color-text-muted)",
            lineHeight: "var(--line-height-base)",
          }}
        >
          This page could not be found.
        </p>
        <Link href="/">Back to home</Link>
      </main>
    </PublicLayout>
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
