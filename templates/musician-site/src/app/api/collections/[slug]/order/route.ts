/**
 * PUT /api/collections/<slug>/order — write the manual `_order.json`
 * for a collection.
 *
 * The order is the canonical list of item slugs in the order they
 * should surface to consumers (`listItemsInOrder`, the public nav,
 * the Pages admin). Slugs not present here are appended alphabetically
 * by the listing layer; slugs that no longer have an on-disk item
 * are filtered out at read time. Both behaviors live in the store
 * layer — this endpoint just persists the array verbatim.
 *
 * Used by the Pages panel's drag-reorder, and by future per-collection
 * order editors. Replaces the legacy `POST /api/save-config` fan-out
 * for `siteConfig.pageOrder`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import {
  getRequestReadStore,
  slugSchema,
  writeOrder,
} from "@/lib/collections";
import { PublishError } from "@/lib/publish";
import { saveContent, saveFailureResponse } from "@/lib/save-content";

const requestSchema = z.object({
  order: z.array(z.string().min(1)),
});

function err(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

type Ctx = { params: Promise<{ slug: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  const { slug: collectionSlug } = await ctx.params;
  const parsedCollectionSlug = slugSchema.safeParse(collectionSlug);
  if (!parsedCollectionSlug.success) return err(400, "Invalid slug");

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
  const def = await store.readCollectionDef(parsedCollectionSlug.data);
  if (!def) return err(404, `Collection "${parsedCollectionSlug.data}" not found`);

  // Singletons have no order — surface as a clear 400 so a misuse
  // (UI bug, hand-rolled curl) doesn't silently write an order file
  // that the store layer would ignore.
  if (def.isSingleton) return err(400, "Singleton collections have no order");

  // Cross-check every slug in the requested order against the items
  // actually on disk. Phantoms get filtered out at read time
  // (`listItemsInOrder`), so writing them is benign — but a phantom
  // in the request is almost always a client bug (stale UI state,
  // typo), and we'd rather surface it at the API boundary than let it
  // accumulate.
  const knownSlugs = new Set(await store.listItemSlugs(parsedCollectionSlug.data));
  const unknown = parsed.data.order.filter((s) => !knownSlugs.has(s));
  if (unknown.length > 0) {
    return err(400, `Unknown item slug(s): ${unknown.join(", ")}`);
  }

  try {
    const result = await saveContent({
      targets: [
        {
          kind: "collection-order",
          collectionSlug: parsedCollectionSlug.data,
          data: parsed.data.order,
        },
      ],
      writeLocal: () => writeOrder(parsedCollectionSlug.data, parsed.data.order),
      authorEmail: session.email,
      commitSubject: `Reorder ${parsedCollectionSlug.data}`,
    });
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      commitSha: result.commitSha,
    });
  } catch (cause) {
    if (cause instanceof PublishError) return saveFailureResponse(cause);
    throw cause;
  }
}
