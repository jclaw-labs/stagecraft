import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { DraftChangesError, getDraftChanges } from "@/lib/draft-changes";

/**
 * GET /api/draft-changes — "what's pending on draft?"
 *
 * Returns the file-count diff between `draft` and `main` (computed by
 * GitHub's compare API). The admin chrome's `PendingChangesIndicator`
 * polls this on mount so the artist sees "3 unpublished changes"
 * before clicking Publish. The follow-up Publish modal (deferred)
 * will consume the same endpoint extended to include the per-file
 * list.
 *
 * Auth: same gate as `/api/publish-draft`. The broker-secret hop
 * happens server-side; nothing about token state leaks to the
 * client.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getDraftChanges();
    return NextResponse.json(
      { ok: true, status },
      // No-store so a save → navigate sequence isn't served a stale
      // count out of the browser's HTTP cache. The client also sets
      // `cache: "no-store"` on its fetch — both belts.
      { headers: { "cache-control": "no-store" } },
    );
  } catch (cause) {
    if (cause instanceof DraftChangesError) {
      const httpStatus = cause.code === "broker-rejected" ? 502 : 500;
      return NextResponse.json(
        { ok: false, code: cause.code, error: cause.message },
        { status: httpStatus },
      );
    }
    return NextResponse.json(
      { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      { status: 500 },
    );
  }
}
