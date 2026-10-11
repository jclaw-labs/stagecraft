import { NextResponse } from "next/server";
import { prisma } from "@stagecraft/db";
import type { SiteStatus } from "@stagecraft/shared";

import { isStagecraftAdmin } from "@/lib/admin-allowlist";
import { auth } from "@/lib/auth";
import {
  availableUpgradeVersion,
  queueSiteUpgrade,
  UPGRADABLE_SITE_SELECT,
  type UpgradeQueueRefusal,
} from "@/lib/jobs/queue-upgrade";
import { drainAfterResponse } from "@/lib/jobs/worker";

const ACTIVE: SiteStatus = "active";

/**
 * POST /api/admin/upgrade-sites — platform admins only: queue an
 * upgrade_site job for every live site on the platform, whoever owns it
 * (ADR-016 §4's rollout). Each job runs as the site's owner, with their
 * GitHub token, and opens or updates that site's upgrade pull request; a
 * customized site stops without one and reports its changed files on its
 * job.
 *
 * The worker runs the jobs one at a time (this request starts the first;
 * the cron drain takes the rest). Sites with an upgrade already queued or
 * running are skipped, so running it twice queues nothing new.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isStagecraftAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const packageVersion = await availableUpgradeVersion();
  if (!packageVersion) {
    return NextResponse.json({ error: "There's no new release to upgrade to yet" }, { status: 409 });
  }

  const sites = await prisma.site.findMany({
    where: { status: ACTIVE },
    select: UPGRADABLE_SITE_SELECT,
    orderBy: { createdAt: "asc" },
  });

  const queued: Array<{ id: string; name: string; jobId: string }> = [];
  const skipped: Array<{ id: string; name: string; reason: UpgradeQueueRefusal }> = [];
  for (const site of sites) {
    const result = await queueSiteUpgrade(site);
    if (result.queued) queued.push({ id: site.id, name: site.name, jobId: result.jobId });
    else skipped.push({ id: site.id, name: site.name, reason: result.reason });
  }

  if (queued.length > 0) drainAfterResponse();
  return NextResponse.json({ packageVersion, queued, skipped }, { status: 202 });
}
