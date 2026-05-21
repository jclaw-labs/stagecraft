import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { PublishError, publishPage } from "@/lib/publish";
import {
  type PublishError as PublishErrorPayload,
  publishErrorHttpStatus,
  publishRequestSchema,
  publishResponseSchema,
} from "@/lib/publish-types";

function err(status: number, code: PublishErrorPayload["code"], error: string) {
  return NextResponse.json({ ok: false, code, error } satisfies PublishErrorPayload, { status });
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

  const parsed = publishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return err(400, "validation-failed", parsed.error.message);
  }

  try {
    const result = await publishPage({
      pageSlug: parsed.data.pageSlug,
      data: parsed.data.data,
      authorEmail: session.email,
    });
    return NextResponse.json(
      publishResponseSchema.parse({ ok: true, commitSha: result.commitSha }),
    );
  } catch (cause) {
    if (cause instanceof PublishError) {
      const status = publishErrorHttpStatus(cause.code);
      return err(status, cause.code, cause.message);
    }
    return err(500, "github-failed", String(cause));
  }
}
