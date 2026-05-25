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
 * JSON-body parse, a local atomic write FIRST, then publish via the
 * `collection-def` target, with a `PublishError` → `{ ok: true,
 * publishWarning }` fallback so a publish failure still leaves the
 * artist with a usable local copy (the next save retries the publish).
 *
 * The slug is derived from `pluralName`, validated with `slugSchema`,
 * and checked against `listCollectionSlugs()` (which already includes
 * the prebaked pages/site/header/appearance singletons + every
 * existing collection — so the collision check doubles as a
 * reserved-name guard).
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  collectionDefRepoPath,
  collectionDefSchema,
  CURRENT_COLLECTION_SCHEMA_VERSION,
  generateFieldId,
  listCollectionSlugs,
  slugifyToCollectionSlug,
  slugSchema,
  type CollectionDef,
} from "@/lib/collections";
import { localPathForRepoPath, writeJsonAtomic } from "@/lib/fs-helpers";
import { PublishError, saveToDraft } from "@/lib/publish";

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
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

  const pluralNameRaw =
    body && typeof body === "object"
      ? (body as { pluralName?: unknown }).pluralName
      : undefined;
  const singularNameRaw =
    body && typeof body === "object"
      ? (body as { singularName?: unknown }).singularName
      : undefined;
  const isSingletonRaw =
    body && typeof body === "object"
      ? (body as { isSingleton?: unknown }).isSingleton
      : undefined;

  if (typeof pluralNameRaw !== "string" || typeof singularNameRaw !== "string") {
    return err(400, "pluralName and singularName are required");
  }
  const pluralName = pluralNameRaw.trim();
  const singularName = singularNameRaw.trim();
  if (pluralName.length === 0) return err(400, "Plural name can't be blank");
  if (singularName.length === 0) return err(400, "Singular name can't be blank");
  if (isSingletonRaw !== undefined && typeof isSingletonRaw !== "boolean") {
    return err(400, "isSingleton must be a boolean");
  }
  const isSingleton = isSingletonRaw ?? false;

  // Derive + validate the slug from the plural name.
  const slug = slugifyToCollectionSlug(pluralName);
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) {
    return err(
      400,
      "Couldn't derive a valid URL slug from that plural name — use letters or digits",
    );
  }

  // Collision / reserved-name guard. `listCollectionSlugs()` returns
  // every on-disk collection, which includes the prebaked
  // pages/site/header/appearance singletons + everything else, so this
  // single check covers reserved names too.
  const existing = await listCollectionSlugs();
  if (existing.includes(parsedSlug.data)) {
    return err(409, "A collection with that name already exists");
  }

  // Build the initial def: one default "Title" text field. For a
  // multi-item collection that field is the slug source (so new items
  // get a sensible auto-slug); singletons store under the fixed
  // `_singleton` filename and have no slug source — matching the
  // prebaked singletons in seeds.ts (`slugSourceFieldId: null`).
  const titleFieldId = generateFieldId();
  const def: CollectionDef = collectionDefSchema.parse({
    schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
    slug: parsedSlug.data,
    singularName,
    pluralName,
    fields: [
      {
        id: titleFieldId,
        key: "title",
        type: "text",
        required: true,
        // No `systemLocked` — the artist can rename or remove it.
      },
    ],
    slugSourceFieldId: isSingleton ? null : titleFieldId,
    detailUrlPrefix: null,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton,
  });

  // Local-write-first: write `_collection.json` atomically before the
  // publish call so a publish failure leaves the artist with a usable
  // local copy. Mirrors the schema route's write path
  // (`writeJsonAtomic` + `collectionDefRepoPath` + `collectionDefSchema`
  // parse on the bytes).
  await writeJsonAtomic(
    localPathForRepoPath(collectionDefRepoPath(parsedSlug.data)),
    collectionDefSchema.parse(def),
  );

  try {
    const result = await saveToDraft({
      targets: [
        {
          kind: "collection-def",
          collectionSlug: parsedSlug.data,
          data: def,
        },
      ],
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
    if (cause instanceof PublishError) {
      return NextResponse.json({
        ok: true,
        slug: parsedSlug.data,
        def,
        mode: "local",
        commitSha: null,
        publishWarning: cause.message,
      });
    }
    throw cause;
  }
}
