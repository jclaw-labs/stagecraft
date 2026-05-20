/**
 * GET / PUT / DELETE one item in any collection (ADR-009 PR 4).
 *
 * The slug pair (`collectionSlug`, `itemSlug`) addresses the file at
 * `src/content/collections/<collectionSlug>/items/<itemSlug>.json`.
 *
 * The wrapper layer (`@/lib/content`) keeps the legacy pages /
 * singletons API working; this generic route is for the schema- and
 * item-editor surfaces that consume any collection by id.
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  buildItemFileSchema,
  deleteItem,
  ItemExistsError,
  itemSlugSchema,
  readCollectionDef,
  readItem,
  readOrder,
  renameItem,
  slugSchema,
  writeItem,
  type Item,
} from "@/lib/collections";
import { PublishError, publish } from "@/lib/publish";

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

  const def = await readCollectionDef(parsedCollectionSlug.data);
  if (!def) return err(404, `Collection "${parsedCollectionSlug.data}" not found`);

  const item = await readItem(parsedCollectionSlug.data, parsedItemSlug.data, def);
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

  const def = await readCollectionDef(parsedCollectionSlug.data);
  if (!def) return err(404, `Collection "${parsedCollectionSlug.data}" not found`);

  // PUT is update-only — creation lives on POST. Without this guard, a
  // PUT to a slug that doesn't exist would silently create a fresh
  // item with a brand-new id, racing any concurrent POST to the same
  // slug from another tab.
  const existing = await readItem(parsedCollectionSlug.data, parsedItemSlug.data, def);
  if (!existing) return err(404, "Item not found");

  // Build the per-collection Zod schema from `def.fields` and run the
  // incoming item through it. This is where required-field / option /
  // mime-filter validation actually happens — the publish layer only
  // does the structural shell check.
  const fileSchema = buildItemFileSchema(def.fields);
  const valuesShape = body && typeof body === "object" && "values" in body
    ? (body as { values: unknown }).values
    : undefined;

  const parseResult = fileSchema.safeParse({
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    values: valuesShape,
  });
  if (!parseResult.success) {
    return err(400, "Validation failed", {
      issues: zodIssuesToStructured(parseResult.error.issues),
    });
  }
  const validated = parseResult.data;

  const draft: Item = { ...validated, slug: parsedItemSlug.data };
  await writeItem(parsedCollectionSlug.data, parsedItemSlug.data, draft, def);
  // Re-read so the response (and publish target) carries the
  // canonical `updatedAt` the store just stamped.
  const saved = await readItem(parsedCollectionSlug.data, parsedItemSlug.data, def);
  if (!saved) return err(500, "Item disappeared between write and read");

  try {
    const result = await publish({
      targets: [
        {
          kind: "collection-item",
          collectionSlug: parsedCollectionSlug.data,
          itemSlug: parsedItemSlug.data,
          data: {
            id: saved.id,
            createdAt: saved.createdAt,
            updatedAt: saved.updatedAt,
            values: saved.values,
          },
        },
      ],
      authorEmail: session.email,
      commitSubject: `Update ${parsedCollectionSlug.data}/${parsedItemSlug.data}`,
    });
    return NextResponse.json({
      ok: true,
      item: saved,
      mode: result.mode,
      commitSha: result.commitSha,
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
      return NextResponse.json({
        ok: true,
        item: saved,
        mode: "local",
        commitSha: null,
        publishWarning: cause.message,
      });
    }
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

  const def = await readCollectionDef(parsedCollectionSlug.data);
  if (!def) return err(404, `Collection "${parsedCollectionSlug.data}" not found`);

  let saved: Item;
  try {
    saved = await renameItem(
      parsedCollectionSlug.data,
      parsedOldSlug.data,
      parsedNewSlug.data,
      def,
    );
  } catch (cause) {
    if (cause instanceof ItemExistsError) {
      return err(409, cause.message);
    }
    if (cause instanceof Error && cause.message.startsWith("renameItem: no item")) {
      return err(404, "Item not found");
    }
    throw cause;
  }

  // Read the (possibly updated) order so the publish includes it
  // when manual ordering is in effect. Otherwise the publish just
  // covers the write + delete pair.
  const orderAfter =
    def.defaultSort?.mode === "manual" ? await readOrder(parsedCollectionSlug.data) : null;

  try {
    const result = await publish({
      targets: [
        {
          kind: "collection-item",
          collectionSlug: parsedCollectionSlug.data,
          itemSlug: parsedNewSlug.data,
          data: {
            id: saved.id,
            createdAt: saved.createdAt,
            updatedAt: saved.updatedAt,
            values: saved.values,
          },
        },
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
      ],
      authorEmail: session.email,
      commitSubject: `Rename ${parsedCollectionSlug.data}/${parsedOldSlug.data} → ${parsedNewSlug.data}`,
    });
    return NextResponse.json({
      ok: true,
      item: saved,
      newSlug: parsedNewSlug.data,
      mode: result.mode,
      commitSha: result.commitSha,
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
      return NextResponse.json({
        ok: true,
        item: saved,
        newSlug: parsedNewSlug.data,
        mode: "local",
        commitSha: null,
        publishWarning: cause.message,
      });
    }
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

  const def = await readCollectionDef(parsedCollectionSlug.data);
  if (!def) return err(404, `Collection "${parsedCollectionSlug.data}" not found`);

  const existing = await readItem(parsedCollectionSlug.data, parsedItemSlug.data, def);
  if (!existing) return err(404, "Item not found");

  await deleteItem(parsedCollectionSlug.data, parsedItemSlug.data);

  try {
    const result = await publish({
      targets: [
        {
          kind: "delete-collection-item",
          collectionSlug: parsedCollectionSlug.data,
          itemSlug: parsedItemSlug.data,
        },
      ],
      authorEmail: session.email,
      commitSubject: `Delete ${parsedCollectionSlug.data}/${parsedItemSlug.data}`,
    });
    return NextResponse.json({ ok: true, mode: result.mode, commitSha: result.commitSha });
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
