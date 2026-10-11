import { prisma } from "@stagecraft/db";
import { enqueue } from "@stagecraft/queue";
import type { JobStatus, JobType, SiteStatus } from "@stagecraft/shared";

import { targetShell } from "@/lib/site-upgrade";
import { readTemplateFiles } from "@/lib/template-reader";

export const UPGRADE_SITE: JobType = "upgrade_site";

/** An upgrade job in one of these states hasn't finished: another would race it. */
const IN_FLIGHT: JobStatus[] = ["queued", "running"];

/** Only a live site's repo is upgraded; one being set up, failed or archived isn't. */
const UPGRADABLE: SiteStatus = "active";

/** Why a site can't be queued for an upgrade right now. */
export type UpgradeQueueRefusal = "not_active" | "no_repo" | "in_flight";

/** The site fields deciding whether it can be upgraded. */
export interface UpgradableSite {
  id: string;
  userId: string;
  name: string;
  /** `Site.status` as Prisma reads it (a string column); compared against `SiteStatus` values. */
  status: string;
  githubRepoOwner: string | null;
  githubRepoName: string | null;
}

export const UPGRADABLE_SITE_SELECT = {
  id: true,
  userId: true,
  name: true,
  status: true,
  githubRepoOwner: true,
  githubRepoName: true,
} as const;

/** What the artist is told for each refusal. */
export const UPGRADE_REFUSAL_MESSAGES: Record<UpgradeQueueRefusal, string> = {
  not_active: "Only a live site can be upgraded",
  no_repo: "This site has no GitHub repository to upgrade",
  in_flight: "An upgrade for this site is already running",
};

/**
 * The release sites can move onto, or null while the platform bundles a
 * full copy of the template (nothing on npm's `latest` yet).
 */
export async function availableUpgradeVersion(): Promise<string | null> {
  return targetShell(await readTemplateFiles())?.packageVersion ?? null;
}

/**
 * Queue an upgrade_site job for `site`, as its owner (the job uses the
 * owner's GitHub token, whoever asked). Refuses a site that isn't live,
 * has no repo, or already has an upgrade queued or running.
 */
export async function queueSiteUpgrade(
  site: UpgradableSite,
): Promise<{ queued: true; jobId: string } | { queued: false; reason: UpgradeQueueRefusal }> {
  if (site.status !== UPGRADABLE) return { queued: false, reason: "not_active" };
  if (!site.githubRepoOwner || !site.githubRepoName) return { queued: false, reason: "no_repo" };
  const running = await prisma.siteJob.findFirst({
    where: { siteId: site.id, type: UPGRADE_SITE, status: { in: IN_FLIGHT } },
    select: { id: true },
  });
  if (running) return { queued: false, reason: "in_flight" };
  const job = await enqueue({ siteId: site.id, userId: site.userId, type: UPGRADE_SITE });
  return { queued: true, jobId: job.id };
}
