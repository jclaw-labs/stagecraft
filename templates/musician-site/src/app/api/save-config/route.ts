import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import {
  readSingleton,
  SINGLETON_ITEM_SLUG,
  generateItemId,
  type CollectionDef,
  type Item,
} from "@/lib/collections";
import {
  appearanceCollectionDef,
  headerCollectionDef,
  pagesCollectionDef,
  siteCollectionDef,
} from "@/lib/collections/seeds";
import {
  appearanceToItemValues,
  headerConfigToItemValues,
  siteConfigToItemValues,
} from "@/lib/collections/migrate-from-legacy";
import {
  writeAppearance,
  writeHeaderConfig,
  writeSiteConfig,
} from "@/lib/content";
import { PublishError, publish, type PublishTarget } from "@/lib/publish";
import {
  appearanceSchema,
  headerConfigSchema,
  siteConfigSchema,
  type SiteConfig,
} from "@/lib/site-config-types";
import { readItem, listItemSlugs } from "@/lib/collections";

/**
 * POST /api/save-config — persist one of the singletons (site, header,
 * appearance). The body discriminator identifies which. Site writes
 * fan out to the pages collection (per ADR-009 §14): `pageOrder`
 * lands in `items/_order.json`, `hiddenFromNav` flips per-page
 * `showInNav`.
 *
 * Local writes go first so the dev preview reflects the change
 * immediately, then we publish through the broker → GitHub path when
 * configured. A publish failure surfaces as a warning rather than
 * rolling back the local save.
 *
 * TODO (post-custom-panels): this endpoint's only remaining consumer
 * is `PagesPanel`'s drag-reorder + eye-toggle, which need to write
 * the pages-collection order file + per-page `showInNav`. The site /
 * header / appearance singleton panels now POST to
 * `PUT /api/collections/<slug>/items/_singleton` directly. To finish
 * the consolidation, replace this endpoint with a dedicated
 * `/api/collections/<slug>/order` endpoint plus the existing per-item
 * PUT for `showInNav` (fetch-modify-PUT pattern from the client).
 */

const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("site-config"), data: siteConfigSchema }),
  z.object({ kind: z.literal("header-config"), data: headerConfigSchema }),
  z.object({ kind: z.literal("appearance"), data: appearanceSchema }),
]);

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

  // Write to disk synchronously so the dev preview reflects the change.
  // Then construct the publish targets from the freshly-written state
  // — read-back guarantees the targets carry the canonical `id` and
  // timestamps the store just stamped.
  let targets: PublishTarget[];
  switch (parsed.data.kind) {
    case "site-config":
      await writeSiteConfig(parsed.data.data);
      targets = await siteConfigTargets(parsed.data.data);
      break;
    case "header-config":
      await writeHeaderConfig(parsed.data.data);
      targets = [
        await singletonTarget("header", headerCollectionDef, headerConfigToItemValues(parsed.data.data)),
      ];
      break;
    case "appearance":
      await writeAppearance(parsed.data.data);
      targets = [
        await singletonTarget(
          "appearance",
          appearanceCollectionDef,
          appearanceToItemValues(parsed.data.data),
        ),
      ];
      break;
  }

  try {
    const result = await publish({
      targets,
      authorEmail: session.email,
    });
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      commitSha: result.commitSha,
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
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

/**
 * Build the singleton's `collection-item` publish target by reading
 * the just-written item back. The read captures whatever `id`,
 * `createdAt`, and `updatedAt` the store assigned, so the commit
 * matches what's on disk exactly.
 */
async function singletonTarget(
  slug: string,
  def: CollectionDef,
  values: Item["values"],
): Promise<PublishTarget> {
  const existing = await readSingleton(slug, def);
  const now = new Date().toISOString();
  const item: Item = {
    id: existing?.id ?? generateItemId(),
    slug: SINGLETON_ITEM_SLUG,
    createdAt: existing?.createdAt ?? now,
    updatedAt: existing?.updatedAt ?? now,
    values,
  };
  return {
    kind: "collection-item",
    collectionSlug: slug,
    itemSlug: SINGLETON_ITEM_SLUG,
    data: {
      id: item.id,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      values: item.values,
    },
  };
}

/**
 * Site config fan-out: one singleton write + the pages-collection
 * order file + one collection-item per page whose `showInNav` changed.
 * Done after `writeSiteConfig` has applied the changes locally, so
 * the targets reflect the canonical on-disk state.
 */
async function siteConfigTargets(config: SiteConfig): Promise<PublishTarget[]> {
  const targets: PublishTarget[] = [
    await singletonTarget("site", siteCollectionDef, siteConfigToItemValues(config)),
    { kind: "collection-order", collectionSlug: "pages", data: config.pageOrder },
  ];
  // Re-read every page item so each commit carries the post-write
  // `showInNav` state plus a fresh `updatedAt`.
  const slugs = await listItemSlugs("pages");
  await Promise.all(
    slugs.map(async (slug) => {
      const item = await readItem("pages", slug, pagesCollectionDef);
      if (!item) return;
      targets.push({
        kind: "collection-item",
        collectionSlug: "pages",
        itemSlug: slug,
        data: {
          id: item.id,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          values: item.values,
        },
      });
    }),
  );
  return targets;
}
