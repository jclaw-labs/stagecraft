import { prisma } from "@stagecraft/db";

interface CreateSiteOptions {
  userId: string;
  name: string;
  repo?: {
    provider: "github";
    repo_path: string;
    repo_branch: string;
    cmd: string;
    dir: string;
    /**
     * Numeric id of Netlify's GitHub App installation on the repo's owner
     * account. When present, Netlify clones via App-based HTTPS+token
     * (the same path the dashboard's "Link to a different repository"
     * UI uses). When absent, Netlify falls back to deploy-key (SSH) mode,
     * which requires Netlify to register an SSH key on the repo and
     * frequently fails with "Host key verification failed" on first deploy.
     *
     * Discoverable via `findGithubAppInstallation(userId, "netlify",
     * repoOwner)` from `integrations/github.ts`.
     */
    installation_id?: number;
  };
}

interface NetlifySiteResult {
  siteId: string;
  siteName: string;
  url: string;
  adminUrl: string;
  sslUrl: string;
}

async function getNetlifyToken(userId: string): Promise<string> {
  const integration = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: "netlify" } },
  });

  if (!integration?.accessToken) {
    throw new Error("Netlify account not connected");
  }

  return integration.accessToken;
}

async function netlifyApi(token: string, path: string, options?: RequestInit) {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Your Netlify connection has expired — reconnect Netlify at /settings and try again",
      );
    }
    const body = await res.text();
    throw new Error(`Netlify API error (${res.status}): ${body}`);
  }

  return res.json();
}

/**
 * Create a Netlify site, optionally linked to a GitHub repo.
 *
 * When `repo` is provided the site is created with repo auto-deploy enabled.
 * If linking fails (e.g. Netlify's GitHub App isn't installed), callers should
 * catch the error and retry without the `repo` field, then surface a manual
 * linking URL from the Netlify dashboard.
 */
export async function createSite(options: CreateSiteOptions): Promise<NetlifySiteResult> {
  const token = await getNetlifyToken(options.userId);

  const body = options.repo
    ? { name: options.name, repo: options.repo }
    : {
        name: options.name,
        build_settings: { cmd: "npm run build", dir: "dist" },
      };

  const data = await netlifyApi(token, "/sites", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    siteId: data.id,
    siteName: data.name,
    url: data.url,
    adminUrl: data.admin_url,
    sslUrl: data.ssl_url,
  };
}

/**
 * Set environment variables on a Netlify site.
 */
export async function setEnvVars(
  userId: string,
  siteId: string,
  vars: Record<string, string>
): Promise<void> {
  const token = await getNetlifyToken(userId);

  const envArray = Object.entries(vars).map(([key, value]) => ({
    key,
    values: [{ value, context: "all" }],
  }));

  await netlifyApi(token, `/accounts/me/env?site_id=${siteId}`, {
    method: "POST",
    body: JSON.stringify(envArray),
  });
}

/**
 * Look up the deploy preview for a specific PR number on a Netlify site.
 * Netlify creates these automatically when the site has repo auto-deploys configured.
 */
export async function getDeployPreviewForPR(
  userId: string,
  netlifySiteId: string,
  prNumber: number
): Promise<{ previewUrl: string | null; state: string }> {
  const token = await getNetlifyToken(userId);

  const deploys = await netlifyApi(
    token,
    `/sites/${netlifySiteId}/deploys?per_page=20`
  ) as Array<{ review_id: number | null; deploy_url: string | null; state: string }>;

  const deploy = deploys.find((d) => d.review_id === prNumber);

  if (!deploy) {
    return { previewUrl: null, state: "building" };
  }

  return {
    previewUrl: deploy.deploy_url ?? null,
    state: deploy.state ?? "building",
  };
}

export interface LatestDeploy {
  /** Netlify deploy id (e.g. `69f8...`); null if no deploys yet */
  id: string | null;
  /** Normalized state — see DeployState in deploy-status-broker-types.ts */
  state: "queued" | "initializing" | "building" | "finalizing" | "ready" | "error" | "unknown";
  /** Public URL of the deploy (e.g. preview/permalink); null when not yet published */
  url: string | null;
  /** Build error message, when state === "error" */
  errorMessage: string | null;
  /** ISO 8601 of when this deploy was created */
  createdAt: string | null;
}

/**
 * Get the most recent deploy on a Netlify site. Used by the platform's
 * site-detail page to show "Building…" / "Ready" state after `/create`,
 * since createSite returns immediately but the first build runs for
 * 1–3 minutes.
 */
export async function getLatestDeploy(
  userId: string,
  netlifySiteId: string,
): Promise<LatestDeploy> {
  const token = await getNetlifyToken(userId);
  const deploys = (await netlifyApi(
    token,
    `/sites/${netlifySiteId}/deploys?per_page=1`,
  )) as Array<{
    id: string;
    state: string;
    deploy_ssl_url: string | null;
    deploy_url: string | null;
    error_message: string | null;
    created_at: string;
  }>;
  if (deploys.length === 0) {
    return { id: null, state: "queued", url: null, errorMessage: null, createdAt: null };
  }
  const d = deploys[0];
  // Netlify states: new, pending_review, accepted, enqueued, building,
  // uploading, uploaded, preparing, prepared, processing, processed, ready,
  // error, retrying. Map to the shared DeployState enum so the UI can
  // drive a single progress bar across both providers.
  //
  // Buckets:
  //   queued       — `new`, `pending_review`, `accepted`, `enqueued`
  //   initializing — (Netlify doesn't expose a distinct init phase;
  //                   collapse with building below)
  //   building     — `building`, `retrying`
  //   finalizing   — `uploading`, `uploaded`, `preparing`, `prepared`,
  //                  `processing`, `processed`
  //   ready        — `ready`
  //   error        — `error`
  const state: LatestDeploy["state"] =
    d.state === "ready"
      ? "ready"
      : d.state === "error"
      ? "error"
      : d.state === "new" || d.state === "enqueued" || d.state === "pending_review" || d.state === "accepted"
      ? "queued"
      : d.state === "building" || d.state === "retrying"
      ? "building"
      : d.state === "uploading" || d.state === "uploaded" || d.state === "preparing" || d.state === "prepared" || d.state === "processing" || d.state === "processed"
      ? "finalizing"
      : "unknown";
  return {
    id: d.id,
    state,
    url: d.deploy_ssl_url ?? d.deploy_url,
    errorMessage: d.error_message,
    createdAt: d.created_at,
  };
}

/**
 * Trigger a fresh build on a Netlify site. Used after writing env vars
 * post-deploy so the next build picks them up — Netlify does not
 * automatically rebuild when only env-vars change.
 *
 * Returns the build id so callers can surface a "rebuilding…" link.
 */
export async function triggerBuild(
  userId: string,
  netlifySiteId: string,
): Promise<{ buildId: string }> {
  const token = await getNetlifyToken(userId);
  const data = (await netlifyApi(token, `/sites/${netlifySiteId}/builds`, {
    method: "POST",
  })) as { id: string };
  return { buildId: data.id };
}

/**
 * Delete a Netlify site.
 */
export async function deleteSite(userId: string, siteId: string): Promise<void> {
  const token = await getNetlifyToken(userId);

  await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
