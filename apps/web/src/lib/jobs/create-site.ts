import path from "node:path";

import { prisma } from "@stagecraft/db";
import type { JobContext, JobResult } from "@stagecraft/queue";
import type { BlueprintType } from "@stagecraft/shared";

import { generateBrokerSecret } from "@/lib/broker-secret";
import { createRepo, deleteRepo, findGithubAppInstallation, pushFiles } from "@/lib/integrations/github";
import { findAppInstallationForOwner } from "@/lib/github-app-token";
import { createSite as createNetlifySite, setEnvVars as setNetlifyEnvVars } from "@/lib/integrations/netlify";
import { getResendCredentials } from "@/lib/integrations/resend";
import {
  createProject as createVercelProject,
  setEnvVars as setVercelEnvVars,
  triggerDeployment as triggerVercelDeployment,
  VercelGitHubAppNotInstalledError,
} from "@/lib/integrations/vercel";
import { readTemplateFiles } from "@/lib/template-reader";

const TEMPLATE_DIR = path.resolve(process.cwd(), "../../templates/musician-site");

interface CreateSitePayload {
  name: string;
  slug: string;
  blueprintType: BlueprintType;
}

/**
 * Pick which deploy target to use for this site, based on the artist's
 * connected integrations. Vercel takes precedence when both are
 * connected — its API is more reliable for programmatic site creation
 * (it auto-resolves GitHub App installations; Netlify's API doesn't).
 *
 * Throws if neither is connected; the route handler at POST /api/sites
 * checks this earlier, so a throw here means an integration was
 * disconnected between the request and worker invocation.
 */
async function pickDeployTarget(userId: string): Promise<"netlify" | "vercel"> {
  const integrations = await prisma.integrationAccount.findMany({
    where: { userId, provider: { in: ["netlify", "vercel"] } },
    select: { provider: true, metadata: true },
  });

  const hasVercel = integrations.some((i) => i.provider === "vercel");
  if (hasVercel) return "vercel";

  const hasNetlify = integrations.some((i) => i.provider === "netlify");
  if (hasNetlify) return "netlify";

  throw new Error("No deploy-target integration connected (Vercel or Netlify required)");
}

interface DeployResult {
  /** Generic fields shared by both providers */
  productionUrl: string;
  adminUrl: string;
  /** Netlify-only — populated when target = "netlify" */
  netlifySiteId?: string;
  netlifyLinkUrl?: string;
  /** Vercel-only — populated when target = "vercel" */
  vercelProjectId?: string;
  vercelProjectName?: string;
  vercelTeamId?: string | null;
  vercelTeamSlug?: string | null;
  /** Soft-warning if env-var provisioning partially failed */
  envWarning?: string;
}

async function deployToNetlify(args: {
  userId: string;
  siteId: string;
  slug: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  envVars: Record<string, string>;
}): Promise<DeployResult> {
  // Find Netlify's GitHub App installation on the repo owner so the
  // create-site call can use App-based cloning. Without this, Netlify
  // silently falls back to deploy-key (SSH) mode, which fails on the
  // first build with "Host key verification failed". Lookup is best-
  // effort — if Netlify's App isn't installed, we omit the field and
  // the existing fallback path (plain Netlify site + manual link URL)
  // kicks in.
  const installationId = await findGithubAppInstallation(
    args.userId,
    "netlify",
    args.repoOwner,
  );

  let netlifySite;
  let netlifyLinkUrl: string | undefined;
  try {
    netlifySite = await createNetlifySite({
      userId: args.userId,
      name: `stagecraft-site-${args.slug}`,
      repo: {
        provider: "github",
        repo_path: `${args.repoOwner}/${args.repoName}`,
        repo_branch: args.repoBranch,
        cmd: "npm run build",
        dir: ".next",
        ...(installationId !== null ? { installation_id: installationId } : {}),
      },
    });
  } catch {
    netlifySite = await createNetlifySite({
      userId: args.userId,
      name: `stagecraft-site-${args.slug}`,
    });
    netlifyLinkUrl = `https://app.netlify.com/projects/${netlifySite.siteName}/link`;
  }

  let envWarning: string | undefined;
  try {
    await setNetlifyEnvVars(args.userId, netlifySite.siteId, args.envVars);
  } catch (cause) {
    envWarning = cause instanceof Error ? cause.message : "Failed to provision Netlify env vars";
  }

  return {
    productionUrl: netlifySite.sslUrl,
    adminUrl: netlifySite.adminUrl,
    netlifySiteId: netlifySite.siteId,
    netlifyLinkUrl,
    envWarning,
  };
}

