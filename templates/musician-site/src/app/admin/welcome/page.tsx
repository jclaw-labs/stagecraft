import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { getRequestReadStore } from "@/lib/collections";
import { readAppearance, readSiteConfig } from "@/lib/content";
import { checkIsFirstRun } from "@/lib/first-run";
import { DEFAULT_SITE_CONFIG } from "@/lib/site-config-types";

import { WelcomeWizard } from "./WelcomeWizard";

/**
 * Gate on the first-run flag per request. When the build-time content
 * had finished the wizard, `next build` prerendered this route as a
 * fixed redirect to /admin/pages, so a reset site couldn't reach it.
 */
export const dynamic = "force-dynamic";

/**
 * First-run welcome wizard (PR 7 — Hybrid). Four steps drive the site
 * singleton, the appearance singleton (primary color), the header
 * singleton (wordmark), and create the first page. Sample tour dates
 * are seeded server-side at completion.
 *
 * The route gates on `checkIsFirstRun()` — re-visits after completion
 * bounce straight to /admin/pages so the wizard isn't a "back door"
 * that overwrites edits. Reset is the only path back into this route
 * once the flag is set (see /admin/settings's Danger zone).
 *
 * Pre-fills the wizard from the existing singletons so an artist who
 * partially completed the wizard, refreshed, and came back doesn't
 * lose what they typed mid-flow.
 */
export default async function AdminWelcomePage() {
  const isFirstRun = await checkIsFirstRun();
  if (!isFirstRun) redirect("/admin/pages");

  const storePromise = getRequestReadStore();
  const [session, site, appearance] = await Promise.all([
    getSession(),
    storePromise.then((s) => readSiteConfig(s)),
    storePromise.then((s) => readAppearance(s)),
  ]);

  // A fresh site (or one freshly reset) carries the DEFAULT_SITE_CONFIG
  // artist-name sentinel — show the wizard with a blank field rather
  // than pre-filling the placeholder string the artist would just
  // delete anyway.
  const prefillArtistName =
    site.artistName === DEFAULT_SITE_CONFIG.artistName ? "" : site.artistName;

  return (
    <WelcomeWizard
      email={session?.email ?? ""}
      initialArtistName={prefillArtistName}
      initialPrimaryColor={appearance.colors.accent}
    />
  );
}
