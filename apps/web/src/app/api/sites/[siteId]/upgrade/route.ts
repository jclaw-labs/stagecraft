import { NextResponse } from "next/server";
import { prisma } from "@stagecraft/db";

import { auth } from "@/lib/auth";
import {
  availableUpgradeVersion,
  queueSiteUpgrade,
  UPGRADABLE_SITE_SELECT,
  UPGRADE_REFUSAL_MESSAGES,
} from "@/lib/jobs/queue-upgrade";
import { drainAfterResponse } from "@/lib/jobs/worker";

/**
 * POST /api/sites/[siteId]/upgrade — queue an upgrade_site job that opens
 * (or updates) a pull request moving the site onto the latest release of
 * the musician-site package (ADR-016 §4).
 *
 * 409 when there's no release to move onto yet, the site isn't live or has
 * no repo, or an upgrade is already queued or running.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { siteId } = await params;
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: UPGRADABLE_SITE_SELECT,
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const packageVersion = await availableUpgradeVersion();
  if (!packageVersion) {
    return NextResponse.json({ error: "There's no new release to upgrade to yet" }, { status: 409 });
  }

  const result = await queueSiteUpgrade(site);
  if (!result.queued) {
    return NextResponse.json({ error: UPGRADE_REFUSAL_MESSAGES[result.reason] }, { status: 409 });
  }

  drainAfterResponse();
  return NextResponse.json({ jobId: result.jobId, packageVersion }, { status: 202 });
}
