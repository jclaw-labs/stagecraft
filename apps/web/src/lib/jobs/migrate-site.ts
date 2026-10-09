import { prisma } from "@stagecraft/db";
import type { JobContext, JobResult } from "@stagecraft/queue";
import type { BlueprintType } from "@stagecraft/shared";

import { generateBrokerSecret } from "@/lib/broker-secret";
import { createRepo, findGithubAppInstallation, pushFiles } from "@/lib/integrations/github";
import { findAppInstallationForOwner } from "@/lib/github-app-token";
import { getResendCredentials } from "@/lib/integrations/resend";
import { crawlSite } from "@/lib/migration/crawler";
import { mapToMusicianSite } from "@/lib/migration/musician-site-mapper";
import { buildMigrationReport } from "@/lib/migration/report";
import { readTemplateFiles } from "@/lib/template-reader";
import {
  buildSiteScaffoldFiles,
  buildDependabotAutoMergeWorkflow,
  SITE_AUTOMERGE_WORKFLOW_PATH,
  templateVersionFromFiles,
} from "@/lib/site-scaffold";
// Reuse create-site's prod-proven deploy path so a migrated site is
// provisioned exactly like a created one (same musician-site template, same
// Netlify/Vercel + env-var handling). Only the content differs.
import { pickDeployTarget, deployToNetlify, deployToVercel } from "@/lib/jobs/create-site";

interface MigrateSitePayload {
  url: string;
  name: string;
  slug: string;
  blueprintType: BlueprintType;
}

export async function handleMigrateSite(ctx: JobContext): Promise<JobResult> {
  const payload = ctx.job.requestPayload as unknown as MigrateSitePayload;

  if (!payload?.url || !payload?.name || !payload?.slug) {
    return { success: false, message: "Missing required payload fields: url, name, slug" };
  }

  const { url, name, slug } = payload;
  const userId = ctx.job.userId;
  const siteId = ctx.job.siteId;

  try {
    // ADMIN_EMAIL for the migrated site = the platform user's verified email
    // (set during Resend connect). Same gate as create-site.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) {
      throw new Error("User has no verified email — connect Resend at /settings to set it");
    }

    // ── Step 1: Crawl source site ────────────────────────────────────────────
    const extracted = await crawlSite(url);
    if (extracted.pages.length === 0) {
      return {
        success: false,
        message: `Could not fetch any pages from ${url}. The site may be unavailable or block automated access.`,
        failureCategory: "unknown",
      };
    }

    // ── Step 2: Map crawled content into musician-site overlay files ──────────
    const mapped = mapToMusicianSite(extracted, name);
    const report = buildMigrationReport(extracted, mapped, name);

    const deployTarget = await pickDeployTarget(userId);

    // ── Step 3: Create GitHub repo ───────────────────────────────────────────
    const repoName = `stagecraft-site-${slug}`;
    const repo = await createRepo({
      userId,
      name: repoName,
      description: `${name} — musician website powered by Stagecraft (migrated)`,
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

    // ── Step 4: Push the musician-site template, overlaid with the crawled
    //    content + the platform scaffold (Dependabot config + template stamp).
    const templateFiles = await readTemplateFiles();
    const mappedPaths = new Set(mapped.files.map((f) => f.path));
    const files = [
      ...templateFiles.filter((f) => !mappedPaths.has(f.path)),
      ...mapped.files.map((f) => ({ path: f.path, content: f.content })),
      ...buildSiteScaffoldFiles({
        template: "musician-site",
        templateVersion: templateVersionFromFiles(templateFiles),
      }),
    ];
    await pushFiles(userId, repo.owner, repo.name, repo.defaultBranch, files, `Migrate site from ${url}`);

    // Auto-merge workflow in its own commit — see create-site.ts. Best-effort:
    // .github/workflows/ needs the `workflow` OAuth scope, and the migrated
    // site is already pushed, so a missing scope shouldn't fail the migration.
    try {
      await pushFiles(
        userId,
        repo.owner,
        repo.name,
        repo.defaultBranch,
        [{ path: SITE_AUTOMERGE_WORKFLOW_PATH, content: buildDependabotAutoMergeWorkflow() }],
        "Add Dependabot auto-merge workflow",
      );
    } catch (cause) {
      console.warn(
        "[migrate-site] auto-merge workflow push failed (missing `workflow` scope?); site migrated without it",
        {
          siteId,
          owner: repo.owner,
          name: repo.name,
          error: cause instanceof Error ? cause.message : String(cause),
        },
      );
    }

    // ── Step 5: Provision the broker secret upfront (mirrors create-site) ─────
    let stagecraftInstallationId = await findGithubAppInstallation(userId, "stagecraft-bot", repo.owner);
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
        data: { githubInstallationId: stagecraftInstallationId, brokerSecretHash: brokerSecret.hash },
      });
    }

    // ── Step 6: Resend creds + runtime env vars (mirrors create-site) ─────────
    const resend = await getResendCredentials(userId);
    if (!resend) {
      throw new Error("Resend account not connected — connect Resend at /settings before migrating a site");
    }

    const envVars: Record<string, string> = {
      ADMIN_EMAIL: user.email,
      STAGECRAFT_SITE_ID: siteId,
      RESEND_API_KEY: resend.apiKey,
      ...(brokerSecret ? { STAGECRAFT_BROKER_SECRET: brokerSecret.plaintext } : {}),
    };

    // ── Step 7: Deploy on the chosen target (reused from create-site) ─────────
    const deploy =
      deployTarget === "vercel"
        ? await deployToVercel({ userId, siteId, slug, repoOwner: repo.owner, repoName: repo.name, envVars })
        : await deployToNetlify({
            userId,
            siteId,
            slug,
            repoOwner: repo.owner,
            repoName: repo.name,
            repoBranch: repo.defaultBranch,
            envVars,
          });

    // ── Step 8: Mark site active with target-specific metadata ────────────────
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
        sourceUrl: url,
        githubUrl: `https://github.com/${repo.owner}/${repo.name}`,
        adminUrl: deploy.adminUrl,
        productionUrl: deploy.productionUrl,
        pagesCrawled: extracted.pages.length,
        pagesMapped: report.pagesMapped,
        overallConfidence: report.overallConfidence,
        report: report as unknown as Record<string, unknown>,
        ...(deploy.netlifySiteId ? { netlifySiteId: deploy.netlifySiteId, netlifyAdminUrl: deploy.adminUrl } : {}),
        ...(deploy.vercelProjectId
          ? { vercelProjectId: deploy.vercelProjectId, vercelProjectName: deploy.vercelProjectName }
          : {}),
        ...(deploy.netlifyLinkUrl ? { netlifyLinkUrl: deploy.netlifyLinkUrl } : {}),
        ...(deploy.envWarning ? { envWarning: deploy.envWarning } : {}),
      },
    };
  } catch (error) {
    await prisma.site.update({
      where: { id: siteId },
      data: { status: "error" },
    });

    const message = error instanceof Error ? error.message : "Unknown error during migration";
    return { success: false, message };
  }
}
