import { prisma } from "@stagecraft/db";
import type { JobContext, JobResult } from "@stagecraft/queue";
import type { BlueprintType } from "@stagecraft/shared";
import { createRepo, pushFiles } from "@/lib/integrations/github";
import { createSite as createNetlifySite } from "@/lib/integrations/netlify";
import { crawlSite } from "@/lib/migration/crawler";
import { mapExtractedContent } from "@/lib/migration/mapper";
import { buildMigrationReport } from "@/lib/migration/report";
import { readTemplateFiles } from "@/lib/template-reader";
import { buildSiteScaffoldFiles, templateVersionFromFiles } from "@/lib/site-scaffold";
import path from "path";

const TEMPLATE_DIR = path.resolve(process.cwd(), "../../templates/musician-site-legacy");

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
    // ── Step 1: Crawl source site ────────────────────────────────────────────
    const extracted = await crawlSite(url);

    if (extracted.pages.length === 0) {
      return {
        success: false,
        message: `Could not fetch any pages from ${url}. The site may be unavailable or block automated access.`,
        failureCategory: "unknown",
      };
    }

    // ── Step 2: Map content to template schema ───────────────────────────────
    const mapped = mapExtractedContent(extracted, name);

    // ── Step 3: Build migration report ──────────────────────────────────────
    const report = buildMigrationReport(extracted, mapped, name);

    // ── Step 4: Create GitHub repo ───────────────────────────────────────────
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
      },
    });

    // ── Step 5: Push template base ───────────────────────────────────────────
    const templateFiles = await readTemplateFiles(TEMPLATE_DIR, (relativePath, content) => {
      if (relativePath === "src/content/config/site.json") {
        const cfg = JSON.parse(content) as Record<string, unknown>;
        cfg.artistName = name;
        cfg.siteTitle = `${name} — Official Website`;
        return JSON.stringify(cfg, null, 2) + "\n";
      }
      return content;
    });

    // Build final file list: template base, then overlay with mapped content
    const mappedPaths = new Set(mapped.files.map((f) => f.path));
    const baseFiles = templateFiles.filter((f) => !mappedPaths.has(f.path));
    const allFiles = [
      ...baseFiles,
      ...mapped.files.map((f) => ({ path: f.path, content: f.content })),
    ];
    allFiles.push(
      ...buildSiteScaffoldFiles({
        template: "musician-site-legacy",
        templateVersion: templateVersionFromFiles(templateFiles),
      }),
    );

    await pushFiles(
      userId,
      repo.owner,
      repo.name,
      repo.defaultBranch,
      allFiles,
      `Migrate site from ${url}`
    );

    // ── Step 6: Create Netlify site ──────────────────────────────────────────
    const netlifySite = await createNetlifySite({
      userId,
      name: `stagecraft-site-${slug}`,
      repo: {
        provider: "github",
        repo_path: `${repo.owner}/${repo.name}`,
        repo_branch: repo.defaultBranch,
        cmd: "npm run build",
        dir: "dist",
      },
    });

    // ── Step 7: Mark site active ─────────────────────────────────────────────
    await prisma.site.update({
      where: { id: siteId },
      data: {
        netlifySiteId: netlifySite.siteId,
        netlifyAdminUrl: netlifySite.adminUrl,
        productionUrl: netlifySite.sslUrl,
        status: "active",
      },
    });

    return {
      success: true,
      data: {
        sourceUrl: url,
        githubUrl: `https://github.com/${repo.owner}/${repo.name}`,
        netlifyAdminUrl: netlifySite.adminUrl,
        netlifySiteId: netlifySite.siteId,
        pagesCrawled: extracted.pages.length,
        pagesMapped: report.pagesMapped,
        overallConfidence: report.overallConfidence,
        report: report as unknown as Record<string, unknown>,
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
