/**
 * POST /api/publish-draft — squash the `draft` branch into `main` and
 * trigger the production deploy (ADR-010 §3).
 *
 * Body: optional `{ commitSubject?: string }`. The artist can override
 * the auto-generated "Publish pending changes" message; multi-line
 * content is accepted (first line becomes the git subject, anything
 * after a blank line becomes the body). The field name kept its
 * original `commitSubject` for API stability even though the modal's
 * input now accepts a body — internal callers (the modal) reach it
 * the same way; rename when there's a real reason to bump the API.
 *
 * Returns:
 *   - `{ ok: true, mode, commitSha, alreadyInSync, warning? }` on success.
 *     `warning` (a `PublishWarning`) is set when the squash shipped but
 *     merging `main` back into the draft didn't finish (ADR-012).
 *   - `{ ok: false, code, error }` on auth / GitHub failures.
 *
 * `alreadyInSync: true` means draft equalled main at publish time —
 * there was nothing pending and no commit was created. Callers can
 * surface this as "nothing to publish" without polling the deploy.
 *
 * No `targets` arg: this endpoint operates on whatever's accumulated
 * on `draft` since the last publish. Targets-specific commit
 * subjects live on the per-save commits on draft (visible via the
 * branch's reflog) and aren't surfaced through this endpoint.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth";
import { publishDraftToMain, PublishError } from "@/lib/publish";
import { MAX_COMMIT_MESSAGE_LENGTH, publishErrorHttpStatus } from "@/lib/publish-types";

const requestSchema = z
  .object({
    commitSubject: z.string().min(1).max(MAX_COMMIT_MESSAGE_LENGTH).optional(),
  })
  .strict()
  .partial();

function err(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return err(401, "unauthorized", "Sign in to publish.");
  }

  // Body is optional — empty body or no body at all should still
  // publish with default arguments. Tolerate both.
  let body: unknown = {};
  try {
    const text = await request.text();
    if (text.length > 0) body = JSON.parse(text);
  } catch {
    return err(400, "validation-failed", "Body must be JSON if provided.");
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return err(400, "validation-failed", parsed.error.message);
  }

  try {
    const result = await publishDraftToMain({
      authorEmail: session.email,
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
    return err(500, "github-failed", String(cause));
  }
}
