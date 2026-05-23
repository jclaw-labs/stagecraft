import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { handleCreateSite } from "@/lib/jobs/create-site";
import { slugify } from "@/lib/slugify";
import { prisma } from "@stagecraft/db";
import type { JobContext } from "@stagecraft/queue";

const DEFAULT_BLUEPRINT = "solo-artist";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    name?: string;
  };

  if (!body.name) {
    return NextResponse.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  const name = body.name.trim();
  if (name.length < 2 || name.length > 60) {
    return NextResponse.json(
      { error: "Site name must be between 2 and 60 characters" },
      { status: 400 }
    );
  }

  // Check integrations are connected. GitHub is always required (the
  // platform commits to the artist's repo). The deploy target can be
  // either Vercel OR Netlify — at least one must be connected.
  const integrations = await prisma.integrationAccount.findMany({
    where: { userId: session.user.id },
  });

  const hasGithub = integrations.some((i: { provider: string }) => i.provider === "github");
  const hasNetlify = integrations.some((i: { provider: string }) => i.provider === "netlify");
  const hasVercel = integrations.some((i: { provider: string }) => i.provider === "vercel");
  const hasResend = integrations.some((i: { provider: string }) => i.provider === "resend");

  if (!hasGithub) {
    return NextResponse.json(
      { error: "GitHub must be connected before creating a site" },
      { status: 400 }
    );
  }
  if (!hasNetlify && !hasVercel) {
    return NextResponse.json(
      { error: "A deploy target must be connected (Vercel or Netlify) before creating a site" },
      { status: 400 }
    );
  }
  if (!hasResend) {
    return NextResponse.json(
      { error: "Resend must be connected (for magic-link sign-in on artist sites) before creating a site" },
      { status: 400 }
    );
  }

  const slug = slugify(name);

  // Check slug uniqueness
  const existing = await prisma.site.findUnique({ where: { slug } });
  if (existing) {
    return NextResponse.json(
      { error: "A site with this name already exists" },
      { status: 409 }
    );
  }

  const site = await prisma.site.create({
    data: {
      userId: session.user.id,
      name,
      slug,
      blueprintType: DEFAULT_BLUEPRINT,
      status: "creating",
    },
  });

  // Run create_site synchronously inside this request handler.
  //
  // The previous design enqueued a SiteJob and let a poll-based worker
  // process it. That doesn't work on Netlify Functions: each Lambda
  // invocation freezes when the HTTP handler returns, so any awaits in
  // a "background" job get abandoned and the SiteJob stays in `running`
  // forever. Awaiting directly here blocks the request for ~5-10s but
  // the outcome is deterministic.
  //
  // The SiteJob row is still created (status starts at `running`) for
  // audit + compatibility with the existing dashboard, then updated
  // with the result before the response is returned.
  const job = await prisma.siteJob.create({
    data: {
      siteId: site.id,
      userId: session.user.id,
      type: "create_site",
      status: "running",
      requestPayload: {
        name,
        slug,
        blueprintType: DEFAULT_BLUEPRINT,
      },
      startedAt: new Date(),
    },
  });

  const ctx: JobContext = { job };
  const result = await handleCreateSite(ctx);

  await prisma.siteJob.update({
    where: { id: job.id },
    data: {
      status: result.success ? "completed" : "failed",
      completedAt: new Date(),
      // Prisma's InputJsonValue requires plain JSON shapes; result.data
      // is Record<string, unknown> from the JobResult type.
      resultPayload: result.data
        ? (result.data as Record<string, unknown> as object)
        : undefined,
      errorMessage: result.message ?? null,
      failureCategory: result.failureCategory ?? null,
    },
  });

  if (result.failureCategory === "vercel_github_app_missing") {
    return NextResponse.json(
      {
        error: result.message,
        failureCategory: result.failureCategory,
        installUrl: result.data?.installUrl,
      },
      { status: 400 },
    );
  }

  // Re-read the site so the response reflects whatever handleCreateSite
  // wrote during the run (githubRepoOwner/Name, netlifySiteId,
  // productionUrl, status transitioning to active or error).
  const finalSite = await prisma.site.findUnique({ where: { id: site.id } });

  return NextResponse.json(
    {
      site: finalSite,
      jobId: job.id,
      jobResult: result,
      ...(result.success ? {} : { error: result.message }),
    },
    { status: result.success ? 201 : 500 },
  );
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sites = await prisma.site.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      jobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return NextResponse.json({ sites });
}
