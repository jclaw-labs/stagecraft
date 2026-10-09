import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { slugify } from "@/lib/slugify";
import { prisma } from "@stagecraft/db";
import { connectedProviders, isValidHttpUrl } from "@stagecraft/shared";

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

  // Check integrations are connected
  const integrations = await prisma.integrationAccount.findMany({
    where: { userId: session.user.id },
  });

  const connected = connectedProviders(integrations);
  const hasGithub = connected.has("github");
  const hasNetlify = connected.has("netlify");

  if (!hasGithub || !hasNetlify) {
    return NextResponse.json(
      { error: "GitHub and Netlify must be connected before migrating a site" },
      { status: 400 }
    );
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

  // Enqueue migrate_site job
  const job = await prisma.siteJob.create({
    data: {
      siteId: site.id,
      userId: session.user.id,
      type: "migrate_site",
      status: "queued",
      requestPayload: {
        url: body.url,
        name: body.name,
        slug,
        blueprintType: DEFAULT_BLUEPRINT,
      },
    },
  });

  return NextResponse.json({ site, jobId: job.id }, { status: 201 });
}
