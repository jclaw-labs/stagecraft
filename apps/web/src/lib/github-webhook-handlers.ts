import { prisma, type Prisma } from "@stagecraft/db";

export type InstallationAction =
  | "created"
  | "deleted"
  | "suspend"
  | "unsuspend"
  | "new_permissions_accepted";

export type RepositoriesAction = "added" | "removed";

export type RepoRef = { name: string };

/**
 * The client a handler writes through. The webhook route passes its
 * transaction client so the handler's writes commit or roll back together
 * with the delivery record.
 */
export type WebhookDb = Prisma.TransactionClient;

export type HandlerResult = {
  /** True if the event resulted in a DB write. */
  applied: boolean;
  /** Short description for audit logs / replies. */
  note: string;
};

/**
 * Handle an `installation.{action}` webhook. Returns a description of
 * the resulting state change (or no-op).
 *
 * Notes:
 * - `installation.created` is usually a no-op since the install_callback
 *   already wired the Site row up. Treat as a sanity event.
 * - `installation.deleted` clears the installation/repo fields but
 *   intentionally retains brokerSecretHash — losing the install does
 *   not invalidate the artist's secret; reinstalling on a new repo can
 *   reuse it. Rotation is a separate explicit action.
 */
export async function handleInstallationEvent(
  action: InstallationAction,
  installationId: number,
  db: WebhookDb = prisma,
): Promise<HandlerResult> {
  const site = await db.site.findFirst({ where: { githubInstallationId: installationId } });
  if (!site) {
    return { applied: false, note: `no site found for installation ${installationId}` };
  }

  switch (action) {
    case "suspend":
      await db.site.update({
        where: { id: site.id },
        data: { githubAppSuspended: true },
      });
      return { applied: true, note: `suspended site ${site.id}` };

    case "unsuspend":
      await db.site.update({
        where: { id: site.id },
        data: { githubAppSuspended: false },
      });
      return { applied: true, note: `unsuspended site ${site.id}` };

    case "deleted":
      await db.site.update({
        where: { id: site.id },
        data: {
          githubInstallationId: null,
          githubRepoOwner: null,
          githubRepoName: null,
          githubAppSuspended: false,
        },
      });
      return { applied: true, note: `cleared installation for site ${site.id}` };

    case "created":
    case "new_permissions_accepted":
      return { applied: false, note: `acknowledged ${action} for site ${site.id}` };
  }
}

/**
 * Handle an `installation_repositories.{action}` webhook. We model one
 * Site = one repository, so the only meaningful case is when the
 * already-configured repo is removed: clear the repo fields (treat as
 * partial uninstall). Adds and unrelated removes are logged-only.
 */
export async function handleRepositoriesEvent(
  action: RepositoriesAction,
  installationId: number,
  repos: RepoRef[],
  db: WebhookDb = prisma,
): Promise<HandlerResult> {
  if (action !== "removed") {
    return { applied: false, note: `${action} for installation ${installationId} (no-op)` };
  }

  const site = await db.site.findFirst({ where: { githubInstallationId: installationId } });
  if (!site || !site.githubRepoName) {
    return { applied: false, note: `no site or no configured repo for ${installationId}` };
  }

  const matched = repos.some((r) => r.name === site.githubRepoName);
  if (!matched) {
    return { applied: false, note: `removal didn't match site repo ${site.githubRepoName}` };
  }

  await db.site.update({
    where: { id: site.id },
    data: {
      githubInstallationId: null,
      githubRepoOwner: null,
      githubRepoName: null,
    },
  });
  return { applied: true, note: `cleared repo for site ${site.id}` };
}
