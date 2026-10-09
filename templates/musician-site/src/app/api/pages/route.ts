import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  findShadowingPrefix,
  getRequestReadStore,
  type CollectionDef,
  type ReadStore,
} from "@/lib/collections";
import { pagesCollectionDef, PREBAKED_COLLECTIONS } from "@/lib/collections/seeds";
import {
  buildPageItem,
  emptyPageData,
  listPageSummaries,
  PageExistsError,
  readPageOrNull,
} from "@/lib/content";
import { PublishError } from "@/lib/publish";
import { planItemWrite, saveContent, saveFailureResponse } from "@/lib/save-content";
import { createPageRequestSchema } from "@/lib/site-config-types";

/**
 * GET  /api/pages         — list all pages with summary metadata
 * POST /api/pages         — create a new empty page (commits to draft in prod)
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
  const store = await getRequestReadStore();
  const pages = await listPageSummaries(store);
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

  if (await readPageOrNull(slug, store)) {
    return err(409, new PageExistsError(slug).message);
  }

  const data = emptyPageData(title);

  // Built in memory; committed to the draft branch in production, and
  // written to local disk only in dev.
  const planned = planItemWrite(
    "pages",
    slug,
    await buildPageItem(slug, data, store),
    pagesCollectionDef,
  );

  try {
    const result = await saveContent({
      targets: [planned.target],
      writeLocal: planned.writeLocal,
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
    if (cause instanceof PublishError) return saveFailureResponse(cause);
    throw cause;
  }
}
