import { NextResponse } from "next/server";

import { prisma } from "@stagecraft/db";

import { isStagecraftAdmin } from "@/lib/admin-allowlist";
import { auth } from "@/lib/auth";
import { deleteSiteResources } from "@/lib/site-cleanup";

/**
 * Operator-only escape hatch: delete every Site owned by the signed-in
 * user, along with the corresponding GitHub repo + Vercel/Netlify
 * project for each. Gated to the email allowlist in
 * `lib/admin-allowlist.ts`.
 *
 * Used to clean up after smoke-testing /create — accumulated
 * "stagecraft-site-jackson-clawson-N" sites that nobody intends to
 * keep. Per-site cleanup uses the same shared helper as
 * `DELETE /api/sites/[siteId]`, so external resources are best-effort
 * (errors collected, DB row deleted regardless).
 *
 * Returns a per-site report so the operator can see which external
 * cleanups failed and chase them down by hand.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isStagecraftAdmin(session.user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sites = await prisma.site.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      name: true,
      slug: true,
      githubRepoOwner: true,
      githubRepoName: true,
      netlifySiteId: true,
      vercelProjectId: true,
      vercelTeamId: true,
    },
  });

  const report: Array<{
    id: string;
    name: string;
    slug: string;
    errors: string[];
  }> = [];

  for (const site of sites) {
    const errors = await deleteSiteResources(session.user.id, site);
    await prisma.siteJob.deleteMany({ where: { siteId: site.id } });
    await prisma.site.delete({ where: { id: site.id } });
    report.push({ id: site.id, name: site.name, slug: site.slug, errors });
  }

  return NextResponse.json({
    deleted: report.length,
    sites: report,
  });
}
