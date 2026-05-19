/**
 * PUT /api/collections/<slug>/template/<kind> — update one template
 * field on a Collection (ADR-009 PR 6 follow-up).
 *
 *   <kind> ∈ { "item", "detail", "list" } → CollectionDef.{kind}Template
 *
 * Body shape: `{ data: PuckData | null }`. The route reads the
 * current `_collection.json`, applies just the chosen template slot,
 * runs `validateSchemaChange(oldDef, newDef, items)` so template-
 * binding references stay sound, and persists.
 *
 * Why a separate route from the schema PUT? The schema PUT
 * round-trips the full def — opening it in a second tab while the
 * template editor is open means the template editor saves a stale
 * `fields` snapshot back. This route only ever writes one template
 * slot, so a concurrent schema change in another tab survives.
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  collectionDefSchema,
  describeIssue,
  describeWarning,
  listItemsInOrder,
  readCollectionDef,
  slugSchema,
  validateSchemaChange,
  writeCollectionDef,
} from "@/lib/collections";
import { PublishError, publish } from "@/lib/publish";

function err(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

type Ctx = { params: Promise<{ slug: string; kind: string }> };

const TEMPLATE_KINDS = ["item", "detail", "list"] as const;
type TemplateKind = (typeof TEMPLATE_KINDS)[number];

function isTemplateKind(value: string): value is TemplateKind {
  return (TEMPLATE_KINDS as ReadonlyArray<string>).includes(value);
}

const TEMPLATE_FIELD: Record<TemplateKind, "itemTemplate" | "detailTemplate" | "listTemplate"> = {
  item: "itemTemplate",
  detail: "detailTemplate",
  list: "listTemplate",
};

export async function PUT(request: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  const { slug, kind } = await ctx.params;
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return err(400, "Invalid collection slug");
  if (!isTemplateKind(kind)) {
    return err(400, `Invalid template kind "${kind}" — expected item | detail | list`);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "Body must be JSON");
  }

  const oldDef = await readCollectionDef(parsedSlug.data);
  if (!oldDef) return err(404, `Collection "${parsedSlug.data}" not found`);

  // Build the next def by overlaying just the chosen template slot.
  // null is meaningful (per ADR §4) — it clears the template back to
  // "no template configured."
  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data: unknown }).data
      : undefined;
  if (data !== null && (data === undefined || typeof data !== "object")) {
    return err(400, "Body must include { data: PuckData | null }");
  }
  const nextDef = collectionDefSchema.safeParse({
    ...oldDef,
    [TEMPLATE_FIELD[kind]]: data,
  });
  if (!nextDef.success) {
    return err(400, `Invalid template data: ${nextDef.error.message}`);
  }

  // Run the full schema validator. Template-binding references are
  // checked here — a binding to a removed field or a wrong-typed
  // field produces a structured 409 the editor can render inline.
  const items = await listItemsInOrder(parsedSlug.data, oldDef);
  const report = validateSchemaChange(oldDef, nextDef.data, items);
  if (!report.ok) {
    return err(409, "Template change blocked", {
      issues: report.issues.map((i) => ({ ...i, message: describeIssue(i) })),
      warnings: report.warnings.map((w) => ({ ...w, message: describeWarning(w) })),
    });
  }

  await writeCollectionDef(parsedSlug.data, nextDef.data);

  try {
    const result = await publish({
      targets: [
        {
          kind: "collection-def",
          collectionSlug: parsedSlug.data,
          data: nextDef.data,
        },
      ],
      authorEmail: session.email,
      commitSubject: `Update ${parsedSlug.data} ${kind} template`,
    });
    return NextResponse.json({
      ok: true,
      def: nextDef.data,
      mode: result.mode,
      commitSha: result.commitSha,
      warnings: report.warnings.map((w) => ({ ...w, message: describeWarning(w) })),
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
      return NextResponse.json({
        ok: true,
        def: nextDef.data,
        mode: "local",
        commitSha: null,
        publishWarning: cause.message,
        warnings: report.warnings.map((w) => ({ ...w, message: describeWarning(w) })),
      });
    }
    throw cause;
  }
}
