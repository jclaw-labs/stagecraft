/**
 * GET / PUT / DELETE one item in any collection (ADR-009 PR 4).
 *
 * The slug pair (`collectionSlug`, `itemSlug`) addresses the file at
 * `src/content/collections/<collectionSlug>/items/<itemSlug>.json`.
 *
 * Every item editor saves through here, including the page editor and
 * the Pages panel (pages are the `pages` collection).
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  buildItemFileSchema,
  deleteItem,
  generateItemId,
  getRequestReadStore,
  isSingletonItem,
  ItemExistsError,
  itemCommitSubject,
  itemSlugSchema,
  renameCommitSubject,
  slugSchema,
  writeOrder,
} from "@/lib/collections";
import { pageSlugShadowError } from "@/lib/collections/page-slug-shadow";
import { PublishError, type PublishTarget } from "@/lib/publish";
import { planItemWrite, saveContent, saveFailureResponse } from "@/lib/save-content";

import { zodIssuesToStructured } from "./issue-format";

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

type Ctx = { params: Promise<{ slug: string; itemSlug: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  const { slug: collectionSlug, itemSlug } = await ctx.params;
  const parsedCollectionSlug = slugSchema.safeParse(collectionSlug);
  const parsedItemSlug = itemSlugSchema.safeParse(itemSlug);
  if (!parsedCollectionSlug.success || !parsedItemSlug.success) {
    return err(400, "Invalid slug");
  }

  const store = await getRequestReadStore();
  const def = await store.readCollectionDef(parsedCollectionSlug.data);
  if (!def) return err(404, `Collection "${parsedCollectionSlug.data}" not found`);

  const item = await store.readItem(parsedCollectionSlug.data, parsedItemSlug.data, def);
  if (!item) return err(404, "Item not found");

  return NextResponse.json({ ok: true, item, def });
}

export async function PUT(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  const { slug: collectionSlug, itemSlug } = await ctx.params;
  const parsedCollectionSlug = slugSchema.safeParse(collectionSlug);
  const parsedItemSlug = itemSlugSchema.safeParse(itemSlug);
  if (!parsedCollectionSlug.success || !parsedItemSlug.success) {
    return err(400, "Invalid slug");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Body must be JSON");
  }

  const store = await getRequestReadStore();
  const def = await store.readCollectionDef(parsedCollectionSlug.data);
  if (!def) return err(404, `Collection "${parsedCollectionSlug.data}" not found`);

  // PUT is update-only for multi-item collections — creation lives on
  // POST. Without this guard a PUT to a missing slug would silently
  // create a fresh item with a brand-new id, racing any concurrent POST
  // to the same slug from another tab.
  //
  // Singletons are the exception: there's exactly one item at the fixed
  // `_singleton` slug and no POST flow to create it, so the first save
  // *is* the creation. Materialize it here (fresh id, createdAt now)
  // instead of 404ing — matching the prebaked singletons, which also
  // come into existence on first save.
  const existing = await store.readItem(parsedCollectionSlug.data, parsedItemSlug.data, def);
  const isSingletonFirstSave = !existing && isSingletonItem(def, parsedItemSlug.data);
  if (!existing && !isSingletonFirstSave) return err(404, "Item not found");

  // Build the per-collection Zod schema from `def.fields` and run the
  // incoming item through it. This is where required-field / option /
  // mime-filter validation actually happens — the publish layer only
  // does the structural shell check.
  const fileSchema = buildItemFileSchema(def.fields);
  const valuesShape = body && typeof body === "object" && "values" in body
    ? (body as { values: unknown }).values
    : undefined;

  const now = new Date().toISOString();
  const parseResult = fileSchema.safeParse({
    id: existing?.id ?? generateItemId(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    values: valuesShape,
  });
  if (!parseResult.success) {
    return err(400, "Validation failed", {
      issues: zodIssuesToStructured(parseResult.error.issues),
    });
  }
  const validated = parseResult.data;

  // Build + validate the item file in memory; the same bytes go into
  // the commit, the response, and (dev only) the local disk write.
  const planned = planItemWrite(
    parsedCollectionSlug.data,
    parsedItemSlug.data,
    { ...validated, slug: parsedItemSlug.data },
    def,
  );

  try {
    const result = await saveContent({
      targets: [planned.target],
      writeLocal: planned.writeLocal,
      authorEmail: session.email,
      commitSubject: itemCommitSubject("update", parsedCollectionSlug.data, parsedItemSlug.data),
    });
    return NextResponse.json({
      ok: true,
      item: planned.item,
      mode: result.mode,
      commitSha: result.commitSha,
    });
  } catch (cause) {
    if (cause instanceof PublishError) return saveFailureResponse(cause);
    throw cause;
  }
}

/**
 * PATCH — rename an item's slug. Body: `{ newSlug: string }`.
 *
 * The slug is the item's URL segment AND its filename. Renaming
 * physically moves the file from
 * `items/<oldSlug>.json` → `items/<newSlug>.json` and updates
 * `_order.json` if manual ordering is in effect. The item's stable
 * `id` is unchanged so cross-collection refs survive.
 *
 * TODO (ADR-009 deferred): the old URL won't redirect — external
 * links break silently. The fix is a per-collection `_redirects.json`
 * mapping oldSlug → newSlug, consulted by the public catch-all
 * before returning 404. Surface a warning in the UI until then.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  const { slug: collectionSlug, itemSlug } = await ctx.params;
  const parsedCollectionSlug = slugSchema.safeParse(collectionSlug);
  const parsedOldSlug = slugSchema.safeParse(itemSlug);
  if (!parsedCollectionSlug.success || !parsedOldSlug.success) {
    return err(400, "Invalid slug");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Body must be JSON");
  }
  const newSlugRaw = body && typeof body === "object" && "newSlug" in body
    ? (body as { newSlug: unknown }).newSlug
    : null;
  if (typeof newSlugRaw !== "string") {
    return err(400, "Body must include a string `newSlug`");
  }
  const parsedNewSlug = slugSchema.safeParse(newSlugRaw);
  if (!parsedNewSlug.success) {
    return err(400, `Invalid newSlug: ${parsedNewSlug.error.issues[0]?.message ?? "invalid"}`);
  }
  if (parsedOldSlug.data === parsedNewSlug.data) {
    return err(400, "newSlug must differ from the current slug");
  }

  const store = await getRequestReadStore();
  const def = await store.readCollectionDef(parsedCollectionSlug.data);
  if (!def) return err(404, `Collection "${parsedCollectionSlug.data}" not found`);

  // Draft-aware existence + collision checks, then build the renamed
  // item in memory. The rename bumps `updatedAt` (it's a write).
  const existing = await store.readItem(parsedCollectionSlug.data, parsedOldSlug.data, def);
  if (!existing) return err(404, "Item not found");
  const collides = await store.readItem(parsedCollectionSlug.data, parsedNewSlug.data, def);
  if (collides) {
    return err(409, new ItemExistsError(parsedCollectionSlug.data, parsedNewSlug.data).message);
  }
  // Same pre-flight as page creation: a renamed page must not take a
  // slug that shadows a collection's detail URL prefix.
  if (parsedCollectionSlug.data === "pages") {
    const shadowError = await pageSlugShadowError(store, parsedNewSlug.data);
    if (shadowError) return err(409, shadowError);
  }
  const planned = planItemWrite(
    parsedCollectionSlug.data,
    parsedNewSlug.data,
    { ...existing, slug: parsedNewSlug.data },
    def,
    new Date().toISOString(),
  );

  // Preserve manual ordering: swap oldSlug for newSlug in place so the
  // drag-ordered sequence survives the rename. Field-sorted
  // collections don't carry an order file.
  const orderBefore =
    def.defaultSort?.mode === "manual" ? await store.readOrder(parsedCollectionSlug.data) : null;
  const orderAfter =
    orderBefore !== null
      ? orderBefore.map((slug) => (slug === parsedOldSlug.data ? parsedNewSlug.data : slug))
      : null;

  const targets: PublishTarget[] = [
    planned.target,
    {
      kind: "delete-collection-item",
      collectionSlug: parsedCollectionSlug.data,
      itemSlug: parsedOldSlug.data,
    },
    ...(orderAfter !== null
      ? [
          {
            kind: "collection-order" as const,
            collectionSlug: parsedCollectionSlug.data,
            data: orderAfter,
          },
        ]
      : []),
  ];

  try {
    const result = await saveContent({
      targets,
      writeLocal: async () => {
        await planned.writeLocal();
        await deleteItem(parsedCollectionSlug.data, parsedOldSlug.data);
        if (orderAfter !== null) await writeOrder(parsedCollectionSlug.data, orderAfter);
      },
      authorEmail: session.email,
      commitSubject: renameCommitSubject(
        parsedCollectionSlug.data,
        parsedOldSlug.data,
        parsedNewSlug.data,
      ),
    });
    return NextResponse.json({
      ok: true,
      item: planned.item,
      newSlug: parsedNewSlug.data,
      mode: result.mode,
      commitSha: result.commitSha,
    });
  } catch (cause) {
    if (cause instanceof PublishError) return saveFailureResponse(cause);
    throw cause;
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  const { slug: collectionSlug, itemSlug } = await ctx.params;
  const parsedCollectionSlug = slugSchema.safeParse(collectionSlug);
  const parsedItemSlug = itemSlugSchema.safeParse(itemSlug);
  if (!parsedCollectionSlug.success || !parsedItemSlug.success) {
    return err(400, "Invalid slug");
  }

  const store = await getRequestReadStore();
  const def = await store.readCollectionDef(parsedCollectionSlug.data);
  if (!def) return err(404, `Collection "${parsedCollectionSlug.data}" not found`);

  const existing = await store.readItem(parsedCollectionSlug.data, parsedItemSlug.data, def);
  if (!existing) return err(404, "Item not found");

  try {
    const result = await saveContent({
      targets: [
        {
          kind: "delete-collection-item",
          collectionSlug: parsedCollectionSlug.data,
          itemSlug: parsedItemSlug.data,
        },
      ],
      writeLocal: () => deleteItem(parsedCollectionSlug.data, parsedItemSlug.data),
      authorEmail: session.email,
      commitSubject: itemCommitSubject("delete", parsedCollectionSlug.data, parsedItemSlug.data),
    });
    return NextResponse.json({ ok: true, mode: result.mode, commitSha: result.commitSha });
  } catch (cause) {
    if (cause instanceof PublishError) return saveFailureResponse(cause);
    throw cause;
  }
}
