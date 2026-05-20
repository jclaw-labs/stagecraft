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
 * Reads only the site singleton on disk — NOT `readSiteConfig`, which
 * also scans the pages directory + reads the order file. Every /admin
 * visit hits this redirect, so the check has to be a single file read.
 * Memoised via `React.cache` so multiple consumers in a single Server
 * Component render (e.g. the redirect + a sidebar pill) share that
 * read.
 */

import { cache } from "react";

import { readSingleton } from "./collections";
import { SITE_FIELD_IDS, siteCollectionDef } from "./collections/seeds";

/**
 * Returns true when the welcome wizard has not yet been completed
 * (or the site singleton doesn't exist on disk yet — same end result).
 *
 * Pure read, no writes. The wizard's `POST /api/welcome/complete`
 * sets the flag to true; the reset endpoint flips it back to false.
 */
export const checkIsFirstRun = cache(async (): Promise<boolean> => {
  const item = await readSingleton("site", siteCollectionDef);
  const flag = item?.values[SITE_FIELD_IDS.hasCompletedFirstRun];
  return !(flag?.type === "boolean" && flag.value === true);
});

