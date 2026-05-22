import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  findShadowingPrefix,
  getRequestReadStore,
  type CollectionDef,
  type ReadStore,
} from "@/lib/collections";
// Direct FS read for the post-write re-read: the new page is on local
// disk but `saveToDraft` hasn't published it yet, so the facade can't
// see it.
import { readItem as fsReadItem } from "@/lib/collections/store";
import { pagesCollectionDef, PREBAKED_COLLECTIONS } from "@/lib/collections/seeds";
import {
  emptyPageData,
  listPageSummaries,
  PageExistsError,
  readPageOrNull,
  writePage,
} from "@/lib/content";
import { PublishError, saveToDraft } from "@/lib/publish";
import { createPageRequestSchema } from "@/lib/site-config-types";

/**
 * GET  /api/pages         — list all pages with summary metadata
 * POST /api/pages         — create a new empty page (publishes in prod)
 *
 * Deletes are routed through /api/pages/[slug] so the URL identifies the
 * target unambiguously.
 */

function err(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Union of every collection def we know about: on-disk defs first
 * (so artist-added custom collections participate), supplemented by
 * any prebaked entry that isn't on disk yet (so fresh sites pre-
 * bootstrap still get the prebaked prefixes in the check).
 */
async function loadKnownCollectionDefs(store: ReadStore): Promise<CollectionDef[]> {
  const onDiskSlugs = await store.listCollectionSlugs();
  const onDiskDefs = (
    await Promise.all(onDiskSlugs.map((s) => store.readCollectionDef(s)))
  ).filter((d): d is CollectionDef => d !== null);
  const seen = new Set(onDiskDefs.map((d) => d.slug));
  return [
    ...onDiskDefs,
    ...Object.values(PREBAKED_COLLECTIONS).filter((d) => !seen.has(d.slug)),
  ];
}

export async function GET() {
  // Middleware gates this; double-check session here for defense in depth.
  const session = await getSession();
  if (!session) return err(401, "unauthorized");
  const pages = await listPageSummaries();
  return NextResponse.json({ ok: true, pages });
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

  const parsed = createPageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return err(400, parsed.error.message);
  }

  const { slug, title } = parsed.data;

  // Reject slugs that would shadow a known collection's detail URL
  // prefix (`/news`, `/releases`, `/shows`, plus any artist-added
  // custom collection's prefix). Without this check the page write
  // succeeds but every subsequent public request throws the routing-
  // conflict error from the catch-all — effectively a full-site
  // outage triggered by a name collision. We check the union of
  // on-disk defs and the prebaked registry: on-disk catches custom
  // collections; the registry union covers fresh sites where
  // bootstrap hasn't fired yet for some prebaked entries.
  const store = await getRequestReadStore();
  const knownDefs = await loadKnownCollectionDefs(store);
  const shadow = findShadowingPrefix(slug, knownDefs);
  if (shadow) {
    return err(
      409,
      `Cannot use slug "${slug}" — it shadows the "${shadow.collectionSlug}" collection's URL prefix "${shadow.detailUrlPrefix}". Pick a different slug.`,
    );
  }

  if (await readPageOrNull(slug)) {
    return err(409, new PageExistsError(slug).message);
  }

  const data = emptyPageData(title);

  // Always persist locally so the dev workflow works without the broker. In
  // prod the same write is followed by a GitHub commit so the new page is
  // immediately deployable.
  await writePage(slug, data);
  // Re-read so the publish target carries the canonical id + timestamps
  // the collection store just stamped on the new item. Direct FS read:
  // the write only landed on local disk until `saveToDraft` below
  // commits it.
  const item = await fsReadItem("pages", slug, pagesCollectionDef);
  if (!item) return err(500, "Page disappeared between write and publish");

  try {
    const result = await saveToDraft({
      targets: [
        {
          kind: "collection-item",
          collectionSlug: "pages",
          itemSlug: slug,
          data: {
            id: item.id,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            values: item.values,
          },
        },
      ],
      authorEmail: session.email,
      commitSubject: `Create page ${slug}`,
    });
    return NextResponse.json({
      ok: true,
      slug,
      mode: result.mode,
      commitSha: result.commitSha,
    });
  } catch (cause) {
    // Local write succeeded; report the commit failure but don't roll back.
    // Without the rollback the artist keeps a usable local page; the commit
    // can be retried by editing-and-publishing from the page editor.
    if (cause instanceof PublishError) {
      return NextResponse.json(
        { ok: true, slug, mode: "local", commitSha: null, publishWarning: cause.message },
        { status: 200 },
      );
    }
    throw cause;
  }
}
