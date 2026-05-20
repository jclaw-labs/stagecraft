/**
 * POST /api/welcome/complete
 *
 * Atomic completion of the first-run wizard. Writes:
 *
 *   - site singleton: artistName, siteTitle (derived), copyrightName
 *     (derived), and hasCompletedFirstRun=true
 *   - appearance singleton: primary color → accent
 *   - header singleton: wordmark (when provided)
 *   - pages collection: a starter "Home" item built from the wizard's
 *     first-page title (atmospheric-demo body)
 *   - tour-dates collection: two illustrative items (if the collection
 *     is empty — idempotent)
 *
 * Idempotent guard: if the site already has `hasCompletedFirstRun:true`
 * the route returns 409 — the only way back into the wizard is through
 * the reset endpoint, which clears the flag first.
 *
 * All targets go through `publish()` in one call so the entire
 * onboarding lands as one commit ("Complete welcome wizard").
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import {
  appearanceCollectionDef,
  headerCollectionDef,
  pagesCollectionDef,
  siteCollectionDef,
} from "@/lib/collections/seeds";
import {
  buildItemFileSchema,
  generateItemId,
  readCollectionDef,
  readSingleton,
  SINGLETON_ITEM_SLUG,
  writeItem,
  writeSingleton,
  listItemSlugs,
  type Item,
} from "@/lib/collections";
import {
  appearanceFromItem,
  appearanceToItemValues,
  headerConfigFromItem,
  headerConfigToItemValues,
  siteConfigFromItem,
  siteConfigToItemValues,
} from "@/lib/collections/migrate-from-legacy-values";
import { pageDataToItem } from "@/lib/collections/migrate-from-legacy";
import { imageMetadataSchema } from "@/lib/image-types";
import { buildFirstRunSeed } from "@/lib/first-run-seeds";
import { PublishError, publish, type PublishTarget } from "@/lib/publish";

import { publishItemTarget, upsertSingletonItem } from "../_shared";

const TOUR_DATES_SLUG = "tour-dates";

const requestSchema = z.object({
  artistName: z.string().min(1, "Artist name is required"),
  primaryColor: z.string().min(1, "Primary color is required"),
  wordmark: imageMetadataSchema.nullable().default(null),
  firstPageTitle: z.string().min(1, "First page title is required"),
});

function err(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Body must be JSON");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return err(400, parsed.error.message);
  }
  const { artistName, primaryColor, wordmark, firstPageTitle } = parsed.data;

  // Idempotent guard. The wizard route already redirects completed sites
  // away — this is a belt-and-suspenders check for direct POSTs.
  const existingSite = await readSingleton("site", siteCollectionDef);
  const existingSiteConfig = siteConfigFromItem(existingSite);
  if (existingSiteConfig.hasCompletedFirstRun) {
    return err(409, "Welcome flow already completed. Use /api/welcome/reset to start over.");
  }

  // Build the seed payload up-front so we can validate it before
  // committing any writes.
  const seed = buildFirstRunSeed(artistName, firstPageTitle);

  // ---------------------------------------------------------------
  // Site singleton — keep existing values, swap in the wizard ones.
  // ---------------------------------------------------------------
  const nextSiteConfig = {
    ...existingSiteConfig,
    artistName,
    siteTitle: `${artistName} — Official Website`,
    copyrightName: artistName,
    hasCompletedFirstRun: true,
  };
  const siteItem = upsertSingletonItem(
    existingSite,
    siteConfigToItemValues(nextSiteConfig),
  );

  // ---------------------------------------------------------------
  // Appearance singleton — swap the accent color, keep everything else.
  // ---------------------------------------------------------------
  const existingAppearanceItem = await readSingleton("appearance", appearanceCollectionDef);
  const nextAppearance = appearanceFromItem(existingAppearanceItem);
  nextAppearance.colors = { ...nextAppearance.colors, accent: primaryColor };
  const appearanceItem = upsertSingletonItem(
    existingAppearanceItem,
    appearanceToItemValues(nextAppearance),
  );

  // ---------------------------------------------------------------
  // Header singleton — set wordmark if provided.
  // ---------------------------------------------------------------
  const existingHeaderItem = await readSingleton("header", headerCollectionDef);
  const nextHeader = headerConfigFromItem(existingHeaderItem);
  nextHeader.wordmark = wordmark ?? null;
  const headerItem = upsertSingletonItem(
    existingHeaderItem,
    headerConfigToItemValues(nextHeader),
  );

  // ---------------------------------------------------------------
  // Pages collection — home seed page (uses pageDataToItem for parity
  // with the existing create-page path).
  // ---------------------------------------------------------------
  const homeItem = pageDataToItem(seed.homePage.slug, seed.homePage.data, {
    id: generateItemId(),
    showInNav: true,
  });

  // ---------------------------------------------------------------
  // Tour-dates seeds — only when the collection is empty. Idempotent:
  // if the artist had already added tour-dates (or re-ran the wizard
  // after the reset flow), we don't duplicate.
  // ---------------------------------------------------------------
  const tourDatesDef = await readCollectionDef(TOUR_DATES_SLUG);
  const shouldSeedTourDates =
    tourDatesDef !== null &&
    (await listItemSlugs(TOUR_DATES_SLUG)).length === 0;

  const nowIso = new Date().toISOString();
  const tourDateItems: Item[] = [];
  if (shouldSeedTourDates && tourDatesDef) {
    const fileSchema = buildItemFileSchema(tourDatesDef.fields);
    for (const tourSeed of seed.tourDates) {
      const validated = fileSchema.safeParse({
        id: generateItemId(),
        createdAt: nowIso,
        updatedAt: nowIso,
        values: tourSeed.values,
      });
      if (!validated.success) {
        // Seeds are author-controlled — a failure here is a bug, not
        // an artist input mistake. Surface it loudly so it gets fixed.
        return err(
          500,
          `Tour-date seed failed validation: ${validated.error.message}`,
        );
      }
      tourDateItems.push({ ...validated.data, slug: tourSeed.slug });
    }
  }

  // ---------------------------------------------------------------
  // Write locally (admin runs against the local disk), then publish
  // everything in one commit.
  //
  // The site singleton goes LAST because that's where the
  // `hasCompletedFirstRun: true` flag lands. If any earlier write
  // throws (disk full, permission error), the flag is never set, the
  // welcome wizard re-runs on next visit, and the next attempt's
  // writes overwrite anything that did succeed. Set the flag first
  // and a partial failure strands the artist on an empty Pages list
  // with no path back into the wizard.
  // ---------------------------------------------------------------
  await writeSingleton("appearance", appearanceItem, appearanceCollectionDef);
  await writeSingleton("header", headerItem, headerCollectionDef);
  await writeItem("pages", seed.homePage.slug, homeItem, pagesCollectionDef);
  for (const item of tourDateItems) {
    await writeItem(TOUR_DATES_SLUG, item.slug, item, tourDatesDef!);
  }
  await writeSingleton("site", siteItem, siteCollectionDef);

  const targets: PublishTarget[] = [
    publishItemTarget("site", SINGLETON_ITEM_SLUG, siteItem),
    publishItemTarget("appearance", SINGLETON_ITEM_SLUG, appearanceItem),
    publishItemTarget("header", SINGLETON_ITEM_SLUG, headerItem),
    publishItemTarget("pages", seed.homePage.slug, homeItem),
    ...tourDateItems.map((item) => publishItemTarget(TOUR_DATES_SLUG, item.slug, item)),
  ];

  try {
    const result = await publish({
      targets,
      authorEmail: session.email,
      commitSubject: "Complete welcome wizard",
    });
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      commitSha: result.commitSha,
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
      // Local write succeeded — surface the publish error as a warning
      // so the artist isn't blocked. The next save retries the publish.
      return NextResponse.json({
        ok: true,
        mode: "local",
        commitSha: null,
        publishWarning: cause.message,
      });
    }
    throw cause;
  }
}

