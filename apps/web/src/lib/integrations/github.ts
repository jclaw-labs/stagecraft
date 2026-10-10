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

async function githubApi(token: string, path: string, options?: RequestInit) {
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

  return res.json();
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
  | { path: string; mode: "100644"; type: "blob"; sha: string };

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

/**
 * Grant a GitHub App installation (e.g. Netlify) access to a specific repo.
 * Finds the installation by app slug, then adds the repo to it.
 */
export async function grantAppAccess(
  userId: string,
  repoId: number,
  appSlug: string
): Promise<void> {
  const token = await getGitHubToken(userId);

  // List all GitHub App installations on the user's account
  const data = await githubApi(token, "/user/installations");
  const installation = data.installations?.find(
    (inst: { app_slug: string }) => inst.app_slug === appSlug
  );

  if (!installation) {
    throw new Error(`GitHub App "${appSlug}" is not installed. Install it from the app's GitHub page.`);
  }

  // Add the repo to the installation's accessible repos
  await githubApi(token, `/user/installations/${installation.id}/repositories/${repoId}`, {
    method: "PUT",
  });
}

export async function setRepoArchived(
  userId: string,
  owner: string,
  repo: string,
  archived: boolean
): Promise<void> {
  const token = await getGitHubToken(userId);

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

export async function getFileContent(
  userId: string,
  owner: string,
  repo: string,
  filePath: string,
  branch: string
): Promise<string> {
  const token = await getGitHubToken(userId);

  const data = await githubApi(
    token,
    `/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`
  );

  if (!data.content) {
    throw new Error(`No content returned for ${filePath}`);
  }

  return Buffer.from((data.content as string).replace(/\n/g, ""), "base64").toString("utf-8");
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

export async function mergePullRequest(
  userId: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  const token = await getGitHubToken(userId);

  await githubApi(token, `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: "squash" }),
  });
}

export async function closePullRequest(
  userId: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<void> {
  const token = await getGitHubToken(userId);

  await githubApi(token, `/repos/${owner}/${repo}/pulls/${prNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
  });
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
