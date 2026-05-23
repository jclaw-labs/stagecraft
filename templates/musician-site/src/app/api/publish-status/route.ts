import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import {
  DeployStatusError,
  fetchDeployStatus,
} from "@/lib/deploy-status";

/**
 * Editor-facing wrapper around the platform's broker deploy-status route.
 * The editor at /admin polls this every few seconds while a publish is
 * in flight, to drive the publish-state pill (queued → building → ready).
 *
 * Auth: requires a valid editor session (same gate as /api/publish). The
 * broker-secret hop happens server-side here; the broker secret never
 * touches the editor client.
 *
 * Dev fallback: when the platform env vars aren't set (local dev),
 * returns a synthetic { state: "unknown" } so the editor can render the
 * pill without erroring. The dev publish path writes JSON locally and
 * has no separate "deploy" concept.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deploy = await fetchDeployStatus();
    return NextResponse.json({ ok: true, deploy });
  } catch (cause) {
    if (cause instanceof DeployStatusError && cause.code === "no-platform-configured") {
      return NextResponse.json({
        ok: true,
        deploy: { id: null, state: "unknown", url: null, errorMessage: null, createdAt: null },
      });
    }
    if (cause instanceof DeployStatusError) {
      const status = cause.code === "broker-rejected" ? 502 : 500;
      return NextResponse.json(
        { ok: false, code: cause.code, error: cause.message },
        { status },
      );
    }
    return NextResponse.json(
      { ok: false, error: cause instanceof Error ? cause.message : String(cause) },
      { status: 500 },
    );
  }
}
