import { GitHubApiError, setRepoArchived } from "@/lib/integrations/github";
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
 * Best-effort cleanup of a site's external resources: deletes the deploy
 * provider's project and archives the GitHub repo.
 *
 * The repo is archived, not deleted: the platform no longer requests the
 * `delete_repo` OAuth scope, and the repo is the artist's to keep
 * (issue #398). Archiving (issue #429) stops Dependabot pull requests and
 * the auto-merge workflow on a repo nothing deploys any more; the artist
 * can unarchive it on GitHub. An archived repo still holds its name.
 *
 * Errors are collected and returned instead of thrown — callers always
 * proceed to delete the DB row so a stuck external resource doesn't
 * strand the Site forever.
 *
 * Shared by `DELETE /api/sites/[siteId]` and the admin bulk-delete
 * endpoint.
 */
export async function deleteSiteResources(
  userId: string,
  site: SiteCleanupFields,
): Promise<string[]> {
  const errors: string[] = [];

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

  if (site.githubRepoOwner && site.githubRepoName) {
    try {
      await setRepoArchived(userId, site.githubRepoOwner, site.githubRepoName, true);
    } catch (e) {
      // 404 usually means the artist already deleted the repo, so there is
      // nothing to archive. GitHub also answers 404 for a private repo the
      // token can't see (another account, a transfer), so it is logged, not
      // reported: failing the delete for a repo that is most likely gone
      // would only alarm the artist.
      if (e instanceof GitHubApiError && e.status === 404) {
        console.warn(
          `[delete-site] GitHub: ${site.githubRepoOwner}/${site.githubRepoName} not found (404); treating it as already deleted`,
        );
      } else {
        const reason = e instanceof Error ? e.message : "unknown error";
        const msg = `GitHub: could not archive ${site.githubRepoOwner}/${site.githubRepoName}: ${reason}`;
        console.error(`[delete-site] ${msg}`);
        errors.push(msg);
      }
    }
  }

  return errors;
}
