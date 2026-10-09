/**
 * GET / POST collection items at the collection-list level
 * (ADR-009 PR 4).
 *
 *   GET  /api/collections/<slug>/items        — list every item slug
 *                                                + a display label
 *   POST /api/collections/<slug>/items        — create a new item
 *                                                (body: `{ slug, values? }`)
 *
 * The list endpoint returns an array of `{ id, slug, label }` shapes
 * the editor uses to populate reference pickers (collectionRef /
 * multiCollectionRef). The label is derived from `slugSourceFieldId`
 * when set, falling back to the slug.
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  buildItemFileSchema,
  generateItemId,
  getRequestReadStore,
  ItemExistsError,
  slugSchema,
} from "@/lib/collections";
import { PublishError } from "@/lib/publish";
import { planItemWrite, saveContent, saveFailureResponse } from "@/lib/save-content";

import { zodIssuesToStructured } from "./[itemSlug]/issue-format";

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  const { slug } = await ctx.params;
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return err(400, "Invalid collection slug");

  const store = await getRequestReadStore();
  const def = await store.readCollectionDef(parsedSlug.data);
  if (!def) return err(404, `Collection "${parsedSlug.data}" not found`);

  const items = await store.listItemsInOrder(parsedSlug.data, def);
  const summaries = items.map((item) => {
    const labelValue =
      def.slugSourceFieldId && item.values[def.slugSourceFieldId];
    const label =
      labelValue &&
      ("value" in labelValue) &&
      typeof labelValue.value === "string"
        ? labelValue.value
        : item.slug;
    return { id: item.id, slug: item.slug, label };
  });
  return NextResponse.json({ ok: true, items: summaries, def });
}

export async function POST(request: Request, ctx: Ctx) {
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

  const store = await getRequestReadStore();
  const def = await store.readCollectionDef(parsedSlug.data);
  if (!def) return err(404, `Collection "${parsedSlug.data}" not found`);

  if (def.isSingleton) {
    return err(400, "Singleton collections have a fixed _singleton item — use PUT to update");
  }

  // Body shape: `{ slug, values? }`. Slug must be a fresh slug; we
  // refuse on collision so the artist can't silently overwrite.
  const slugPart = body && typeof body === "object" ? (body as { slug?: unknown }).slug : undefined;
  const parsedItemSlug = slugSchema.safeParse(slugPart);
  if (!parsedItemSlug.success) return err(400, "Body must include a valid slug");

  const valuesPart =
    body && typeof body === "object" ? (body as { values?: unknown }).values : undefined;

  // Build the per-collection schema and validate the incoming values.
  const fileSchema = buildItemFileSchema(def.fields);
  const now = new Date().toISOString();
  const parseResult = fileSchema.safeParse({
    id: generateItemId(),
    createdAt: now,
    updatedAt: now,
    values: valuesPart ?? {},
  });
  if (!parseResult.success) {
    return err(400, "Validation failed", {
      issues: zodIssuesToStructured(parseResult.error.issues),
    });
  }
  const validated = parseResult.data;

  // Refuse on collision so the artist can't silently overwrite. The
  // check reads through the draft-aware store.
  const existing = await store.readItem(parsedSlug.data, parsedItemSlug.data, def);
  if (existing) return err(409, new ItemExistsError(parsedSlug.data, parsedItemSlug.data).message);

  // Built + validated in memory; the same bytes go into the commit,
  // the response, and (dev only) the local disk write.
  const planned = planItemWrite(
    parsedSlug.data,
    parsedItemSlug.data,
    { ...validated, slug: parsedItemSlug.data },
    def,
  );

  try {
    const result = await saveContent({
      targets: [planned.target],
      writeLocal: planned.writeLocal,
      authorEmail: session.email,
      commitSubject: `Create ${parsedSlug.data}/${parsedItemSlug.data}`,
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
