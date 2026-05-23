import { NextResponse } from "next/server";

import { prisma } from "@stagecraft/db";

import { auth } from "@/lib/auth";
import { generateBrokerSecret } from "@/lib/broker-secret";
import { listInstallationRepos } from "@/lib/github-app-install";
import {
  findAppInstallationForOwner,
  GitHubAppMisconfiguredError,
} from "@/lib/github-app-token";
import { buildInstallUrl } from "@/lib/install-url";
import {
  setEnvVars as setVercelEnvVars,
  triggerDeployment as triggerVercelDeployment,
} from "@/lib/integrations/vercel";
import {
  setEnvVars as setNetlifyEnvVars,
  triggerBuild as triggerNetlifyBuild,
} from "@/lib/integrations/netlify";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { siteId } = await params;
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // If the site already has a repo owner, try to auto-detect the
  // existing GitHub App installation using App-level JWT auth. This
  // avoids redirecting to GitHub (which is a no-op when the app is
  // already installed on all repos).
  if (site.githubRepoOwner && !site.githubInstallationId) {
    try {
      const installationId = await findAppInstallationForOwner(site.githubRepoOwner);
      if (installationId) {
        const repos = await listInstallationRepos(installationId);
        const hasAccess = repos.some(
          (r) => r.owner === site.githubRepoOwner && r.name === site.githubRepoName,
        );

        if (hasAccess) {
          const { plaintext, hash } = generateBrokerSecret();
          await prisma.site.update({
            where: { id: site.id },
            data: {
              githubInstallationId: installationId,
              brokerSecretHash: hash,
              githubAppSuspended: false,
            },
          });

          // Push broker secret to the deploy target.
          const platformUrl = (process.env.AUTH_URL ?? "").replace(/\/$/, "");
          const envVars: Record<string, string> = {
            STAGECRAFT_PLATFORM_URL: platformUrl,
            STAGECRAFT_SITE_ID: site.id,
            STAGECRAFT_BROKER_SECRET: plaintext,
          };

          let provisioned = false;
          try {
            if (site.deployTarget === "vercel" && site.vercelProjectId) {
              await setVercelEnvVars({
                userId: session.user.id,
                projectId: site.vercelProjectId,
                teamId: site.vercelTeamId ?? undefined,
                vars: envVars,
              });
              await triggerVercelDeployment(
                session.user.id,
                site.vercelProjectId,
                site.vercelTeamId ?? undefined,
              );
              provisioned = true;
            } else if (site.deployTarget === "netlify" && site.netlifySiteId) {
              await setNetlifyEnvVars(session.user.id, site.netlifySiteId, envVars);
              await triggerNetlifyBuild(session.user.id, site.netlifySiteId);
              provisioned = true;
            }
          } catch {
            // Auto-provision failed; the site is still connected, just
            // needs manual env var setup — same as the callback fallback.
          }

          return NextResponse.json({
            connected: true,
            provisioned,
            message: provisioned
              ? "GitHub App connected and broker secret deployed. Your site is rebuilding."
              : "GitHub App connected, but we couldn't push the broker secret automatically. Set STAGECRAFT_BROKER_SECRET on your deploy target.",
          });
        }
      }
    } catch (cause) {
      if (cause instanceof GitHubAppMisconfiguredError) {
        return NextResponse.json(
          { error: "GitHub App not configured on the platform (missing GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)" },
          { status: 500 },
        );
      }
      // Auto-detection failed — fall through to the redirect flow.
    }
  }

  try {
    const url = await buildInstallUrl({ siteId: site.id, userId: session.user.id });
    return NextResponse.json({ url });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return NextResponse.json({ error: `Install URL not configured: ${message}` }, { status: 500 });
  }
}