async function deployToVercel(args: {
  userId: string;
  siteId: string;
  slug: string;
  repoOwner: string;
  repoName: string;
  envVars: Record<string, string>;
}): Promise<DeployResult> {
  // Pull the team id (if any) the artist scoped at /settings → Connect Vercel.
  const integration = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId: args.userId, provider: "vercel" } },
    select: { metadata: true },
  });
  const teamId =
    integration?.metadata && typeof integration.metadata === "object" && integration.metadata !== null
      ? (integration.metadata as { teamId?: string | null }).teamId ?? undefined
      : undefined;

  const project = await createVercelProject({
    userId: args.userId,
    name: `stagecraft-site-${args.slug}`,
    teamId: teamId ?? undefined,
    repo: { repo: `${args.repoOwner}/${args.repoName}` },
    framework: "nextjs",
  });

  let envWarning: string | undefined;
  try {
    await setVercelEnvVars({
      userId: args.userId,
      projectId: project.projectId,
      teamId: project.teamId ?? undefined,
      vars: args.envVars,
    });
  } catch (cause) {
    envWarning = cause instanceof Error ? cause.message : "Failed to provision Vercel env vars";
  }

  // Vercel doesn't auto-deploy on project creation when linking to an
  // existing repo — it only deploys on subsequent pushes or webhook
  // events. Without an explicit trigger here, the production URL 404s
  // until something else (a future broker-secret provision, a manual
  // commit) kicks off the first build. Trigger one now so the artist's
  // site is live as soon as createSite returns.
  let deployWarning: string | undefined;
  try {
    await triggerVercelDeployment(
      args.userId,
      project.projectId,
      project.teamId ?? undefined,
    );
  } catch (cause) {
    deployWarning = cause instanceof Error ? cause.message : "Failed to trigger Vercel deployment";
  }

  return {
    productionUrl: project.productionUrl,
    adminUrl: project.adminUrl,
    vercelProjectId: project.projectId,
    vercelProjectName: project.projectName,
    vercelTeamId: project.teamId,
    vercelTeamSlug: project.teamSlug,
    envWarning: envWarning ?? deployWarning,
  };
}

