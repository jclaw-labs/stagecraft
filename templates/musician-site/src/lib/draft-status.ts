/**
 * Pre-action signal for "is there anything pending on draft?"
 *
 * ADR-010 exposes Publish + Discard as actions an artist takes
 * explicitly. The buttons in `AdminShell` always render — but until
 * the artist actually clicks, they have no visual signal of whether
 * there's anything in the queue. The "Discard X unpublished changes?"
 * confirm copy and the auto-generated publish message both presume a
 * known diff between `draft` and `main`; this is the cheapest summary
 * of that diff.
 *
 * Implementation: two `getRef` calls + a string comparison. We
 * deliberately don't pull the file list (the GitHub compare API
 * gives it but at extra cost) — v1 only needs the boolean. Counts
 * and per-item summaries are deferred to the Publish modal's diff
 * preview (ADR-010 "Publish UX" deferred work).
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
 * Cross-container draft state.
 *
 * - `mode: "local"` — dev / unconfigured. There's no draft branch to
 *   diff against. `hasPending` is always false in this mode; local
 *   writes are immediate and there's nothing to publish.
 * - `mode: "github"` — production. `hasPending` reflects the
 *   draft-vs-main SHA comparison. A fresh site with no `draft` branch
 *   yet also resolves to `hasPending: false`.
 */
export type DraftStatus = {
  hasPending: boolean;
  mode: "local" | "github";
};

/**
 * Errors `getDraftStatus` can throw. Mirrors the shape of
 * `PublishError` / `DeployStatusError` so admin code can pattern-match
 * the same way.
 *
 * - `broker-unreachable`: network blip or platform outage at token-
 *   mint time. Recoverable next request.
 * - `broker-rejected`: per-site secret bad / siteId unknown.
 *   Permanent config error; surface it.
 * - `github-failed`: a non-404 error talking to GitHub. Bug or
 *   transient outage.
 */
export class DraftStatusError extends Error {
  constructor(
    public code: "broker-unreachable" | "broker-rejected" | "github-failed",
    message: string,
  ) {
    super(message);
    this.name = "DraftStatusError";
  }
}

export async function getDraftStatus(env: Env = readEnv()): Promise<DraftStatus> {
  if (!isPlatformConfigured(env)) {
    return { hasPending: false, mode: "local" };
  }

  let token: string;
  let owner: string;
  let repo: string;
  try {
    ({ token, owner, repo } = await fetchPublishToken(env));
  } catch (cause) {
    if (cause instanceof PublishError) {
      if (cause.code === "broker-unreachable" || cause.code === "broker-rejected") {
        throw new DraftStatusError(cause.code, cause.message);
      }
    }
    throw new DraftStatusError("github-failed", String(cause));
  }

  const octokit = new Octokit({ auth: token });

  let draftSha: string;
  try {
    const draftRef = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${DRAFT_BRANCH}`,
    });
    draftSha = draftRef.data.object.sha;
  } catch (cause) {
    // Fresh site: no `draft` branch yet. Nothing pending, by
    // definition — saving the first item is what creates the
    // branch.
    if (cause instanceof RequestError && cause.status === 404) {
      return { hasPending: false, mode: "github" };
    }
    throw new DraftStatusError("github-failed", `getRef draft: ${String(cause)}`);
  }

  let mainSha: string;
  try {
    const mainRef = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${env.branch}`,
    });
    mainSha = mainRef.data.object.sha;
  } catch (cause) {
    throw new DraftStatusError("github-failed", `getRef main: ${String(cause)}`);
  }

  return {
    hasPending: draftSha !== mainSha,
    mode: "github",
  };
}
