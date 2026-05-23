import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@stagecraft/db";
import { setRepoArchived } from "@/lib/integrations/github";
import { deleteSiteResources } from "@/lib/site-cleanup";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { siteId } = await params;

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    include: {
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Never leak the broker secret hash to the client. Even though it's
  // a hash, there's no client-side use for it and exposure widens the
  // attack surface for any future weaknesses.
  const { brokerSecretHash, ...safeSite } = site;
  void brokerSecretHash;
  return NextResponse.json({ site: safeSite });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { siteId } = await params;
  const body = await req.json();
  const { action } = body as { action: "archive" | "unarchive" };

  if (action !== "archive" && action !== "unarchive") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const archiving = action === "archive";
  const errors: string[] = [];

  // Archive/unarchive GitHub repo
  if (site.githubRepoOwner && site.githubRepoName) {
    try {
      await setRepoArchived(session.user.id, site.githubRepoOwner, site.githubRepoName, archiving);
    } catch (e) {
      errors.push(`GitHub: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  // Update site status
  await prisma.site.update({
    where: { id: siteId },
    data: {
      status: archiving ? "archived" : "active",
      archivedAt: archiving ? new Date() : null,
    },
  });

  return NextResponse.json({ site: { id: siteId, status: archiving ? "archived" : "active" }, errors });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { siteId } = await params;

  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
  });

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const errors = await deleteSiteResources(session.user.id, site);

  // Delete jobs first (FK constraint), then the site
  await prisma.siteJob.deleteMany({ where: { siteId } });
  await prisma.site.delete({ where: { id: siteId } });

  return NextResponse.json({ deleted: true, errors });
}
