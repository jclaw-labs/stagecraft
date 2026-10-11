"use server";

import { signIn } from "@/lib/auth";

/**
 * Send the artist through GitHub sign-in again, back to this site's page.
 * A token from before the platform asked for the `workflow` scope, or one
 * GitHub has revoked, can't open an upgrade pull request; signing in again
 * stores a fresh token with every scope (`GITHUB_OAUTH_SCOPES`).
 */
export async function signInWithGitHubAgain(siteId: string): Promise<void> {
  await signIn("github", { redirectTo: `/sites/${encodeURIComponent(siteId)}` });
}
