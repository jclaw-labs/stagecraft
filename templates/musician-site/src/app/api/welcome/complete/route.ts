/**
 * POST /api/welcome/complete
 *
 * Atomic completion of the first-run wizard. Writes:
 *
 *   - site singleton: artistName, siteTitle (derived), copyrightName
 *     (derived), and hasCompletedFirstRun=true
 *   - appearance singleton: the chosen theme's palette + typography,
 *     or — with no theme — primary color → accent
 *   - header singleton: the chosen theme's header style + wordmark
 *     (when provided), or — with no theme — wordmark only
 *   - pages collection: a "Home" item from the wizard's first-page
 *     title — the atmospheric-demo body when seedContent is set, a
 *     blank page (title heading only) for an empty start
 *   - tour-dates collection: two illustrative items (only when
 *     seedContent is set and the collection is empty — idempotent)
 *
 * Idempotent guard: if the site already has `hasCompletedFirstRun:true`
 * the route returns 409 — the only way back into the wizard is through
 * the reset endpoint, which clears the flag first.
 *
 * All targets go through `saveContent` (publishing to main) in one call
 * so the entire onboarding lands as one commit ("Complete welcome
 * wizard"). Local disk is written in dev only; in production a failed
 * draft commit is a failed request, while a draft commit that landed
 * but couldn't be published to main answers `ok: true, published:
 * false, publishWarning` (the wizard is complete on the draft).
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
  getRequestReadStore,
  SINGLETON_ITEM_SLUG,
  writeOrder,
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
import { emptyPageData } from "@/lib/page-data";
import { PublishError, type PublishTarget } from "@/lib/publish";
import { planItemWrite, saveContent, saveFailureResponse } from "@/lib/save-content";
import { resolveTheme, THEME_IDS } from "@/lib/theme-presets";
import type { Appearance, HeaderConfig } from "@/lib/site-config-types";

import { upsertSingletonItem } from "../_shared";

const TOUR_DATES_SLUG = "tour-dates";

const requestSchema = z.object({
  artistName: z.string().min(1, "Artist name is required"),
  primaryColor: z.string().min(1, "Primary color is required"),
  wordmark: imageMetadataSchema.nullable().default(null),
  firstPageTitle: z.string().min(1, "First page title is required"),
  // Optional curated theme. When present it supplies the appearance
  // palette + header style; absent, the legacy "accent = primaryColor"
  // path runs.
  theme: z.enum(THEME_IDS).optional(),
  // When false ("start empty"), only the home-page shell + singletons
  // land — no demo blocks, no tour dates. Defaults true so a payload
  // without the field keeps seeding the demo content.
  seedContent: z.boolean().default(true),
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
  const { artistName, primaryColor, wordmark, firstPageTitle, theme, seedContent } =
    parsed.data;

  const store = await getRequestReadStore();

  // Idempotent guard. The wizard route already redirects completed sites
  // away — this is a belt-and-suspenders check for direct POSTs.
  const existingSite = await store.readSingleton("site", siteCollectionDef);
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
  // Appearance + header singletons. A chosen `theme` applies a full
  // preset palette + header style; absent a theme (the "custom colour"
  // / back-compat path) we swap only the accent and leave the header
  // untouched apart from the wordmark. Either way the artist-owned
  // wordmark survives.
  // ---------------------------------------------------------------
  const existingAppearanceItem = await store.readSingleton("appearance", appearanceCollectionDef);
  const existingHeaderItem = await store.readSingleton("header", headerCollectionDef);
  const existingHeaderConfig = headerConfigFromItem(existingHeaderItem);

  let nextAppearance: Appearance;
  let nextHeader: HeaderConfig;
  if (theme) {
    const resolved = resolveTheme(theme, existingHeaderConfig);
    nextAppearance = resolved.appearance;
    nextHeader = { ...resolved.header, wordmark: wordmark ?? resolved.header.wordmark };
  } else {
    nextAppearance = appearanceFromItem(existingAppearanceItem);
    nextAppearance.colors = { ...nextAppearance.colors, accent: primaryColor };
    nextHeader = { ...existingHeaderConfig, wordmark: wordmark ?? null };
  }

  const appearanceItem = upsertSingletonItem(
    existingAppearanceItem,
    appearanceToItemValues(nextAppearance),
  );
  const headerItem = upsertSingletonItem(
    existingHeaderItem,
    headerConfigToItemValues(nextHeader),
  );

  // ---------------------------------------------------------------
  // Pages collection — the Home page (uses pageDataToItem for parity
  // with the existing create-page path). With seedContent the artist
  // gets the atmospheric-demo body; an empty start gets a blank page
  // (just the title heading) under the same slug, so the public site
  // still renders.
  // ---------------------------------------------------------------
  const homeTitle = firstPageTitle.trim() || "Home";
  const homeData = seedContent ? seed.homePage.data : emptyPageData(homeTitle);
  const homeItem = pageDataToItem(seed.homePage.slug, homeData, {
    id: generateItemId(),
    showInNav: true,
  });

  // Starter pages (Music / About / Contact) so the nav isn't a single link.
  // Only on the content-ful start; an empty start keeps just the Home page.
  const starterPageItems = seedContent
    ? seed.starterPages.map((p) => ({
        slug: p.slug,
        item: pageDataToItem(p.slug, p.data, { id: generateItemId(), showInNav: true }),
      }))
    : [];
  // Home-first nav order (nav reads the pages collection's _order.json;
  // absent, it falls back to alphabetical, which would bury Home).
  const pageOrder = [seed.homePage.slug, ...starterPageItems.map((p) => p.slug)];

  // ---------------------------------------------------------------
  // Tour-dates seeds — only with seedContent, and only when the
  // collection is empty. Idempotent: if the artist had already added
  // tour-dates (or re-ran the wizard after the reset flow), we don't
  // duplicate.
  // ---------------------------------------------------------------
  const tourDatesDef = await store.readCollectionDef(TOUR_DATES_SLUG);
  const shouldSeedTourDates =
    seedContent &&
    tourDatesDef !== null &&
    (await store.listItemSlugs(TOUR_DATES_SLUG)).length === 0;

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
  // Build + validate every file in memory, then save everything in
  // one commit (local disk in dev only).
  //
  // In dev the site singleton is written LAST because that's where the
  // `hasCompletedFirstRun: true` flag lands. If any earlier write
  // throws (disk full, permission error), the flag is never set, the
  // welcome wizard re-runs on next visit, and the next attempt's
  // writes overwrite anything that did succeed. Set the flag first
  // and a partial failure strands the artist on an empty Pages list
  // with no path back into the wizard. (In production every target
  // goes into one draft commit, so order doesn't matter there. That
  // draft commit is then published to main as a second step; if only
  // that step fails, the wizard *is* complete on the draft, so the
  // route answers ok + `publishWarning` rather than "Save failed" —
  // a retry would get 409 from the guard above.)
  // ---------------------------------------------------------------
  const site = planItemWrite("site", SINGLETON_ITEM_SLUG, siteItem, siteCollectionDef);
  const appearance = planItemWrite(
    "appearance",
    SINGLETON_ITEM_SLUG,
    appearanceItem,
    appearanceCollectionDef,
  );
  const header = planItemWrite("header", SINGLETON_ITEM_SLUG, headerItem, headerCollectionDef);
  const home = planItemWrite("pages", seed.homePage.slug, homeItem, pagesCollectionDef);
  const starterPages = starterPageItems.map(({ slug, item }) =>
    planItemWrite("pages", slug, item, pagesCollectionDef),
  );
  const tourDates = tourDatesDef
    ? tourDateItems.map((item) => planItemWrite(TOUR_DATES_SLUG, item.slug, item, tourDatesDef))
    : [];
  const hasPageOrder = starterPageItems.length > 0;

  const targets: PublishTarget[] = [
    site.target,
    appearance.target,
    header.target,
    home.target,
    ...starterPages.map((p) => p.target),
    ...(hasPageOrder
      ? [{ kind: "collection-order" as const, collectionSlug: "pages", data: pageOrder }]
      : []),
    ...tourDates.map((t) => t.target),
  ];

  try {
    const result = await saveContent({
      targets,
      writeLocal: async () => {
        await appearance.writeLocal();
        await header.writeLocal();
        await home.writeLocal();
        for (const page of starterPages) await page.writeLocal();
        if (hasPageOrder) await writeOrder("pages", pageOrder);
        for (const tourDate of tourDates) await tourDate.writeLocal();
        await site.writeLocal();
      },
      publishTo: "main",
      authorEmail: session.email,
      commitSubject: "Complete welcome wizard",
    });
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      commitSha: result.commitSha,
      ...(result.publishWarning
        ? { published: false, publishWarning: result.publishWarning }
        : {}),
    });
  } catch (cause) {
    if (cause instanceof PublishError) return saveFailureResponse(cause);
    throw cause;
  }
}
