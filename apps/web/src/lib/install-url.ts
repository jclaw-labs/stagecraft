import { signInstallState } from "./state-signing";

/**
 * The slug of Stagecraft's GitHub App. Used to build the install URL
 * artists are sent to from "Connect repo". The slug is fixed for the
 * lifetime of this codebase (you can't rename a GitHub App without a
 * coordinated re-install across every existing artist) so we hardcode
 * it rather than wire an env var.
 */
export const STAGECRAFT_GITHUB_APP_SLUG = "stagecraft-bot";

export const STAGECRAFT_GITHUB_APP_INSTALL_URL = `https://github.com/apps/${STAGECRAFT_GITHUB_APP_SLUG}/installations/new`;

/**
 * Build the URL that the platform's "Connect repo" CTA links to.
 *
 * Pattern: `https://github.com/apps/stagecraft-bot/installations/new?state=<signed>`
 *
 * GitHub redirects the artist to the App's setup URL after install,
 * preserving the `state` query param so the install callback can route
 * the new installation to the right Site row.
 */
export async function buildInstallUrl(args: {
  siteId: string;
  userId: string;
}): Promise<string> {
  const state = await signInstallState(args);
  const url = new URL(STAGECRAFT_GITHUB_APP_INSTALL_URL);
  url.searchParams.set("state", state);
  return url.toString();
}
