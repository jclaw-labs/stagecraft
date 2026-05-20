/**
 * PUT /api/collections/<slug>/schema — update a Collection's
 * schema (ADR-009 PR 5).
 *
 * Body: a full `CollectionDef` payload. The route runs two layers
 * of validation:
 *
 *   1. Structural — the body must `collectionDefSchema.parse(...)`
 *      (same Zod schema the store enforces on read/write).
 *   2. Semantic — `validateSchemaChange(oldDef, newDef, items)` from
 *      `schema-changes.ts` decides whether the diff is safe given
 *      the current items. Blocking issues → 409 with a structured
 *      list the editor uses to render inline field errors. Non-
 *      blocking warnings travel back in the success response so the
 *      editor can surface them too (the UI is expected to gate
 *      destructive operations with a confirm step *before* calling
 *      this route — the warnings here are belt-and-braces).
 *
 * On success: write `_collection.json` locally, then publish via the
 * existing `collection-def` target. Items are not touched — schema
 * changes are deliberately additive at the item level (renames change
 * key not id; lossless type transitions keep the existing values).
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  collectionDefRepoPath,
  collectionDefSchema,
  describeIssue,
  describeWarning,
  listItemsInOrder,
  prepareItemFileWrite,
  readCollectionDef,
  slugSchema,
  validateSchemaChange,
  type Item,
} from "@/lib/collections";
import { localPathForRepoPath, writeJsonBatchAtomic } from "@/lib/fs-helpers";
import { PublishError, saveToDraft } from "@/lib/publish";

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

type Ctx = { params: Promise<{ slug: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  const { slug } = await ctx.params;
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return err(400, "Invalid collection slug");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Body must be JSON");
  }

  const oldDef = await readCollectionDef(parsedSlug.data);
  if (!oldDef) return err(404, `Collection "${parsedSlug.data}" not found`);

  // Structural: must be a valid CollectionDef in its own right.
  const parsedDef = collectionDefSchema.safeParse(body);
  if (!parsedDef.success) {
    return err(400, `Invalid CollectionDef: ${parsedDef.error.message}`);
  }
  const newDef = parsedDef.data;
  if (newDef.slug !== parsedSlug.data) {
    return err(400, "Body slug must match the URL slug");
  }

  // Renaming a collection is a separate operation (different on-disk
  // path); blocking it here keeps the route's responsibility crisp.
  if (newDef.slug !== oldDef.slug) {
    return err(400, "Renaming a collection isn't supported via this route");
  }
  if (newDef.isSingleton !== oldDef.isSingleton) {
    return err(400, "Toggling isSingleton isn't supported via this route");
  }

  // Semantic: compare against existing items.
  const items = await listItemsInOrder(parsedSlug.data, oldDef);
  const report = validateSchemaChange(oldDef, newDef, items);
  if (!report.ok) {
    return err(409, "Schema change blocked", {
      issues: report.issues.map((issue) => ({ ...issue, message: describeIssue(issue) })),
      warnings: report.warnings.map((w) => ({ ...w, message: describeWarning(w) })),
    });
  }

  // Lossless type transitions: the validator already computed the
  // rewritten items (and verified they parse against the new def's
  // dynamic Zod). Read them off the report rather than recomputing,
  // so there's a single source of truth for what the save will do.
  const migratedItems = report.migratedItems;

  // Stage every local write (the new def + every migrated item) and
  // commit them with `writeJsonBatchAtomic`. The phase-1-protected
  // batch means a stringify / disk-full / validation slip on any
  // single item leaves the previous state untouched — no half-
  // migrated collection where the def says "field X is now type Y"
  // but some items still carry the old type Y.
  //
  // Item writes go through `prepareItemFileWrite` (shared with
  // `writeItem`) so the on-disk bytes match exactly what a per-call
  // write would produce. Passing a shared `nowIso` means every item
  // in this batch ends up with the same `updatedAt`.
  const nowIso = new Date().toISOString();
  const writes: Array<{ file: string; value: unknown }> = [
    {
      file: localPathForRepoPath(collectionDefRepoPath(parsedSlug.data)),
      value: collectionDefSchema.parse(newDef),
    },
    ...migratedItems.map((item: Item) =>
      prepareItemFileWrite(parsedSlug.data, item.slug, item, newDef, nowIso),
    ),
  ];
  await writeJsonBatchAtomic(writes);

  // Serialise warnings once — both success branches return the same
  // shape, and `describeWarning` is pure but cheap to call twice was
  // still pointless duplication.
  const warningsOut = report.warnings.map((w) => ({ ...w, message: describeWarning(w) }));

  try {
    const result = await saveToDraft({
      targets: [
        {
          kind: "collection-def",
          collectionSlug: parsedSlug.data,
          data: newDef,
        },
        ...migratedItems.map((item: Item) => ({
          kind: "collection-item" as const,
          collectionSlug: parsedSlug.data,
          itemSlug: item.slug,
          data: {
            id: item.id,
            createdAt: item.createdAt,
            // Match the `updatedAt` we just wrote to disk so the
            // publish target and the on-disk file agree. The
            // previous code used `item.updatedAt` from the
            // validator's migrated item, which was stale relative
            // to what `writeItem` stamped on disk.
            updatedAt: nowIso,
            values: item.values,
          },
        })),
      ],
      authorEmail: session.email,
      commitSubject:
        migratedItems.length === 0
          ? `Update ${parsedSlug.data} schema`
          : `Update ${parsedSlug.data} schema (+ migrate ${migratedItems.length} item${migratedItems.length === 1 ? "" : "s"})`,
    });
    return NextResponse.json({
      ok: true,
      def: newDef,
      mode: result.mode,
      commitSha: result.commitSha,
      migratedItemCount: migratedItems.length,
      warnings: warningsOut,
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
      return NextResponse.json({
        ok: true,
        def: newDef,
        mode: "local",
        commitSha: null,
        publishWarning: cause.message,
        migratedItemCount: migratedItems.length,
        warnings: warningsOut,
      });
    }
    throw cause;
  }
}
