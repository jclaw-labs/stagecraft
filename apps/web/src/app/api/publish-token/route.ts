import { NextResponse } from "next/server";

import { prisma } from "@stagecraft/db";
import { extractBearer } from "@stagecraft/shared";

import { brokerSecretMatches } from "@/lib/broker-secret";
import { GitHubAppMisconfiguredError } from "@/lib/github-app-token";
import {
  type PublishTokenError,
  type PublishTokenErrorCode,
  publishTokenRequestSchema,
} from "@/lib/publish-token-types";
import { getSiteInstallationToken } from "@/lib/site-installation-token";

function err(status: number, code: PublishTokenErrorCode, message?: string) {
  const body: PublishTokenError = { ok: false, code, error: message };
  return NextResponse.json(body, { status });
}

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

  const parsed = publishTokenRequestSchema.safeParse(json);
  if (!parsed.success) {
    return err(400, "invalid-body", parsed.error.message);
  }

  const site = await prisma.site.findUnique({ where: { id: parsed.data.siteId } });
  if (!site) {
    return err(404, "site-not-found");
  }
  if (!site.brokerSecretHash || !brokerSecretMatches(secret, site.brokerSecretHash)) {
    return err(401, "invalid-secret");
  }
  if (site.githubAppSuspended) {
    return err(423, "app-suspended");
  }
  if (!site.githubInstallationId) {
    return err(409, "app-not-installed");
  }
  if (!site.githubRepoOwner || !site.githubRepoName) {
    return err(409, "repo-not-configured");
  }

  let token;
  try {
    token = await getSiteInstallationToken({
      siteId: site.id,
      installationId: site.githubInstallationId,
      repoName: site.githubRepoName,
    });
  } catch (cause) {
    if (cause instanceof GitHubAppMisconfiguredError) {
      return err(500, "github-app-misconfigured", cause.message);
    }
    return err(500, "internal", String(cause));
  }

  return NextResponse.json({
    ok: true,
    token: token.token,
    expiresAt: token.expiresAt,
    repo: { owner: site.githubRepoOwner, name: site.githubRepoName },
  });
}
