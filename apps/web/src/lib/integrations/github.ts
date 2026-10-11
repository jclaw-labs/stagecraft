import { prisma } from "@stagecraft/db";
import { mapWithConcurrency } from "@stagecraft/shared";
import { decryptCredential, integrationCredentialField } from "../credential-crypto";

interface CreateRepoOptions {
  userId: string;
  name: string;
  description?: string;
  /** Defaults to true: artist repos are private (issue #398). */
  isPrivate?: boolean;
}

interface CreateRepoResult {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  /** When GitHub created the repo (ISO 8601). */
  createdAt?: string;
}

interface PushFileEntry {
  path: string;
  content: string;
  /**
   * "utf-8" (the default) for text, sent inline in the tree request.
   * "base64" for binary files, each uploaded as its own blob first.
   */
  encoding?: "utf-8" | "base64";
}

/** A GitHub REST call that answered non-2xx. `status` is the HTTP status. */
export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`GitHub API error (${status}): ${body}`);
    this.name = "GitHubApiError";
  }
}

/** How many binary blobs `pushFiles` uploads at once. */
export const BLOB_UPLOAD_CONCURRENCY = 4;

/**
 * Upper bound on the inline text content in one `POST /git/trees` request.
 * A push bigger than this is split into chained tree requests, each building
 * on the last, so no single request body grows without limit. The
 * musician-site template (~2.6 MB of text) takes two.
 */
export const MAX_TREE_CONTENT_BYTES = 2 * 1024 * 1024;

/** Attempts (2s apart) to read the branch head right after repo creation. */
const BRANCH_HEAD_ATTEMPTS = 5;

async function getGitHubToken(userId: string): Promise<string> {
  const integration = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: "github" } },
  });

  if (!integration?.accessToken) {
    throw new Error("GitHub account not connected");
  }

  return decryptCredential(
    integration.accessToken,
    integrationCredentialField(userId, "github", "accessToken"),
  );
}

async function githubFetch(token: string, path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new GitHubApiError(res.status, body);
  }

  return res;
}

async function githubApi(token: string, path: string, options?: RequestInit) {
  return (await githubFetch(token, path, options)).json();
}

export async function getAuthenticatedUser(token: string): Promise<{ login: string; id: number }> {
  return githubApi(token, "/user");
}

export async function createRepo(options: CreateRepoOptions): Promise<CreateRepoResult> {
  const token = await getGitHubToken(options.userId);

  const data = await githubApi(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name: options.name,
      description: options.description ?? "",
      private: options.isPrivate ?? true,
      auto_init: true,
    }),
  });

  return toRepoResult(data);
}

function toRepoResult(data: {
  id: number;
  owner: { login: string };
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
  created_at?: string;
}): CreateRepoResult {
  return {
    id: data.id,
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    htmlUrl: data.html_url,
    cloneUrl: data.clone_url,
    defaultBranch: data.default_branch,
    ...(data.created_at ? { createdAt: data.created_at } : {}),
  };
}

/**
 * Look up a repo by name on the authenticated user's own account. Returns
 * null when it doesn't exist. Used to adopt a repo that an earlier,
 * interrupted run of the same job created.
 */
