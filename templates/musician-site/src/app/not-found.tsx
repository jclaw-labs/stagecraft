import type { Metadata } from "next";
import DefaultNotFound from "next/dist/client/components/builtin/not-found";

import PublicLayout, { generateMetadata as generatePublicLayoutMetadata } from "./(public)/layout";
import { getFsReadStore } from "@/lib/collections";
import { readSiteConfig } from "@/lib/content";

/**
 * Root 404 for every URL no route serves.
 *
 * The public catch-all is prerendered with `dynamicParams = false`, so
 * an unknown URL never reaches it and Next serves this page instead.
 * Wrapping Next's own 404 UI in the public layout keeps the artist's
 * theme (appearance tokens, fonts, page background, favicon), matching
 * what the catch-all's `notFound()` rendered when it ran per request.
 */
export default function NotFound() {
  return (
    <PublicLayout>
      <DefaultNotFound />
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
