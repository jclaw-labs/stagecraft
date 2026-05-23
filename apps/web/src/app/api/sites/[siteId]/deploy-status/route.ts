import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@stagecraft/db";

import { auth } from "@/lib/auth";
import { getLatestDeploy as getNetlifyLatestDeploy } from "@/lib/integrations/netlify";
import { getLatestDeployment as getVercelLatestDeployment } from "@/lib/integrations/vercel";

/**
 * Latest deploy status for a site, normalized across deploy targets.
 * Used by /sites/[id] to drive the "Building / Ready" UI after /create
 * (the platform's own Site.status only tracks creation; the deploy
 * target's build state is what gates the "Visit site" CTA).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { siteId } = await params;
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: {
      deployTarget: true,
      vercelProjectId: true,
      vercelTeamId: true,
      netlifySiteId: true,
    },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  try {
    if (site.deployTarget === "vercel" && site.vercelProjectId) {
      const d = await getVercelLatestDeployment(
        session.user.id,
        site.vercelProjectId,
        site.vercelTeamId ?? undefined,
      );
      return NextResponse.json({ deploy: d });
    }
    if (site.deployTarget === "netlify" && site.netlifySiteId) {
      const d = await getNetlifyLatestDeploy(session.user.id, site.netlifySiteId);
      return NextResponse.json({ deploy: d });
    }
    return NextResponse.json({
      deploy: { id: null, state: "unknown", url: null, createdAt: null },
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Failed to fetch deploy status" },
      { status: 502 },
    );
  }
}