export async function getOwnRepo(userId: string, name: string): Promise<CreateRepoResult | null> {
  const token = await getGitHubToken(userId);
  const user = await getAuthenticatedUser(token);
  try {
    const data = await githubApi(
      token,
      `/repos/${encodeURIComponent(user.login)}/${encodeURIComponent(name)}`,
    );
    return toRepoResult(data);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

type TreeEntry =
  | { path: string; mode: "100644"; type: "blob"; content: string }
  // A null sha deletes the path from the base tree.
  | { path: string; mode: "100644"; type: "blob"; sha: string | null };

/** Split tree entries so no group's inline content exceeds `maxBytes`. */
function chunkTreeEntries(entries: TreeEntry[], maxBytes: number): TreeEntry[][] {
  const chunks: TreeEntry[][] = [];
  let current: TreeEntry[] = [];
  let size = 0;
  for (const entry of entries) {
    const bytes = "content" in entry ? Buffer.byteLength(entry.content, "utf8") : 0;
    if (current.length > 0 && size + bytes > maxBytes) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Commit a set of files on top of a branch with the Git Data API.
 *
 * The call count doesn't grow with the number of text files: text goes
 * inline in `POST /git/trees` (one request per MAX_TREE_CONTENT_BYTES of
 * content), and only binary files get their own blob, uploaded
 * BLOB_UPLOAD_CONCURRENCY at a time. A small text-only push is five calls:
 * read the ref, read its commit, create the tree, create the commit, move
 * the ref.
 *
 * The tree builds on the branch's current tree, so files not in `files`
 * are kept. When the resulting tree is identical to the current one (a
 * retried push whose first attempt landed), no commit is made and
 * `changed` is false.
 */
export async function pushFiles(
  userId: string,
  owner: string,
  repo: string,
  branch: string,
  files: PushFileEntry[],
  message: string
): Promise<{ commitSha: string; changed: boolean }> {
  const token = await getGitHubToken(userId);
  const repoPath = `/repos/${owner}/${repo}`;

  // Get current HEAD commit SHA — retry because GitHub may still be
  // processing the auto_init commit right after repo creation.
  let parentSha: string | undefined;
  for (let attempt = 1; parentSha === undefined; attempt++) {
    try {
      const ref = await githubApi(token, `${repoPath}/git/ref/heads/${branch}`);
      parentSha = ref.object.sha as string;
    } catch {
      if (attempt >= BRANCH_HEAD_ATTEMPTS) throw new Error(`Timed out waiting for initial commit on ${branch}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const parent = await githubApi(token, `${repoPath}/git/commits/${parentSha}`);
  const parentTreeSha = parent.tree.sha as string;

  // Binary content can't go inline (the tree API takes `content` as UTF-8
  // text), so those files are uploaded as blobs first, a few at a time.
  const binaryShas = new Map<string, string>();
  const binaryFiles = files.filter((f) => f.encoding === "base64");
  await mapWithConcurrency(binaryFiles, BLOB_UPLOAD_CONCURRENCY, async (file) => {
    const blob = await githubApi(token, `${repoPath}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: file.content, encoding: "base64" }),
    });
    binaryShas.set(file.path, blob.sha as string);
  });

  const entries: TreeEntry[] = files.map((file) =>
    file.encoding === "base64"
      ? { path: file.path, mode: "100644", type: "blob", sha: binaryShas.get(file.path)! }
      : { path: file.path, mode: "100644", type: "blob", content: file.content },
  );

  let treeSha = parentTreeSha;
  for (const chunk of chunkTreeEntries(entries, MAX_TREE_CONTENT_BYTES)) {
    const tree = await githubApi(token, `${repoPath}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: treeSha, tree: chunk }),
    });
    treeSha = tree.sha as string;
  }

  if (treeSha === parentTreeSha) {
    return { commitSha: parentSha, changed: false };
  }

  const commit = await githubApi(token, `${repoPath}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: treeSha,
      parents: [parentSha],
    }),
  });

  await githubApi(token, `${repoPath}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return { commitSha: commit.sha as string, changed: true };
}

export async function setRepoArchived(
  userId: string,
  owner: string,
  repo: string,
  archived: boolean
): Promise<void> {
  const token = await getGitHubToken(userId);

  // A repo already in the wanted state is left alone: GitHub treats an
  // archived repo as read-only, so archiving one again (deleting a site
  // that was archived first) could be rejected and reported as a failure
  // for a repo that is exactly as wanted.
  const current = await githubApi(token, `/repos/${owner}/${repo}`);
  if (current.archived === archived) return;

  await githubApi(token, `/repos/${owner}/${repo}`, {
    method: "PATCH",
    body: JSON.stringify({ archived }),
  });
}

export async function createBranch(
  userId: string,
  owner: string,
  repo: string,
  baseBranch: string,
  newBranch: string
): Promise<void> {
  const token = await getGitHubToken(userId);

  const ref = await githubApi(token, `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`);
  const sha = ref.object.sha as string;

  await githubApi(token, `/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha }),
  });
}

interface CreatePullRequestOptions {
  title: string;
  body: string;
  head: string;
  base: string;
}

export interface PullRequestResult {
  number: number;
  htmlUrl: string;
  state: string;
}

