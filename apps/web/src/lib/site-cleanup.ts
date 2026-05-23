import { deleteRepo } from "@/lib/integrations/github";
import { deleteSite as deleteNetlifySite } from "@/lib/integrations/netlify";
import { deleteProject as deleteVercelProject } from "@/lib/integrations/vercel";

/**
 * Shape of the Site fields needed for external-resource cleanup.
 * Subset of Prisma's Site row — accept anything that has these keys.
 */
export type SiteCleanupFields = {
  githubRepoOwner: string | null;
  githubRepoName: string | null;
  netlifySiteId: string | null;
  vercelProjectId: string | null;
  vercelTeamId: string | null;
};

/**
 * Best-effort delete of a site's external resources (GitHub repo + the
 * matching deploy provider's project). Errors are collected and
 * returned instead of thrown — callers always proceed to delete the
 * DB row so a stuck external resource doesn't strand the Site forever.
 *
 * Shared by `DELETE /api/sites/[siteId]` and the admin bulk-delete
 * endpoint.
 */
export async function deleteSiteResources(
  userId: string,
  site: SiteCleanupFields,
): Promise<string[]> {
  const errors: string[] = [];

  if (site.githubRepoOwner && site.githubRepoName) {
    try {
      await deleteRepo(userId, site.githubRepoOwner, site.githubRepoName);
    } catch (e) {
      const msg = `GitHub: ${e instanceof Error ? e.message : "unknown error"}`;
      console.error(`[delete-site] ${msg}`);
      errors.push(msg);
    }
  }

  if (site.netlifySiteId) {
    try {
      await deleteNetlifySite(userId, site.netlifySiteId);
    } catch (e) {
      const msg = `Netlify: ${e instanceof Error ? e.message : "unknown error"}`;
      console.error(`[delete-site] ${msg}`);
      errors.push(msg);
    }
  }

  if (site.vercelProjectId) {
    try {
      await deleteVercelProject(
        userId,
        site.vercelProjectId,
        site.vercelTeamId ?? undefined,
      );
    } catch (e) {
      const msg = `Vercel: ${e instanceof Error ? e.message : "unknown error"}`;
      console.error(`[delete-site] ${msg}`);
      errors.push(msg);
    }
  }

  return errors;
}
