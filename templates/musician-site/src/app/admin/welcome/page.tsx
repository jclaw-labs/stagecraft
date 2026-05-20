import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";
import { readAppearance, readSiteConfig } from "@/lib/content";
import { checkIsFirstRun } from "@/lib/first-run";

import { WelcomeWizard } from "./WelcomeWizard";

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

  const [session, site, appearance] = await Promise.all([
    getSession(),
    readSiteConfig(),
    readAppearance(),
  ]);

  return (
    <WelcomeWizard
      email={session?.email ?? ""}
      initialArtistName={site.artistName === "Artist Name" ? "" : site.artistName}
      initialPrimaryColor={appearance.colors.accent}
    />
  );
}
