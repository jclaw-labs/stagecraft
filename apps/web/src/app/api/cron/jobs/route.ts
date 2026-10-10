import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { extractBearer } from "@stagecraft/shared";

import { getWorker } from "@/lib/jobs/worker";

// Never cache: every call must actually drain the queue.
export const dynamic = "force-dynamic";

function secretMatches(incoming: string, expected: string): boolean {
  // Hash both sides so timingSafeEqual always compares equal-length buffers.
  const a = createHash("sha256").update(incoming).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Cron entry point for the background job queue. Processes queued
 * `SiteJob` rows back to back until the queue is empty or the drain's
 * job / time limit is hit.
 *
 * Called every five minutes by the Netlify scheduled function
 * (netlify/functions/drain-jobs.ts) with `Authorization: Bearer $CRON_SECRET`,
 * to resume jobs whose function was cut off. A host with no long-lived
 * process at all can drive the whole queue this way: set
 * STAGECRAFT_INPROCESS_WORKER=false there so only the cron path claims jobs.
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "cron-not-configured" }, { status: 503 });
  }

  const secret = extractBearer(request.headers.get("authorization"));
  if (!secret || !secretMatches(secret, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const processed = await getWorker().drain();
  return NextResponse.json({ ok: true, processed });
}
