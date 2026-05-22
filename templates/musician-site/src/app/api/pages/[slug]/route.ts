import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getRequestReadStore } from "@/lib/collections";
import { deletePage, readPageOrNull } from "@/lib/content";
import { PublishError, saveToDraft } from "@/lib/publish";
import { pageSlugSchema } from "@/lib/site-config-types";

/**
 * DELETE /api/pages/[slug] — remove a page from disk and (when configured)
 * commit the deletion to the artist's repo in a single publish.
 */

function err(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const session = await getSession();
  if (!session) return err(401, "unauthorized");

  const { slug: raw } = await ctx.params;
  const parsed = pageSlugSchema.safeParse(raw);
  if (!parsed.success) return err(400, parsed.error.message);
  const slug = parsed.data;

  const store = await getRequestReadStore();
  const existing = await readPageOrNull(slug, store);
  if (!existing) return err(404, `No page with slug "${slug}"`);

  await deletePage(slug);

  try {
    const result = await saveToDraft({
      targets: [{ kind: "delete-collection-item", collectionSlug: "pages", itemSlug: slug }],
      authorEmail: session.email,
      commitSubject: `Delete page ${slug}`,
    });
    return NextResponse.json({ ok: true, mode: result.mode, commitSha: result.commitSha });
  } catch (cause) {
    if (cause instanceof PublishError) {
      // Local delete already happened; report the publish failure as a warning.
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