export async function createPullRequest(
  userId: string,
  owner: string,
  repo: string,
  options: CreatePullRequestOptions
): Promise<PullRequestResult> {
  const token = await getGitHubToken(userId);

  const data = await githubApi(token, `/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base,
    }),
  });

  return {
    number: data.number as number,
    htmlUrl: data.html_url as string,
    state: data.state as string,
  };
}

interface GithubInstallation {
  id: number;
  app_slug: string;
  account: { login: string };
}

/**
 * Find the numeric installation id for a given GitHub App on a given owner
 * (user or org). Used to thread `installation_id` through to deploy
 * providers like Netlify whose API needs it for App-based repo cloning.
 *
 * GitHub's `/user/installations` endpoint returns every App installed on
 * the authenticated user's accounts (personal + orgs they belong to).
 * Match by `app_slug` (e.g. "netlify") AND `account.login` (the owner of
 * the repo we're connecting), so artists with the same App installed on
 * multiple accounts get the right installation.
 *
 * Returns null when no matching installation exists OR when GitHub denies
 * the request (e.g. 403 because Stagecraft signs users in via a regular
 * OAuth App, not a GitHub App — and `/user/installations` only accepts
 * GitHub App user-to-server tokens). Either way the caller treats it as
 * "no installation found" and falls back to its manual-link path; the
 * site is created without the auto-link, and the artist clicks "Link to
 * a different repository" in Netlify's UI to finish hookup.
 */
export async function findGithubAppInstallation(
  userId: string,
  appSlug: string,
  ownerLogin: string,
): Promise<number | null> {
  const token = await getGitHubToken(userId);

  let data: { installations: GithubInstallation[] } | null = null;
  try {
    data = (await githubApi(token, "/user/installations?per_page=100")) as {
      installations: GithubInstallation[];
    };
  } catch (cause) {
    // Don't kill the create_site job over a discovery API failure —
    // log + continue. The most common case here is the 403 above; other
    // errors (rate limits, network blips) also fall through to the env
    // fallback below.
    console.warn("[findGithubAppInstallation] discovery failed; trying env fallback", {
      appSlug,
      ownerLogin,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const match = data?.installations.find(
    (i) => i.app_slug === appSlug && i.account.login === ownerLogin,
  );
  if (match) return match.id;

  // Single-tenant fallback: an operator may pin an installation id via env
  // (e.g. `GITHUB_APP_INSTALLATION_ID_NETLIFY=15980838`). This unblocks
  // App-based cloning while sign-in still uses an OAuth App and
  // `/user/installations` returns 403. Per-tenant resolution requires
  // migrating sign-in to a GitHub App.
  const envKey = `GITHUB_APP_INSTALLATION_ID_${appSlug.toUpperCase().replace(/-/g, "_")}`;
  const envValue = process.env[envKey];
  if (envValue) {
    const parsed = Number(envValue);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    console.warn(`[findGithubAppInstallation] ${envKey} is set but not a positive integer: ${envValue}`);
  }

  return null;
}

/** Whether a user's stored GitHub token can do what a job needs. */
export type GitHubTokenCheck =
  | { status: "ok"; scopes: string[] }
  /** No GitHub account connected, or no token stored. */
  | { status: "missing" }
  /** GitHub rejects the token (revoked, expired). */
  | { status: "stale" }
  /** The token works but was granted without these scopes. */
  | { status: "missing_scopes"; missingScopes: string[] };

/**
 * Check the user's stored GitHub OAuth token against GitHub and the scopes
 * it was granted (the `X-OAuth-Scopes` header). A token issued before the
 * platform asked for a scope keeps working without it, so a job that needs
 * one (pushing under `.github/workflows/` needs `workflow`) checks first and
 * asks the user to sign in again instead of failing part way.
 *
 * A response without the header (not an OAuth App token) is taken as
 * having every scope: GitHub reports a missing permission on the call
 * that needs it.
 */
export async function checkGitHubToken(userId: string, requiredScopes: readonly string[]): Promise<GitHubTokenCheck> {
  let token: string;
  try {
    token = await getGitHubToken(userId);
  } catch {
    return { status: "missing" };
  }
  let res: Response;
  try {
    res = await githubFetch(token, "/user");
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 401) return { status: "stale" };
    throw error;
  }
  const header = res.headers.get("x-oauth-scopes");
  if (header === null) return { status: "ok", scopes: [...requiredScopes] };
  const scopes = header
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));
  return missingScopes.length > 0 ? { status: "missing_scopes", missingScopes } : { status: "ok", scopes };
}

/** One file in a commit's tree: its path and git blob SHA. */
export type RepoTree = Map<string, string>;

/** A file `GitHubRepoClient.createCommit` writes. */
export type CommitFile = PushFileEntry;

export interface PullRequestUpdate {
  title: string;
  body: string;
}

/**
 * Git and pull-request calls on one repo, with the user's token read once.
 * The upgrade_site job (`jobs/upgrade-site.ts`) reads a site's tree and
 * history, then commits to a branch and opens or updates a pull request.
 */
export interface GitHubRepoClient {
  readonly owner: string;
  readonly repo: string;
  /** The commit SHA `branch` points at, or null when there's no such branch. */
  getBranchHead(branch: string): Promise<string | null>;
  /** Every file in a commit's tree, by path. Throws if GitHub truncates the tree. */
  getTree(commitSha: string): Promise<RepoTree>;
  /** A blob's content as UTF-8 text. */
  getBlobText(blobSha: string): Promise<string>;
  /** The oldest commit on `ref` that touches `path`, or null when none does. */
  findOldestCommitTouching(path: string, ref: string): Promise<string | null>;
  /** Whether `commitSha` itself changes anything under `path`. */
  commitTouchesPath(commitSha: string, path: string): Promise<boolean>;
  /** Every branch name in the repo. */
  listBranches(): Promise<string[]>;
  /** The paths `head` changed since it forked from `base`. */
  changedFilesSince(base: string, head: string): Promise<string[]>;
  /**
   * Create a commit on `parentSha` that writes `files` and deletes
   * `deletePaths`, without moving any branch. Returns its SHA.
   */
  createCommit(args: { parentSha: string; files: CommitFile[]; deletePaths: string[]; message: string }): Promise<string>;
  /** Point an existing branch at `sha`, discarding what it held. */
  setBranchHead(branch: string, sha: string): Promise<void>;
  /** The open pull request from `head` (a branch in this repo) into `base`, if any. */
  findOpenPullRequest(head: string, base: string): Promise<PullRequestResult | null>;
  updatePullRequest(number: number, update: PullRequestUpdate): Promise<PullRequestResult>;
}

/** Commits listed per page when reading history. */
const COMMITS_PER_PAGE = 100;

/** The page number of the `rel="last"` link in a `Link` header, if any. */
export function lastPageFromLinkHeader(link: string | null): number | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="last"/.exec(part);
    if (!match) continue;
    const page = Number(new URL(match[1]).searchParams.get("page"));
    return Number.isInteger(page) && page > 0 ? page : null;
  }
  return null;
}

function toPullRequestResult(data: { number: number; html_url: string; state: string }): PullRequestResult {
  return { number: data.number, htmlUrl: data.html_url, state: data.state };
}

/** A `GitHubRepoClient` for `owner/repo`, acting as `userId`. */
export async function githubRepoClient(userId: string, owner: string, repo: string): Promise<GitHubRepoClient> {
  const token = await getGitHubToken(userId);
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function commitsTouching(path: string, ref: string, perPage: number, page = 1) {
    const query = new URLSearchParams({ path, sha: ref, per_page: String(perPage), page: String(page) });
    const res = await githubFetch(token, `${repoPath}/commits?${query}`);
    return { commits: (await res.json()) as Array<{ sha: string }>, link: res.headers.get("link") };
  }

  return {
    owner,
    repo,

    async getBranchHead(branch) {
      try {
        const ref = await githubApi(token, `${repoPath}/git/ref/heads/${branch}`);
        return ref.object.sha as string;
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 404) return null;
        throw error;
      }
    },

    async getTree(commitSha) {
      const commit = await githubApi(token, `${repoPath}/git/commits/${commitSha}`);
      const tree = (await githubApi(token, `${repoPath}/git/trees/${commit.tree.sha}?recursive=1`)) as {
        truncated?: boolean;
        tree: Array<{ path: string; type: string; sha: string }>;
      };
      if (tree.truncated) {
        throw new Error(`${owner}/${repo}'s tree at ${commitSha} is too large for GitHub to list in one call`);
      }
      return new Map(tree.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
    },

    async getBlobText(blobSha) {
      const blob = (await githubApi(token, `${repoPath}/git/blobs/${blobSha}`)) as { content: string; encoding: string };
      return blob.encoding === "base64" ? Buffer.from(blob.content, "base64").toString("utf8") : blob.content;
    },

    async findOldestCommitTouching(path, ref) {
      // Commits come newest first, so the oldest is the last one on the
      // last page. One page of one commit tells us how many pages there are.
      const first = await commitsTouching(path, ref, 1);
      const lastPage = lastPageFromLinkHeader(first.link);
      if (lastPage === null) return first.commits[0]?.sha ?? null;
      const last = await commitsTouching(path, ref, 1, lastPage);
      return last.commits[0]?.sha ?? null;
    },

    async commitTouchesPath(commitSha, path) {
      // The newest commit reachable from `commitSha` that touches `path` is
      // `commitSha` itself exactly when it touches `path`.
      try {
        const { commits } = await commitsTouching(path, commitSha, 1);
        return commits[0]?.sha === commitSha;
      } catch (error) {
        // A recorded commit that isn't in the repo (any more) touches nothing.
        if (error instanceof GitHubApiError && (error.status === 404 || error.status === 422)) return false;
        throw error;
      }
    },

    async listBranches() {
      const names: string[] = [];
      for (let page = 1; ; page++) {
        const batch = (await githubApi(
          token,
          `${repoPath}/branches?per_page=${COMMITS_PER_PAGE}&page=${page}`,
        )) as Array<{ name: string }>;
        names.push(...batch.map((branch) => branch.name));
        if (batch.length < COMMITS_PER_PAGE) return names;
      }
    },

    async changedFilesSince(base, head) {
      const comparison = (await githubApi(
        token,
        `${repoPath}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      )) as { files?: Array<{ filename: string; previous_filename?: string }> };
      return (comparison.files ?? []).flatMap((file) =>
        file.previous_filename ? [file.filename, file.previous_filename] : [file.filename],
      );
    },

    async createCommit({ parentSha, files, deletePaths, message }) {
      const parent = await githubApi(token, `${repoPath}/git/commits/${parentSha}`);
      const binaryShas = new Map<string, string>();
      await mapWithConcurrency(
        files.filter((f) => f.encoding === "base64"),
        BLOB_UPLOAD_CONCURRENCY,
        async (file) => {
          const blob = await githubApi(token, `${repoPath}/git/blobs`, {
            method: "POST",
            body: JSON.stringify({ content: file.content, encoding: "base64" }),
          });
          binaryShas.set(file.path, blob.sha as string);
        },
      );
      const entries: TreeEntry[] = [
        ...files.map((file): TreeEntry =>
          file.encoding === "base64"
            ? { path: file.path, mode: "100644", type: "blob", sha: binaryShas.get(file.path)! }
            : { path: file.path, mode: "100644", type: "blob", content: file.content },
        ),
        ...deletePaths.map((path): TreeEntry => ({ path, mode: "100644", type: "blob", sha: null })),
      ];
      let treeSha = parent.tree.sha as string;
      for (const chunk of chunkTreeEntries(entries, MAX_TREE_CONTENT_BYTES)) {
        const tree = await githubApi(token, `${repoPath}/git/trees`, {
          method: "POST",
          body: JSON.stringify({ base_tree: treeSha, tree: chunk }),
        });
        treeSha = tree.sha as string;
      }
      const commit = await githubApi(token, `${repoPath}/git/commits`, {
        method: "POST",
        body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
      });
      return commit.sha as string;
    },

    async setBranchHead(branch, sha) {
      await githubApi(token, `${repoPath}/git/refs/heads/${branch}`, {
        method: "PATCH",
        body: JSON.stringify({ sha, force: true }),
      });
    },

    async findOpenPullRequest(head, base) {
      const query = new URLSearchParams({ head: `${owner}:${head}`, base, state: "open" });
      const pulls = (await githubApi(token, `${repoPath}/pulls?${query}`)) as Array<{
        number: number;
        html_url: string;
        state: string;
      }>;
      return pulls[0] ? toPullRequestResult(pulls[0]) : null;
    },

    async updatePullRequest(number, update) {
      const data = await githubApi(token, `${repoPath}/pulls/${number}`, {
        method: "PATCH",
        body: JSON.stringify({ title: update.title, body: update.body }),
      });
      return toPullRequestResult(data);
    },
  };
}
