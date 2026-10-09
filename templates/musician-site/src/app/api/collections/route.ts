/**
 * POST /api/collections — create a brand-new collection (ADR-009
 * follow-up: the artist-facing entry point to make a collection from
 * `/admin`).
 *
 * Everything downstream of a collection already works for any on-disk
 * collection — the schema editor, the generic item editor, the dynamic
 * Puck blocks, and the public catch-all router all read collections
 * from disk via `listCollectionSlugs()`. The only missing piece was
 * the act of creating one; this route is it.
 *
 * Body: `{ pluralName, singularName, isSingleton? }`.
 *
 * The route mirrors `[slug]/schema/route.ts`: `getSession()` auth,
 * JSON-body parse, then `saveContent` with the `collection-def` target
 * (a local write in dev only; in production a failed commit is a
 * failed save — see `@/lib/save-content`).
 *
 * The slug is derived from `pluralName`, validated with `slugSchema`,
 * then guarded two ways: a static check against `PREBAKED_COLLECTIONS`
 * (reserved names — robust even if the on-disk/draft listing is
 * momentarily incomplete) and a draft-aware existence check via the
 * per-request read store (so a collection created earlier in the same
 * draft session is seen).
 *
 * A multi-item collection starts with one default "Title" field (its
 * slug source). A singleton starts with no fields and no `_singleton.json`
 * item: the item is materialized lazily on first save (matching the
 * prebaked singletons), and the create form routes the artist to the
 * schema editor to define fields next.
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  collectionDefRepoPath,
  collectionDefSchema,
  createCollectionRequestSchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  generateFieldId,
  getRequestReadStore,
  slugifyToCollectionSlug,
  slugSchema,
  type CollectionDef,
} from "@/lib/collections";
import { PREBAKED_COLLECTIONS } from "@/lib/collections/seeds";
import { localPathForRepoPath, writeJsonAtomic } from "@/lib/fs-helpers";
import { PublishError } from "@/lib/publish";
import { saveContent, saveFailureResponse } from "@/lib/save-content";

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return err(400, "Body must be JSON");
  }

  // One Zod parse covers presence, type, trimming, length bounds, and
  // the no-line-break rule (the names are interpolated into a git
  // commit subject below — a newline would inject extra commit lines).
  const parsedBody = createCollectionRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return err(400, parsedBody.error.issues[0]?.message ?? "Invalid request body");
  }
  const { pluralName, singularName, isSingleton = false } = parsedBody.data;

  // Derive + validate the slug from the plural name.
  const slug = slugifyToCollectionSlug(pluralName);
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) {
    return err(
      400,
      "Couldn't derive a valid URL slug from that plural name — use letters or digits",
    );
  }

  // Reserved-name guard, independent of disk / draft state. The
  // prebaked collections (pages/site/header/appearance + the starter
  // content collections) ship with every site; an artist must not be
  // able to create one whose slug collides with a prebaked def and
  // overwrite it. Checking the static map closes that hole even when
  // the on-disk / draft listing is momentarily incomplete (fresh draft
  // branch, FS-snapshot fallback, …).
  if (Object.hasOwn(PREBAKED_COLLECTIONS, parsedSlug.data)) {
    return err(409, "That name is reserved");
  }

  // Collision guard against existing collections. Read through the
  // per-request store so this is draft-aware in production: a
  // collection created earlier in the same draft session lives on the
  // draft branch, not yet on the deployed FS snapshot of `main`.
  const store = await getRequestReadStore();
  const existing = await store.listCollectionSlugs();
  if (existing.includes(parsedSlug.data)) {
    return err(409, "A collection with that name already exists");
  }

  // Build the initial def. A multi-item collection starts with one
  // default "Title" text field that doubles as the slug source (so new
  // items get a sensible auto-slug). A singleton has no slug and no
  // list view, so it starts with no fields at all — the artist defines
  // them in the schema editor next (the create form routes there). Its
  // `_singleton.json` item is materialized lazily on first save,
  // matching the prebaked singletons whose read paths fall back to
  // defaults until then; seeding an empty item here would instead block
  // the artist from adding any *required* field, since the schema
  // validator rejects an existing item that lacks it.
  // Multi-item only: one default "Title" field, which is also the slug
  // source. A singleton gets neither (no fields, null slug source).
  const titleFieldId = isSingleton ? null : generateFieldId();
  const def: CollectionDef = collectionDefSchema.parse({
    schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
    slug: parsedSlug.data,
    singularName,
    pluralName,
    fields: titleFieldId
      ? [
          {
            id: titleFieldId,
            key: "title",
            type: "text",
            required: true,
            // No `systemLocked` — the artist can rename or remove it.
          },
        ]
      : [],
    slugSourceFieldId: titleFieldId,
    detailUrlPrefix: null,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton,
  });

  try {
    const result = await saveContent({
      targets: [
        {
          kind: "collection-def",
          collectionSlug: parsedSlug.data,
          data: def,
        },
      ],
      writeLocal: () =>
        writeJsonAtomic(
          localPathForRepoPath(collectionDefRepoPath(parsedSlug.data)),
          collectionDefSchema.parse(def),
        ),
      authorEmail: session.email,
      commitSubject: `Create ${pluralName} collection`,
    });
    return NextResponse.json({
      ok: true,
      slug: parsedSlug.data,
      def,
      mode: result.mode,
      commitSha: result.commitSha,
    });
  } catch (cause) {
    if (cause instanceof PublishError) return saveFailureResponse(cause);
    throw cause;
  }
}
