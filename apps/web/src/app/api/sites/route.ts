import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { drainAfterResponse } from "@/lib/jobs/worker";
import { slugify } from "@/lib/slugify";
import { prisma } from "@stagecraft/db";
import { enqueue } from "@stagecraft/queue";
import { connectedProviders, siteSetupIntegrationError } from "@stagecraft/shared";

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

  // Same integrations as the create_site job needs (see siteSetupIntegrationError).
  const integrations = await prisma.integrationAccount.findMany({
    where: { userId: session.user.id },
  });
  const integrationError = siteSetupIntegrationError(connectedProviders(integrations), "creating");
  if (integrationError) {
    return NextResponse.json({ error: integrationError }, { status: 400 });
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

  // Provisioning runs in the job queue, not in this request: it makes a few
  // dozen calls to GitHub and the deploy target, which would hold the
  // request open and, on Workers, count against its subrequest limit. The
  // site page polls the site (and its latest job) until it leaves
  // `creating`. See handleCreateSite for the resumable steps.
  let job;
  try {
    job = await enqueue({
      siteId: site.id,
      userId: session.user.id,
      type: "create_site",
      payload: { name, slug, blueprintType: DEFAULT_BLUEPRINT },
    });
  } catch (cause) {
    // Without a job nothing would ever move the site out of `creating`, so
    // drop it (freeing the slug) and let the artist try again.
    await prisma.site.delete({ where: { id: site.id } }).catch(() => undefined);
    console.error("[POST /api/sites] enqueue failed", {
      siteId: site.id,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return NextResponse.json({ error: "Could not start site creation. Please try again." }, { status: 500 });
  }
  drainAfterResponse();

  return NextResponse.json({ site, jobId: job.id }, { status: 201 });
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
