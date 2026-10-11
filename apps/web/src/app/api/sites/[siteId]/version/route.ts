import { NextResponse } from "next/server";
import { prisma } from "@stagecraft/db";

import { auth } from "@/lib/auth";
import { GitHubApiError, GitHubNotConnectedError, githubRepoClient } from "@/lib/integrations/github";
import { readSiteVersion } from "@/lib/site-version";

/**
 * GET /api/sites/[siteId]/version — the musician-site release a site is on,
 * the one "Upgrade site" would move it to, the latest one on npm, and the
 * open pull request that would update it (`SiteVersionInfo`), read live from
 * the site's repo with the owner's GitHub sign-in.
 *
 * 409 when the site has no repo, or GitHub isn't connected or the sign-in
 * has expired (`reauthRequired: true`); 502 when GitHub can't be read.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { siteId } = await params;
  const site = await prisma.site.findFirst({
    where: { id: siteId, userId: session.user.id },
    select: { githubRepoOwner: true, githubRepoName: true, githubDefaultBranch: true },
  });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  if (!site.githubRepoOwner || !site.githubRepoName) {
    return NextResponse.json({ error: "This site has no GitHub repository" }, { status: 409 });
  }

  try {
    const client = await githubRepoClient(session.user.id, site.githubRepoOwner, site.githubRepoName);
    const version = await readSiteVersion(client, site.githubDefaultBranch);
    return NextResponse.json({ version });
  } catch (error) {
    if (error instanceof GitHubNotConnectedError || (error instanceof GitHubApiError && error.status === 401)) {
      return NextResponse.json(
        { error: "Sign in with GitHub again to see which version this site runs", reauthRequired: true },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Couldn't read this site's version from GitHub" }, { status: 502 });
  }
}
