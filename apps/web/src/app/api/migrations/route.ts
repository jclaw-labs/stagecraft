import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { drainAfterResponse } from "@/lib/jobs/worker";
import { slugify } from "@/lib/slugify";
import { prisma } from "@stagecraft/db";
import { enqueue } from "@stagecraft/queue";
import { connectedProviders, isValidHttpUrl, siteSetupIntegrationError } from "@stagecraft/shared";

// Site.blueprintType is a required column, but every site gets the same blueprint.
const DEFAULT_BLUEPRINT = "solo-artist";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    url?: string;
    name?: string;
  };

  if (!body.url || !body.name) {
    return NextResponse.json(
      { error: "url and name are required" },
      { status: 400 }
    );
  }

  if (!isValidHttpUrl(body.url)) {
    return NextResponse.json(
      { error: "url must be a valid http or https URL" },
      { status: 400 }
    );
  }

  // Same integrations as the migrate_site job needs, which are the ones
  // creating a site needs (see siteSetupIntegrationError).
  const integrations = await prisma.integrationAccount.findMany({
    where: { userId: session.user.id },
  });
  const integrationError = siteSetupIntegrationError(connectedProviders(integrations), "migrating");
  if (integrationError) {
    return NextResponse.json({ error: integrationError }, { status: 400 });
  }

  const slug = slugify(body.name);

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
      name: body.name,
      slug,
      blueprintType: DEFAULT_BLUEPRINT,
      status: "creating",
    },
  });

  // Runs in the job queue like create_site; the site page polls the site
  // (and its latest job) until it leaves `creating`.
  let job;
  try {
    job = await enqueue({
      siteId: site.id,
      userId: session.user.id,
      type: "migrate_site",
      payload: { url: body.url, name: body.name, slug },
    });
  } catch (cause) {
    // Without a job nothing would ever move the site out of `creating`, so
    // drop it (freeing the slug) and let the artist try again.
    await prisma.site.delete({ where: { id: site.id } }).catch(() => undefined);
    console.error("[POST /api/migrations] enqueue failed", {
      siteId: site.id,
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return NextResponse.json({ error: "Could not start the migration. Please try again." }, { status: 500 });
  }
  drainAfterResponse();

  return NextResponse.json({ site, jobId: job.id }, { status: 201 });
}
