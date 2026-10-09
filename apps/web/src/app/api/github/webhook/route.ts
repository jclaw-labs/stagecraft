import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@stagecraft/db";

import {
  handleInstallationEvent,
  handleRepositoriesEvent,
  type InstallationAction,
  type RepositoriesAction,
  type WebhookDb,
} from "@/lib/github-webhook-handlers";
import { verifyGitHubSignature } from "@/lib/github-webhook-signature";

const installationPayloadSchema = z.object({
  action: z.enum(["created", "deleted", "suspend", "unsuspend", "new_permissions_accepted"]),
  installation: z.object({ id: z.number().int().positive() }),
});

const repositoriesPayloadSchema = z.object({
  action: z.enum(["added", "removed"]),
  installation: z.object({ id: z.number().int().positive() }),
  repositories_added: z.array(z.object({ name: z.string() })).optional(),
  repositories_removed: z.array(z.object({ name: z.string() })).optional(),
});

/** Wraps a failed delivery-row insert so it can be told apart from a handler failure. */
class DeliveryRecordError extends Error {
  constructor(cause: unknown) {
    super("delivery record write failed", { cause });
  }
}

function ok(body: unknown) {
  return NextResponse.json(body, { status: 200 });
}
function bad(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyGitHubSignature(rawBody, signature)) {
    return bad(401, "invalid signature");
  }

  const event = request.headers.get("x-github-event") ?? "";
  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  if (!event || !deliveryId) {
    return bad(400, "missing event headers");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return bad(400, "body is not JSON");
  }

  // Validate before touching the database, so a malformed delivery is never
  // recorded as handled.
  let run: (db: WebhookDb) => Promise<Response>;
  if (event === "installation") {
    const parsed = installationPayloadSchema.safeParse(payload);
    if (!parsed.success) return bad(400, `invalid installation payload: ${parsed.error.message}`);
    const action = parsed.data.action satisfies InstallationAction;
    const installationId = parsed.data.installation.id;
    run = async (db) => {
      const result = await handleInstallationEvent(action, installationId, db);
      return ok({ ok: true, applied: result.applied, note: result.note });
    };
  } else if (event === "installation_repositories") {
    const parsed = repositoriesPayloadSchema.safeParse(payload);
    if (!parsed.success) return bad(400, `invalid repositories payload: ${parsed.error.message}`);
    const action = parsed.data.action satisfies RepositoriesAction;
    const installationId = parsed.data.installation.id;
    const repos =
      (action === "added" ? parsed.data.repositories_added : parsed.data.repositories_removed) ?? [];
    run = async (db) => {
      const result = await handleRepositoriesEvent(action, installationId, repos, db);
      return ok({ ok: true, applied: result.applied, note: result.note });
    };
  } else {
    // Unsubscribed events should never arrive (App settings only ask for
    // `installation` and `installation_repositories`). 200 the unknown
    // event so GitHub doesn't retry needlessly.
    run = async () => ok({ ok: true, ignored: event });
  }

  // Idempotency: the delivery row and the handler's writes share one
  // transaction, so a handler failure rolls the row back and GitHub's
  // redelivery is processed instead of being skipped as a duplicate. The row
  // is inserted first: a concurrent copy of the same delivery blocks on the
  // (provider, deliveryId) unique index until this transaction ends, then
  // either hits P2002 (we committed) or proceeds (we rolled back).
  try {
    return await prisma.$transaction(async (tx) => {
      try {
        await tx.webhookDelivery.create({
          data: { provider: "github", deliveryId, eventType: event },
        });
      } catch (cause) {
        throw new DeliveryRecordError(cause);
      }
      return run(tx);
    });
  } catch (cause) {
    if (cause instanceof DeliveryRecordError) {
      const code = (cause.cause as { code?: string } | null)?.code;
      if (code === "P2002") {
        return ok({ ok: true, duplicate: true });
      }
      console.error(`GitHub webhook ${deliveryId} (${event}) delivery record failed:`, cause.cause);
      return bad(500, "delivery record write failed");
    }
    // GitHub doesn't redeliver failed App webhooks on its own, so this log
    // is how anyone learns a delivery needs redelivering by hand.
    console.error(`GitHub webhook ${deliveryId} (${event}) failed:`, cause);
    return bad(500, "webhook processing failed");
  }
}
