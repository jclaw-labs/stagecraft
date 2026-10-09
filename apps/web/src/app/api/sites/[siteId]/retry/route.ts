import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { drainAfterResponse } from "@/lib/jobs/worker";
import { prisma } from "@stagecraft/db";
import type { JobStatus, JobType, SiteStatus } from "@stagecraft/shared";

const CREATE_SITE: JobType = "create_site";
const FAILED: JobStatus = "failed";
const QUEUED: JobStatus = "queued";
const ERROR: SiteStatus = "error";
const CREATING: SiteStatus = "creating";

/**
 * POST /api/sites/[siteId]/retry — re-queue a site's failed create_site job.
 *
 * The job keeps its step progress, so the new run skips every step that
 * already finished (an existing repo isn't created again) and resumes at the
 * one that failed. The retry budget resets, so it gets the usual automatic
 * retries too.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ siteId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { siteId } = await params;
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { id: true, status: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const job = await prisma.siteJob.findFirst({
    where: { siteId, type: CREATE_SITE },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (site.status !== ERROR || !job || job.status !== FAILED) {
    return NextResponse.json(
      { error: "Only a site whose setup failed can be retried" },
      { status: 409 },
    );
  }

  // Flip the site back to `creating` before the job is claimable, so a
  // worker that picks the job up at once can't finish (and mark the site
  // active) before this write lands. Both writes are conditional, so a
  // double click re-queues the job once.
  const reopened = await prisma.site.updateMany({
    where: { id: siteId, status: ERROR },
    data: { status: CREATING },
  });
  if (reopened.count === 0) {
    return NextResponse.json({ error: "This site's setup is already being retried" }, { status: 409 });
  }

  const requeued = await prisma.siteJob.updateMany({
    where: { id: job.id, status: FAILED },
    data: {
      status: QUEUED,
      retryAttempts: 0,
      runAt: null,
      startedAt: null,
      completedAt: null,
      lockedUntil: null,
      errorMessage: null,
      failureCategory: null,
    },
  });
  if (requeued.count === 0) {
    await prisma.site.updateMany({ where: { id: siteId, status: CREATING }, data: { status: ERROR } });
    return NextResponse.json({ error: "This site's setup is already being retried" }, { status: 409 });
  }

  drainAfterResponse();

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
