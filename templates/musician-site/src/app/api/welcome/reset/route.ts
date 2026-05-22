/**
 * POST /api/welcome/reset
 *
 * Destructive — clears the site back to a "fresh" state so the
 * welcome wizard can run again. Deletes every page item, every
 * collection item the artist has added, and resets the three
 * singletons to their defaults (which also flips
 * `hasCompletedFirstRun` back to false).
 *
 * The four prebaked _collection.json definitions are kept — they're
 * the schema, not the content. Custom collections the artist added
 * (via the schema editor in a later PR) are kept too; only their
 * items get cleared.
 *
 * Confirmation lives in the UI (the danger-zone modal asks for the
 * artist name and a typed "delete my content" string). This route
 * trusts a signed-in session; the UI is the gatekeeper.
 *
 * Body: `{ confirmArtistName: string }` — must match the current
 * site singleton's `artistName` exactly. Mismatch returns 400 so a
 * mis-fired POST can't wipe a site by accident.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import {
  appearanceCollectionDef,
  headerCollectionDef,
  siteCollectionDef,
} from "@/lib/collections/seeds";
import {
  deleteItem,
  getRequestReadStore,
  SINGLETON_ITEM_SLUG,
  writeSingleton,
} from "@/lib/collections";
import {
  appearanceToItemValues,
  headerConfigToItemValues,
  siteConfigFromItem,
  siteConfigToItemValues,
} from "@/lib/collections/migrate-from-legacy-values";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_HEADER_CONFIG,
  DEFAULT_SITE_CONFIG,
} from "@/lib/site-config-types";
import { PublishError, publish, type PublishTarget } from "@/lib/publish";

import { publishItemTarget, upsertSingletonItem } from "../_shared";

const requestSchema = z.object({
  confirmArtistName: z.string().min(1),
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

  const store = await getRequestReadStore();

  // Confirm against the current artist name. Case + whitespace
  // insensitive so the artist isn't tripped up by a leading space.
  const siteItem = await store.readSingleton("site", siteCollectionDef);
  const siteConfig = siteConfigFromItem(siteItem);
  if (
    parsed.data.confirmArtistName.trim().toLowerCase() !==
    siteConfig.artistName.trim().toLowerCase()
  ) {
    return err(400, "Confirmation didn't match the current artist name.");
  }

  // ---------------------------------------------------------------
  // Build the publish targets. Every page + collection item the
  // artist has added gets a `delete-collection-item` entry. The
  // three singletons get fresh default values + the flag cleared.
  // ---------------------------------------------------------------
  const deleteTargets: PublishTarget[] = [];
  const collectionSlugs = await store.listCollectionSlugs();
  for (const collectionSlug of collectionSlugs) {
    const def = await store.readCollectionDef(collectionSlug);
    if (!def) continue;
    // Singletons can't be deleted — they're cleared by the singleton
    // write loop below.
    if (def.isSingleton) continue;
    const itemSlugs = await store.listItemSlugs(collectionSlug);
    for (const itemSlug of itemSlugs) {
      deleteTargets.push({
        kind: "delete-collection-item",
        collectionSlug,
        itemSlug,
      });
    }
  }

  // Reset singletons to defaults. We pull the existing item to
  // preserve its `id` + `createdAt` (the publish history is cleaner
  // when the on-disk id is stable across resets).
  const existingAppearance = await store.readSingleton("appearance", appearanceCollectionDef);
  const existingHeader = await store.readSingleton("header", headerCollectionDef);

  const resetSite = upsertSingletonItem(
    siteItem,
    siteConfigToItemValues({
      ...DEFAULT_SITE_CONFIG,
      // hasCompletedFirstRun: false is what makes this a "reset" —
      // /admin will bounce the artist back into the wizard.
      hasCompletedFirstRun: false,
    }),
  );
  const resetAppearance = upsertSingletonItem(
    existingAppearance,
    appearanceToItemValues(DEFAULT_APPEARANCE),
  );
  const resetHeader = upsertSingletonItem(
    existingHeader,
    headerConfigToItemValues(DEFAULT_HEADER_CONFIG),
  );

  // Local-disk first, then publish atomically.
  await writeSingleton("site", resetSite, siteCollectionDef);
  await writeSingleton("appearance", resetAppearance, appearanceCollectionDef);
  await writeSingleton("header", resetHeader, headerCollectionDef);
  for (const target of deleteTargets) {
    if (target.kind !== "delete-collection-item") continue;
    await deleteItem(target.collectionSlug, target.itemSlug);
  }

  const targets: PublishTarget[] = [
    publishItemTarget("site", SINGLETON_ITEM_SLUG, resetSite),
    publishItemTarget("appearance", SINGLETON_ITEM_SLUG, resetAppearance),
    publishItemTarget("header", SINGLETON_ITEM_SLUG, resetHeader),
    ...deleteTargets,
  ];

  try {
    const result = await publish({
      targets,
      authorEmail: session.email,
      commitSubject: "Reset site to first-run state",
    });
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      commitSha: result.commitSha,
      itemsDeleted: deleteTargets.length,
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
      return NextResponse.json({
        ok: true,
        mode: "local",
        commitSha: null,
        itemsDeleted: deleteTargets.length,
        publishWarning: cause.message,
      });
    }
    throw cause;
  }
}

