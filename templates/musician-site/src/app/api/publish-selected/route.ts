/**
 * POST /api/publish-selected — publish a SUBSET of the pending changes
 * (ADR-012, per-item Publish).
 *
 * Body: `{ selectedKeys: string[]; commitSubject?: string }`. `selectedKeys`
 * are the change keys (see `changeKey` in `lib/draft-changes`) the artist
 * ticked in the publish modal. The server re-derives the diff and expands
 * them to the concrete copy/delete paths — so a stale client can't desync
 * or partially publish an image (all of an image's variants share one key).
 *
 * Returns:
 *   - `{ ok: true, mode, commitSha, alreadyInSync, warning? }` on success.
 *     `warning` (a `PublishWarning`) is set when the selected changes
 *     shipped but reconciling the draft afterwards didn't finish — still
 *     a success, since `main` has the change and the deploy fired.
 *   - `{ ok: false, code, error }` on auth / GitHub failures.
 *
 * `alreadyInSync: true` means the selection resolved to nothing actually
 * pending (e.g. only stale keys) — no commit, no deploy.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { DraftChangesError, resolveSelectedChangePaths } from "@/lib/draft-changes";
import { publishSelectedToMain, PublishError } from "@/lib/publish";
import { MAX_COMMIT_MESSAGE_LENGTH, publishErrorHttpStatus } from "@/lib/publish-types";

const requestSchema = z
  .object({
    selectedKeys: z.array(z.string().min(1)).min(1),
    commitSubject: z.string().min(1).max(MAX_COMMIT_MESSAGE_LENGTH).optional(),
  })
  .strict();

function err(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return err(401, "unauthorized", "Sign in to publish.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "validation-failed", "Body must be JSON.");
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return err(400, "validation-failed", parsed.error.message);
  }

  // Expand the selected change keys to concrete paths server-side.
  let paths: Awaited<ReturnType<typeof resolveSelectedChangePaths>>;
  try {
    paths = await resolveSelectedChangePaths(parsed.data.selectedKeys);
  } catch (cause) {
    if (cause instanceof DraftChangesError) {
      const status = cause.code === "broker-rejected" ? 502 : 500;
      return err(status, cause.code, cause.message);
    }
    return err(500, "github-failed", cause instanceof Error ? cause.message : String(cause));
  }

  try {
    const result = await publishSelectedToMain({
      authorEmail: session.email,
      copyPaths: paths.copyPaths,
      deletePaths: paths.deletePaths,
      commitSubject: parsed.data.commitSubject,
    });
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      commitSha: result.commitSha,
      alreadyInSync: result.alreadyInSync,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
      const status = publishErrorHttpStatus(cause.code);
      return err(status, cause.code, cause.message);
    }
    return err(500, "github-failed", cause instanceof Error ? cause.message : String(cause));
  }
}
