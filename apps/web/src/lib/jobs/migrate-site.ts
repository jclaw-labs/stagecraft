import type { Prisma } from "@stagecraft/db";
import type { JobContext, JobResult } from "@stagecraft/queue";
import type { BlueprintType } from "@stagecraft/shared";

import { crawlSite } from "@/lib/migration/crawler";
import { mapToMusicianSite } from "@/lib/migration/musician-site-mapper";
import { buildMigrationReport, type MigrationReport } from "@/lib/migration/report";
import type { TemplateFile } from "@/lib/template-reader";
import {
  checkProvisionPreconditions,
  PermanentProvisionError,
  PROVISION_STEPS,
  provisionSite,
  runProvisionJob,
} from "./provision-site";

interface MigrateSitePayload {
  url: string;
  name: string;
  slug: string;
  blueprintType: BlueprintType;
}

/**
 * The migrate_site steps, in order: crawl the source site, then the shared
 * provisioning steps. Recorded on the job like create_site's, so a retried
 * run resumes at the step that failed.
 */
export const MIGRATE_SITE_STEPS = ["crawlSource", ...PROVISION_STEPS] as const;

/**
 * The `crawlSource` step's result: the content to push over the template
 * and the report shown on the site page. Stored so a resumed run pushes the
 * same content instead of crawling again.
 */
type CrawlResult = { files: TemplateFile[]; report: MigrationReport };

/**
 * The migrate_site job handler, run by the job queue (see lib/jobs/worker.ts).
 *
 * Crawls the source site and maps it onto musician-site content files, then
 * provisions the site through `provisionSite` exactly like create_site, with
 * those files as the content overlay. Retries and failures are handled by
 * `runProvisionJob`.
 */
export async function handleMigrateSite(ctx: JobContext): Promise<JobResult> {
  return runProvisionJob(ctx, {
    requiredFields: ["url", "name", "slug"],
    unknownErrorMessage: "Unknown error during migration",
    run: async (runner) => {
      const { url, name, slug } = ctx.job.requestPayload as unknown as MigrateSitePayload;
      const userId = ctx.job.userId;
      // Checked before crawling, so a missing integration fails fast.
      const preconditions = await checkProvisionPreconditions(userId, "migrating");

      const crawl = (await runner.run("crawlSource", async () => {
        const extracted = await crawlSite(url);
        if (extracted.pages.length === 0) {
          throw new PermanentProvisionError(
            `Could not fetch any pages from ${url}. The site may be unavailable or block automated access.`,
          );
        }
        const mapped = mapToMusicianSite(extracted, name);
        const result: CrawlResult = {
          files: mapped.files.map((f) => ({ path: f.path, content: f.content })),
          report: buildMigrationReport(extracted, mapped, name),
        };
        return result as unknown as Prisma.JsonObject;
      })) as unknown as CrawlResult;

      const site = await provisionSite({
        runner,
        siteId: ctx.job.siteId,
        userId,
        name,
        slug,
        preconditions,
        contentOverlay: crawl.files,
        repoDescription: `${name} — musician website powered by Stagecraft (migrated)`,
        commitMessage: `Migrate site from ${url}`,
      });

      const { report } = crawl;
      return {
        success: true,
        data: {
          ...site,
          sourceUrl: url,
          pagesCrawled: report.pagesCrawled,
          pagesMapped: report.pagesMapped,
          overallConfidence: report.overallConfidence,
          report: report as unknown as Record<string, unknown>,
          steps: runner.progress(),
        },
      };
    },
  });
}
