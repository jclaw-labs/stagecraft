/**
 * POST /api/discard-draft — wipe the `draft` branch back to `main`'s
 * HEAD (ADR-010 §4).
 *
 * Body: empty. (No targets — discards everything pending.)
 *
 * Returns:
 *   - `{ ok: true, mode, alreadyInSync, discardedFromSha, mainSha }`
 *     on success. `alreadyInSync: true` means draft was already at
 *     main (nothing to discard); UI surfaces that as "Nothing to
 *     discard." rather than treating it as an action.
 *   - `{ ok: false, code, error }` on auth / GitHub failures.
 *
 * No retry / no merge / no conflict path — discard is a single
 * force-update of the draft ref. Callers that hit this should also
 * refresh their admin view; the new draft state (now equal to main)
 * may be very different from what they were looking at.
 */

import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { discardDraft, PublishError } from "@/lib/publish";

function err(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

export async function POST() {
  const session = await getSession();
  if (!session) {
    return err(401, "unauthorized", "Sign in to discard pending changes.");
  }

  try {
    const result = await discardDraft({ authorEmail: session.email });
    if (result.mode === "local") {
      // Dev fallback: no draft branch concept; report alreadyInSync
      // so the UI doesn't claim a discard happened.
      return NextResponse.json({
        ok: true,
        mode: "local",
        alreadyInSync: true,
        discardedFromSha: null,
        mainSha: null,
      });
    }
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      alreadyInSync: result.alreadyInSync,
      discardedFromSha: result.discardedFromSha,
      mainSha: result.mainSha,
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
      const status = cause.code === "broker-rejected" ? 502 : 500;
      return err(status, cause.code, cause.message);
    }
    return err(500, "github-failed", String(cause));
  }
}