export async function handleCreateSite(ctx: JobContext): Promise<JobResult> {
  const payload = ctx.job.requestPayload as unknown as CreateSitePayload;
  if (!payload?.slug || !payload?.name) {
    return { success: false, message: "Missing required payload fields: name, slug" };
  }

  const { name, slug } = payload;
  const userId = ctx.job.userId;
  const siteId = ctx.job.siteId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) {
      throw new Error(
        "User has no verified email — connect Resend at /settings to set it",
      );
    }

    const deployTarget = await pickDeployTarget(userId);

    // 1. Create GitHub repo
    const repoName = `stagecraft-site-${slug}`;
    const repo = await createRepo({
      userId,
      name: repoName,
      description: `${name} — musician website powered by Stagecraft`,
    });

    await prisma.site.update({
      where: { id: siteId },
      data: {
        githubRepoOwner: repo.owner,
        githubRepoName: repo.name,
        githubDefaultBranch: repo.defaultBranch,
        deployTarget,
      },
    });

    // 2. Push template files (no per-file customization — the artist
    //    personalizes content via the Puck editor at /admin once the
    //    site is up).
    const files = await readTemplateFiles(TEMPLATE_DIR);
    await pushFiles(userId, repo.owner, repo.name, repo.defaultBranch, files, `Initial site: ${name}`);

    // 3. Try to provision the broker secret upfront. When the platform's
    //    GitHub App ("stagecraft-bot") installation can be discovered for
    //    this owner, we generate the secret here and bake it into the
    //    initial deploy's env vars — no second deploy needed and the
    //    artist skips the per-site "Connect repo" step. When discovery
    //    returns null (most common: GitHub denies `/user/installations`
    //    over an OAuth token, no env-var fallback set, or App not yet
    //    installed), the existing install-callback flow is the safety
    //    net: the artist clicks "Connect repo" later, the callback
    //    generates + provisions the secret, and triggers a redeploy.
    let stagecraftInstallationId = await findGithubAppInstallation(
      userId,
      "stagecraft-bot",
      repo.owner,
    );
    if (stagecraftInstallationId === null) {
      try {
        stagecraftInstallationId = await findAppInstallationForOwner(repo.owner);
      } catch {
        // App credentials not configured — skip.
      }
    }
    const brokerSecret = stagecraftInstallationId !== null ? generateBrokerSecret() : null;
    if (brokerSecret) {
      await prisma.site.update({
        where: { id: siteId },
        data: {
          githubInstallationId: stagecraftInstallationId,
          brokerSecretHash: brokerSecret.hash,
        },
      });
    }

    // 4. Look up the artist's connected Resend credentials so the new
    //    site can send magic-link emails directly from the artist's
    //    own Resend account. POST /api/sites already gates /create on
    //    this being connected, so getResendCredentials returning null
    //    here would be a race (artist disconnected between request and
    //    job invocation) — fail fast.
    const resend = await getResendCredentials(userId);
    if (!resend) {
      throw new Error(
        "Resend account not connected — connect Resend at /settings before creating a site",
      );
    }

    // 5. Provision the deploy project on the chosen target. Both branches
    //    create the project linked to the GitHub repo and set the same
    //    runtime env vars; only the IDs they return differ.
    //
    // Intentionally NOT provisioned here (the template defaults them):
    //   - STAGECRAFT_PLATFORM_URL — hardcoded prod default in publish.ts
    //   - MAGIC_LINK_FROM — defaults to Resend sandbox in email.ts;
    //     only provisioned when the artist has a custom verified
    //     sender (a future setting; out of scope for now)
    //   - MAGIC_LINK_SIGNING_SECRET — derived from
    //     STAGECRAFT_BROKER_SECRET via HKDF inside the template's
    //     auth.ts (see deriveMagicLinkSecret); one fewer secret to
    //     provision/rotate per site
    const envVars: Record<string, string> = {
      // ADMIN_EMAIL = the platform user's email-of-record, set during
      // Resend connect by round-tripping a verification code through
      // the artist's own Resend account. Same email everywhere: sign
      // in to Stagecraft, the artist site's /admin, and the inbox that
      // receives magic-link emails.
      ADMIN_EMAIL: user.email,
      // STAGECRAFT_SITE_ID, not SITE_ID — Netlify reserves the latter
      // (auto-injects its own Netlify-side site id into Functions). Use
      // the namespaced name on Vercel too so the artist template stays
      // single-codepath.
      STAGECRAFT_SITE_ID: siteId,
      RESEND_API_KEY: resend.apiKey,
      ...(brokerSecret ? { STAGECRAFT_BROKER_SECRET: brokerSecret.plaintext } : {}),
    };

    const deploy =
      deployTarget === "vercel"
        ? await deployToVercel({
            userId,
            siteId,
            slug,
            repoOwner: repo.owner,
            repoName: repo.name,
            envVars,
          })
        : await deployToNetlify({
            userId,
            siteId,
            slug,
            repoOwner: repo.owner,
            repoName: repo.name,
            repoBranch: repo.defaultBranch,
            envVars,
          });

    // 6. Update site with target-specific metadata and mark active.
    await prisma.site.update({
      where: { id: siteId },
      data: {
        productionUrl: deploy.productionUrl,
        status: "active",
        ...(deploy.netlifySiteId
          ? { netlifySiteId: deploy.netlifySiteId, netlifyAdminUrl: deploy.adminUrl }
          : {}),
        ...(deploy.vercelProjectId
          ? {
              vercelProjectId: deploy.vercelProjectId,
              vercelProjectName: deploy.vercelProjectName,
              vercelTeamId: deploy.vercelTeamId,
              vercelTeamSlug: deploy.vercelTeamSlug,
            }
          : {}),
      },
    });

    return {
      success: true,
      data: {
        deployTarget,
        githubUrl: `https://github.com/${repo.owner}/${repo.name}`,
        adminUrl: deploy.adminUrl,
        productionUrl: deploy.productionUrl,
        ...(deploy.netlifySiteId ? { netlifyAdminUrl: deploy.adminUrl, netlifySiteId: deploy.netlifySiteId } : {}),
        ...(deploy.vercelProjectId
          ? {
              vercelProjectId: deploy.vercelProjectId,
              vercelProjectName: deploy.vercelProjectName,
            }
          : {}),
        ...(deploy.netlifyLinkUrl ? { netlifyLinkUrl: deploy.netlifyLinkUrl } : {}),
        ...(deploy.envWarning ? { envWarning: deploy.envWarning } : {}),
      },
    };
  } catch (error) {
    if (error instanceof VercelGitHubAppNotInstalledError) {
      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { githubRepoOwner: true, githubRepoName: true },
      });
      if (site?.githubRepoOwner && site.githubRepoName) {
        // Best-effort GH cleanup. If GitHub itself is rejecting requests
        // we still want to free up the Stagecraft slug — the user gets
        // an actionable next step (install Vercel App, retry) rather
        // than a half-rolled-back state that blocks new attempts on the
        // same name. Log + continue.
        try {
          await deleteRepo(userId, site.githubRepoOwner, site.githubRepoName);
        } catch (cleanupCause) {
          console.warn("[create-site] deleteRepo during Vercel-app rollback failed; continuing", {
            siteId,
            owner: site.githubRepoOwner,
            name: site.githubRepoName,
            error: cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause),
          });
        }
      }
      await prisma.site.delete({ where: { id: siteId } });

      return {
        success: false,
        message: error.message,
        failureCategory: "vercel_github_app_missing",
        data: { installUrl: error.installUrl },
      };
    }

    await prisma.site.update({
      where: { id: siteId },
      data: { status: "error" },
    });

    const message = error instanceof Error ? error.message : "Unknown error during site creation";
    return { success: false, message };
  }
}
