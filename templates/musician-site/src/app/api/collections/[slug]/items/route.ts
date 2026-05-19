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
  createItem,
  generateItemId,
  ItemExistsError,
  listItemsInOrder,
  readCollectionDef,
  readItem,
  slugSchema,
  type Item,
} from "@/lib/collections";
import { PublishError, publish } from "@/lib/publish";

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

  const def = await readCollectionDef(parsedSlug.data);
  if (!def) return err(404, `Collection "${parsedSlug.data}" not found`);

  const items = await listItemsInOrder(parsedSlug.data, def);
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

  const def = await readCollectionDef(parsedSlug.data);
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

  const draft: Item = { ...validated, slug: parsedItemSlug.data };
  // createItem 409s on collision; check first so we return a clean
  // status code rather than letting the error bubble.
  const existing = await readItem(parsedSlug.data, parsedItemSlug.data, def);
  if (existing) return err(409, new ItemExistsError(parsedSlug.data, parsedItemSlug.data).message);
  await createItem(parsedSlug.data, parsedItemSlug.data, draft, def);
  // Re-read so the response (and publish target) carries the
  // canonical `createdAt` / `updatedAt` the store just stamped —
  // `createItem` overrides both internally.
  const saved = await readItem(parsedSlug.data, parsedItemSlug.data, def);
  if (!saved) {
    return err(500, "Item disappeared between write and read");
  }

  try {
    const result = await publish({
      targets: [
        {
          kind: "collection-item",
          collectionSlug: parsedSlug.data,
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
      commitSubject: `Create ${parsedSlug.data}/${parsedItemSlug.data}`,
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
