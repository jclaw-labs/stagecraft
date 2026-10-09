import {
  type InstallationToken,
  type InstallationTokenScope,
  mintInstallationToken,
} from "./github-app-token";

/**
 * What an artist site needs to publish: write commits to its own repo.
 * `metadata: read` is implied by any repo permission, but naming it keeps
 * the request explicit about the whole grant.
 */
export const SITE_TOKEN_PERMISSIONS: InstallationTokenScope["permissions"] = {
  contents: "write",
  metadata: "read",
};

/**
 * A cached token is handed out only while it has at least this long left,
 * so a publish that starts with it can't see it expire mid-commit.
 */
export const SITE_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type SiteTokenTarget = {
  siteId: string;
  installationId: number;
  repoName: string;
};

type CacheEntry = {
  installationId: number;
  repoName: string;
  token: InstallationToken;
};

// In-memory and per server instance: a cold start just mints again.
const cache = new Map<string, CacheEntry>();

/**
 * Return an installation token limited to the site's own repo and to
 * SITE_TOKEN_PERMISSIONS, reusing the site's cached token until it is within
 * SITE_TOKEN_REFRESH_MARGIN_MS of expiry. A change to the site's
 * installation or repo invalidates its entry.
 */
export async function getSiteInstallationToken(
  target: SiteTokenTarget,
  now: () => number = Date.now,
): Promise<InstallationToken> {
  const cached = cache.get(target.siteId);
  if (
    cached &&
    cached.installationId === target.installationId &&
    cached.repoName === target.repoName &&
    Date.parse(cached.token.expiresAt) - now() > SITE_TOKEN_REFRESH_MARGIN_MS
  ) {
    return cached.token;
  }

  const token = await mintInstallationToken(target.installationId, {
    repositoryNames: [target.repoName],
    permissions: SITE_TOKEN_PERMISSIONS,
  });
  cache.set(target.siteId, {
    installationId: target.installationId,
    repoName: target.repoName,
    token,
  });
  return token;
}

/** Drop every cached token. For tests. */
export function clearSiteTokenCache(): void {
  cache.clear();
}
