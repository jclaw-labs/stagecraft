/**
 * OAuth scopes the platform requests when an artist signs in with GitHub.
 *
 * - `read:user`, `user:email`: identify the artist.
 * - `repo`: create the artist's (private) site repo and push to it.
 * - `workflow`: lets the platform's push write files under
 *   `.github/workflows/` on generated artist repos — required for the
 *   Dependabot auto-merge workflow.
 *
 * `delete_repo` is deliberately absent (issue #398): deleting a site keeps
 * its repo, and the artist deletes it from GitHub if they want it gone.
 */
export const GITHUB_OAUTH_SCOPES = ["read:user", "user:email", "repo", "workflow"] as const;

export type GitHubOAuthScope = (typeof GITHUB_OAUTH_SCOPES)[number];

/** Space-separated scope string for the GitHub authorize URL. */
export const GITHUB_OAUTH_SCOPE = GITHUB_OAUTH_SCOPES.join(" ");
