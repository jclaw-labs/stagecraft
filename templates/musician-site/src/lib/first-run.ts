/**
 * First-run onboarding detection.
 *
 * The `/admin` redirect consults `checkIsFirstRun` to decide whether
 * to land the artist on `/admin/welcome` (the wizard) or `/admin/pages`
 * (the steady-state home). The flag lives on `siteConfig`
 * (`hasCompletedFirstRun`) so it's a single field write that goes
 * through the same publish path as any other content edit — no
 * separate boot-flag file.
 *
 * Memoised via `React.cache` so multiple consumers in a single
 * Server Component render (e.g. the redirect + a sidebar pill) share
 * one read of the site singleton.
 */

import { cache } from "react";

import { readSiteConfig } from "./content";

/**
 * Returns true when the welcome wizard has not yet been completed
 * (or the site singleton doesn't exist on disk yet — the absent
 * field defaults to false in `siteConfigFromItem`).
 *
 * Pure read, no writes. The wizard's `POST /api/welcome/complete`
 * sets the flag to true; the reset endpoint flips it back to false.
 */
export const checkIsFirstRun = cache(async (): Promise<boolean> => {
  const siteConfig = await readSiteConfig();
  return !siteConfig.hasCompletedFirstRun;
});
