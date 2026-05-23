import { NextResponse } from "next/server";

import { prisma } from "@stagecraft/db";

import { brokerSecretMatches } from "@/lib/broker-secret";
import { getLatestDeploy as getNetlifyLatestDeploy } from "@/lib/integrations/netlify";
import { getLatestDeployment as getVercelLatestDeployment } from "@/lib/integrations/vercel";
import {
  deployStatusBrokerRequestSchema,
  type DeployStatusBrokerError,
  type DeployStatusBrokerErrorCode,
} from "@/lib/deploy-status-broker-types";

function err(status: number, code: DeployStatusBrokerErrorCode, message?: string) {
  const body: DeployStatusBrokerError = { ok: false, code, error: message };
  return NextResponse.json(body, { status });
}

function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/**
 * Broker-authed deploy-status passthrough. The artist site's editor calls
 * this (via its own /api/publish-status) to drive the publish-state pill
 * with real Vercel/Netlify build state — the dashboard does the same via
 * /api/sites/[siteId]/deploy-status, but that requires a NextAuth session
 * the artist site doesn't have. Auth is the same broker secret used by
 * /api/publish-token.
 *
 * Returns the latest deploy on the site's deploy target. Callers compare
 * `deploy.createdAt` against their own publish time to ignore deploys
 * older than what they just pushed.
 */
export async function POST(request: Request) {
  const secret = extractBearer(request.headers.get("authorization"));
  if (!secret) {
    return err(401, "missing-bearer");
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return err(400, "invalid-body", "Body must be JSON.");
  }

  const parsed = deployStatusBrokerRequestSchema.safeParse(json);
  if (!parsed.success) {
    return err(400, "invalid-body", parsed.error.message);
  }

  const site = await prisma.site.findUnique({
    where: { id: parsed.data.siteId },
    select: {
      userId: true,
      brokerSecretHash: true,
      deployTarget: true,
      vercelProjectId: true,
      vercelTeamId: true,
      netlifySiteId: true,
    },
  });
  if (!site) {
    return err(404, "site-not-found");
  }
  if (!site.brokerSecretHash || !brokerSecretMatches(secret, site.brokerSecretHash)) {
    return err(401, "invalid-secret");
  }

  try {
    if (site.deployTarget === "vercel" && site.vercelProjectId) {
      const d = await getVercelLatestDeployment(
        site.userId,
        site.vercelProjectId,
        site.vercelTeamId ?? undefined,
      );
      return NextResponse.json({ ok: true, deploy: d });
    }
    if (site.deployTarget === "netlify" && site.netlifySiteId) {
      const d = await getNetlifyLatestDeploy(site.userId, site.netlifySiteId);
      return NextResponse.json({ ok: true, deploy: d });
    }
    return NextResponse.json({
      ok: true,
      deploy: { id: null, state: "unknown", url: null, errorMessage: null, createdAt: null },
    });
  } catch (cause) {
    return err(502, "provider-failed", cause instanceof Error ? cause.message : String(cause));
  }
}
