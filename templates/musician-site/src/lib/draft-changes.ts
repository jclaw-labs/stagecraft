/**
 * Pending-changes summary used by the admin chrome.
 *
 * Supersedes the earlier `draft-status` utility, which only returned
 * a boolean. The indicator now wants a count ("3 unpublished
 * changes"); the upcoming publish modal will want the per-item list.
 * Both come from one GitHub `compareCommitsWithBasehead` call so we
 * pay for the diff once.
 *
 * The compare API truncates `files` at 300 entries; this is the
 * documented behavior. Artist sites that exceed it between publishes
 * are an outlier — when that does come up we'll either show "300+"
 * or page through the files. The boolean / "anything pending?"
 * signal stays accurate either way because `ahead_by` is unaffected
 * by the truncation.
 */

import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

import {
  DRAFT_BRANCH,
  fetchPublishToken,
  isPlatformConfigured,
  PublishError,
  readEnv,
  type Env,
} from "./publish";

/**
 * Cross-container draft summary.
 *
 * - `mode: "local"` — dev / unconfigured. There's no draft branch to
 *   diff against; `count` is always 0.
 * - `mode: "github"` — production. `count` is the number of file
 *   changes between `main` and `draft` (per `compareCommitsWithBasehead`,
 *   truncated at 300 by the GitHub API). A fresh site with no
 *   `draft` branch yet resolves to `count: 0`.
 */
export type DraftChanges = {
  count: number;
  mode: "local" | "github";
};

/**
 * Errors `getDraftChanges` can throw. Same code set as the prior
 * `DraftStatusError`, plus we re-use the broker error mapping so
 * admin code that switches over this matches the publish-error
 * pattern.
 *
 * - `broker-unreachable`: network blip at token-mint time.
 *   Recoverable next request.
 * - `broker-rejected`: per-site secret bad / siteId unknown.
 *   Permanent config error; surface it.
 * - `github-failed`: a non-404 error talking to GitHub. Bug or
 *   transient outage.
 */
export class DraftChangesError extends Error {
  constructor(
    public code: "broker-unreachable" | "broker-rejected" | "github-failed",
    message: string,
  ) {
    super(message);
    this.name = "DraftChangesError";
  }
}

export async function getDraftChanges(env: Env = readEnv()): Promise<DraftChanges> {
  if (!isPlatformConfigured(env)) {
    return { count: 0, mode: "local" };
  }

  let token: string;
  let owner: string;
  let repo: string;
  try {
    ({ token, owner, repo } = await fetchPublishToken(env));
  } catch (cause) {
    if (cause instanceof PublishError) {
      if (cause.code === "broker-unreachable" || cause.code === "broker-rejected") {
        throw new DraftChangesError(cause.code, cause.message);
      }
    }
    throw new DraftChangesError("github-failed", String(cause));
  }

  const octokit = new Octokit({ auth: token });

  try {
    const compare = await octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${env.branch}...${DRAFT_BRANCH}`,
    });
    // The compare endpoint also returns metadata like ahead_by /
    // behind_by — useful for distinguishing "draft is fresh" from
    // "draft has diverged in non-publishable ways" — but the file
    // count is what the UI surfaces today. Keep the type narrow
    // until a consumer wants more.
    return {
      count: compare.data.files?.length ?? 0,
      mode: "github",
    };
  } catch (cause) {
    // Fresh site: no `draft` branch yet → compare 404s on the head.
    // Saving the first item is what creates the branch; until then
    // there's nothing to publish.
    if (cause instanceof RequestError && cause.status === 404) {
      return { count: 0, mode: "github" };
    }
    throw new DraftChangesError(
      "github-failed",
      `compare ${env.branch}...${DRAFT_BRANCH}: ${String(cause)}`,
    );
  }
}
