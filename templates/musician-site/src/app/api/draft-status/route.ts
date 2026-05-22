import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { DraftStatusError, getDraftStatus } from "@/lib/draft-status";

/**
 * GET /api/draft-status — "is there anything to publish?"
 *
 * Returns the cheapest signal of pending draft state — a single
 * `hasPending` boolean derived from comparing `draft.sha` vs
 * `main.sha`. The AdminShell's pending-changes indicator polls this
 * on mount so the artist sees the state without having to click
 * Publish first.
 *
 * Counts and per-item summaries are intentionally out of scope —
 * they'd require the GitHub compare API and we'd rather not pay
 * that cost on every admin page load. The Publish modal's diff
 * preview (deferred per ADR-010) is the surface for those details.
 *
 * Auth: same gate as `/api/publish-draft`. The broker-secret hop
 * happens server-side; nothing about token state leaks to the client.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getDraftStatus();
    return NextResponse.json({ ok: true, status });
  } catch (cause) {
    if (cause instanceof DraftStatusError) {
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
