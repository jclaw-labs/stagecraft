import { prisma } from "@stagecraft/db";

interface CreateRepoOptions {
  userId: string;
  name: string;
  description?: string;
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
}

interface PushFileEntry {
  path: string;
  content: string;
  /** Encoding for the GitHub blob API. Defaults to "utf-8". Use "base64" for binary files. */
  encoding?: "utf-8" | "base64";
}

async function getGitHubToken(userId: string): Promise<string> {
  const integration = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: "github" } },
  });

  if (!integration?.accessToken) {
    throw new Error("GitHub account not connected");
  }

  return integration.accessToken;
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
    throw new Error(`GitHub API error (${res.status}): ${body}`);
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
      private: options.isPrivate ?? false,
      auto_init: true,
    }),
  });

  return {
    id: data.id,
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    htmlUrl: data.html_url,
    cloneUrl: data.clone_url,
    defaultBranch: data.default_branch,
  };
}

/**
 * Push a set of files to a repo using the Git Data API.
 * Fetches the current HEAD (from auto_init) and uses it as the parent commit.
 */
export async function pushFiles(
  userId: string,
  owner: string,
  repo: string,
  branch: string,
  files: PushFileEntry[],
  message: string
): Promise<{ commitSha: string }> {
  const token = await getGitHubToken(userId);

  // Get current HEAD commit SHA — retry because GitHub may still be
  // processing the auto_init commit right after repo creation.
  let parentSha: string;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const ref = await githubApi(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
      parentSha = ref.object.sha;
      break;
    } catch {
      if (attempt === 4) throw new Error(`Timed out waiting for initial commit on ${branch}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Create blobs for each file
  const blobs = await Promise.all(
    files.map(async (file) => {
      const blob = await githubApi(token, `/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({
          content: file.content,
          encoding: file.encoding ?? "utf-8",
        }),
      });
      return { path: file.path, sha: blob.sha, mode: "100644" as const, type: "blob" as const };
    })
  );

  // Create tree
  const tree = await githubApi(token, `/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: blobs }),
  });

  // Create commit with parent
  const commit = await githubApi(token, `/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [parentSha!],
    }),
  });

  // Update branch ref
  await githubApi(token, `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return { commitSha: commit.sha };
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

export async function deleteRepo(userId: string, owner: string, repo: string): Promise<void> {
  const token = await getGitHubToken(userId);

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  // 404 is fine — repo may already be deleted
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Failed to delete GitHub repo (${res.status}): ${body}`);
  }
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
