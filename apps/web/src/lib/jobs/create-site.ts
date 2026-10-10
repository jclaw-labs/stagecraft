import type { JobContext, JobResult } from "@stagecraft/queue";

import { checkProvisionPreconditions, PROVISION_STEPS, provisionSite, runProvisionJob } from "./provision-site";

interface CreateSitePayload {
  name: string;
  slug: string;
}

/**
 * The create_site steps, in order: the shared provisioning steps. Each one's
 * completion (and JSON result) is recorded on the job's
 * `resultPayload.steps`, so a retried or resumed run skips the finished ones.
 */
export const CREATE_SITE_STEPS = PROVISION_STEPS;

/**
 * The create_site job handler, run by the job queue (see lib/jobs/worker.ts).
 *
 * Provisions the site through `provisionSite` with the template as-is (no
 * content overlay). Retries, failures and the manual retry
 * (POST /api/sites/[siteId]/retry) are handled by `runProvisionJob`.
 */
export async function handleCreateSite(ctx: JobContext): Promise<JobResult> {
  return runProvisionJob<CreateSitePayload>(ctx, {
    requiredFields: ["name", "slug"],
    unknownErrorMessage: "Unknown error during site creation",
    run: async (runner) => {
      const payload = ctx.job.requestPayload as unknown as CreateSitePayload;
      const userId = ctx.job.userId;
      const preconditions = await checkProvisionPreconditions(userId, "creating");

      const site = await provisionSite({
        runner,
        siteId: ctx.job.siteId,
        userId,
        name: payload.name,
        slug: payload.slug,
        preconditions,
        action: "creating",
        contentOverlay: [],
        repoDescription: `${payload.name} — musician website powered by Stagecraft`,
        commitMessage: `Initial site: ${payload.name}`,
      });

      return { success: true, data: { ...site, steps: runner.progress() } };
    },
  });
}
