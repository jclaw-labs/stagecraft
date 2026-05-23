import { prisma } from "@stagecraft/db";

/**
 * Vercel integration — mirrors `netlify.ts`'s surface for the parts the
 * platform needs (createProject, setEnvVars, deleteProject) so the rest of
 * the platform can branch on `Site.deployTarget` without per-target
 * conditionals deep in business logic.
 *
 * Auth uses a Personal Access Token from https://vercel.com/account/tokens
 * pasted by the artist at /settings → Connect Vercel. Stored in
 * `IntegrationAccount{provider:"vercel"}.accessToken`.
 *
 * Vercel's API auto-resolves the user's GitHub App installation for repo
 * linking — no `installation_id` plumbing required (which is the failure
 * mode that pushed us toward this integration on the Netlify side).
 */

const VERCEL_API = "https://api.vercel.com";

const VERCEL_GITHUB_APP_INSTALL_URL =
  "https://github.com/apps/vercel/installations/new";

export class VercelGitHubAppNotInstalledError extends Error {
  readonly installUrl = VERCEL_GITHUB_APP_INSTALL_URL;
  constructor() {
    super(
      "Vercel requires its GitHub App to be installed before it can link a repository. " +
        "Install it, then try again.",
    );
    this.name = "VercelGitHubAppNotInstalledError";
  }
}

interface VercelTokenInfo {
  /** Vercel user id (`user.id`); used as IntegrationAccount.providerAccountId */
  userId: string;
  /** Display name / email shown in /settings */
  username: string;
}

interface CreateProjectOptions {
  userId: string;
  /** Project name (must be unique within the user's Vercel account; usually `stagecraft-site-${slug}`) */
  name: string;
  /** Optional: scope creation to a specific Vercel team */
  teamId?: string;
  /** GitHub repo to link for auto-deploy. */
  repo: {
    /** "owner/name" */
    repo: string;
  };
  /** Framework preset hint. Defaults to `nextjs` for the musician-site template. */
  framework?: string;
}

interface VercelProjectResult {
  /** Vercel's internal project id (e.g. `prj_…`) */
  projectId: string;
  /** Project name (what shows in URLs and the dashboard) */
  projectName: string;
  /** Team id the project lives under (`team_…`); never null on Northstar accounts */
  teamId: string | null;
  /**
   * URL slug of the team that owns the project — needed for dashboard
   * URLs (`https://vercel.com/<slug>/<project>`). Differs from teamId
   * (which is the opaque `team_xxx` id and isn't valid in URL paths).
   */
  teamSlug: string | null;
  /** Production URL (e.g. `https://my-project.vercel.app`) */
  productionUrl: string;
  /** URL to the Vercel dashboard for this project */
  adminUrl: string;
}

async function getVercelToken(userId: string): Promise<string> {
  const integration = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: "vercel" } },
  });

  if (!integration?.accessToken) {
    throw new Error("Vercel account not connected");
  }

  return integration.accessToken;
}

async function vercelApi(
  token: string,
  path: string,
  options?: RequestInit & { teamId?: string },
): Promise<unknown> {
  const url = new URL(`${VERCEL_API}${path}`);
  if (options?.teamId) {
    url.searchParams.set("teamId", options.teamId);
  }

  const res = await fetch(url.toString(), {
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
        "Your Vercel connection has expired — reconnect Vercel at /settings and try again",
      );
    }
    const body = await res.text();
    throw new Error(`Vercel API error (${res.status}): ${body}`);
  }

  // 204 No Content (e.g. from DELETE) has no JSON body.
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Look up a Vercel team's URL slug by id. Cached nowhere — called once
 * per project create. Throws on API errors so the caller can fall back.
 */
async function getTeamSlug(token: string, teamId: string): Promise<string> {
  const data = (await vercelApi(token, `/v2/teams/${encodeURIComponent(teamId)}`)) as {
    slug?: string;
  };
  if (!data.slug) {
    throw new Error(`Vercel team ${teamId} response had no slug`);
  }
  return data.slug;
}

/**
 * Validate a token by calling Vercel's `/v2/user` endpoint. Returns user
 * info on success; throws on invalid / revoked / network failure.
 *
 * Used by the `/api/integrations/vercel/connect` route to confirm the
 * pasted PAT works before storing it.
 */
export async function validateVercelToken(token: string): Promise<VercelTokenInfo> {
  const data = (await vercelApi(token, "/v2/user")) as {
    user?: { id?: string; uid?: string; username?: string; email?: string; name?: string };
  };

  // Vercel's payload shape has been `{ user: { id, username, email, ... } }`
  // historically; some versions return `uid` instead of `id`. Coerce.
  const userId = data.user?.id ?? data.user?.uid;
  if (!userId) {
    throw new Error("Vercel /v2/user did not return a user id");
  }

  return {
    userId,
    username:
      data.user?.username ?? data.user?.email ?? data.user?.name ?? userId,
  };
}

/**
 * Create a Vercel project linked to a GitHub repo.
 *
 * Unlike Netlify, Vercel's API auto-resolves the user's GitHub App
 * installation — no installation_id required in the request body. Vercel
 * matches the repo against the user's connected GitHub account based on
 * the bearer token. Pre-req: the user has connected GitHub on
 * vercel.com (via their UI's "Connect Git" flow), and Vercel's GitHub
 * App is installed on the artist's account/repo.
 */
export async function createProject(
  options: CreateProjectOptions,
): Promise<VercelProjectResult> {
  const token = await getVercelToken(options.userId);

  const url = new URL(`${VERCEL_API}/v9/projects`);
  if (options.teamId) url.searchParams.set("teamId", options.teamId);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: options.name,
      framework: options.framework ?? "nextjs",
      gitRepository: {
        type: "github",
        repo: options.repo.repo,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400) {
      try {
        const parsed = JSON.parse(body) as { error?: { action?: string } };
        if (parsed.error?.action === "Install GitHub App") {
          throw new VercelGitHubAppNotInstalledError();
        }
      } catch (e) {
        if (e instanceof VercelGitHubAppNotInstalledError) throw e;
      }
    }
    throw new Error(`Vercel API error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    id: string;
    name: string;
    accountId?: string;
    targets?: { production?: { alias?: string[] } };
  };

  // Vercel's primary alias is usually `<name>.vercel.app` for personal
  // projects; teams use a slightly different domain shape. Fall back to
  // constructing it if the response doesn't include one yet (fresh
  // projects sometimes lack `targets.production` until first deploy).
  const aliasFromResponse = data.targets?.production?.alias?.[0];
  const productionUrl = aliasFromResponse
    ? `https://${aliasFromResponse}`
    : `https://${data.name}.vercel.app`;

  // Resolve the team URL slug. Vercel's dashboard URL is
  // `https://vercel.com/<team-slug>/<project>`; the team_xxx id from
  // accountId isn't a valid path segment. Northstar accounts always
  // return an accountId; older personal accounts may not (in which case
  // the URL is just `vercel.com/<project>`).
  const teamId = options.teamId ?? data.accountId ?? null;
  const teamSlug = teamId ? await getTeamSlug(token, teamId).catch(() => null) : null;
  const adminUrl = teamSlug
    ? `https://vercel.com/${teamSlug}/${data.name}`
    : `https://vercel.com/${data.name}`;

  return {
    projectId: data.id,
    projectName: data.name,
    teamId,
    teamSlug,
    productionUrl,
    adminUrl,
  };
}

interface SetEnvVarsOptions {
  userId: string;
  projectId: string;
  teamId?: string;
  vars: Record<string, string>;
  /** Which environments the var applies to. Defaults to all three. */
  target?: Array<"production" | "preview" | "development">;
}

/**
 * Set (or upsert) plain-text env vars on a Vercel project. Mirrors the
 * shape of Netlify's `setEnvVars` so callers can branch by deployTarget.
 *
 * Vercel's API expects one POST per var (or a batch via array). Sends as
 * a batch for fewer round-trips.
 */
export async function setEnvVars(options: SetEnvVarsOptions): Promise<void> {
  const token = await getVercelToken(options.userId);

  const target = options.target ?? ["production", "preview", "development"];

  const body = Object.entries(options.vars).map(([key, value]) => ({
    key,
    value,
    type: "encrypted",
    target,
  }));

  // `upsert=true` makes this idempotent: re-running with the same key
  // updates the existing var instead of erroring on conflict.
  await vercelApi(
    token,
    `/v10/projects/${encodeURIComponent(options.projectId)}/env?upsert=true`,
    {
      method: "POST",
      body: JSON.stringify(body),
      teamId: options.teamId,
    },
  );
}

export interface LatestDeployment {
  /** Vercel deployment id (e.g. `dpl_…`); null if no deploys yet */
  id: string | null;
  /** Normalized state — see DeployState in deploy-status-broker-types.ts */
  state: "queued" | "initializing" | "building" | "finalizing" | "ready" | "error" | "unknown";
  /** Public URL of the deploy (e.g. `<project>-<hash>.vercel.app`); null when not yet published */
  url: string | null;
  /** ISO 8601 of when this deployment was created */
  createdAt: string | null;
}

/**
 * Get the most recent deployment on a Vercel project. Used by the
 * platform's site-detail page to show "Building…" / "Ready" state after
 * `/create` — `createProject` + `triggerDeployment` return immediately
 * but the first build runs for 1–3 minutes.
 */
export async function getLatestDeployment(
  userId: string,
  projectId: string,
  teamId?: string,
): Promise<LatestDeployment> {
  const token = await getVercelToken(userId);
  const data = (await vercelApi(
    token,
    `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1`,
    { teamId },
  )) as { deployments?: Array<{ uid: string; readyState?: string; state?: string; url?: string; created?: number }> };
  const deps = data.deployments ?? [];
  if (deps.length === 0) {
    return { id: null, state: "queued", url: null, createdAt: null };
  }
  const d = deps[0];
  // Vercel readyState as exposed via /v6/deployments:
  //   QUEUED | INITIALIZING | BUILDING | READY | ERROR | CANCELED.
  // Their internal pipeline also has UPLOADING and DEPLOYING phases
  // (which their dashboard surfaces as "Build Completed" → "Deploying
  // outputs…") but those are NOT exposed via this REST endpoint — only
  // via the streamed-log events endpoint, where they're embedded in
  // stdout/stderr text and brittle to parse. So we get a 4-stage
  // signal and never see a real "finalizing" transition from Vercel.
  const raw = (d.readyState ?? d.state ?? "").toUpperCase();
  const baseState: LatestDeployment["state"] =
    raw === "READY"
      ? "ready"
      : raw === "ERROR" || raw === "CANCELED"
      ? "error"
      : raw === "QUEUED"
      ? "queued"
      : raw === "INITIALIZING"
      ? "initializing"
      : raw === "BUILDING"
      ? "building"
      : raw === "UPLOADING" || raw === "DEPLOYING"
      ? "finalizing"
      : "unknown";

  // Time-based "finalizing" heuristic: once a Vercel deployment has
  // been in BUILDING for longer than typical build time, infer that
  // we're past the `next build` step and into upload + alias-swap.
  // This is a white lie about provider state — but it matches what
  // actually happens behind the scenes, and without it Vercel users
  // would see "Building…" for the entire deploy, then snap straight
  // to "Live!" with no intermediate signal. Calibrate via the median
  // observed build time, with some headroom so we don't fire the
  // transition prematurely on fast builds.
  const VERCEL_FINALIZING_AFTER_MS = 35_000;
  let state = baseState;
  if (state === "building" && typeof d.created === "number") {
    const elapsedMs = Date.now() - d.created;
    if (elapsedMs > VERCEL_FINALIZING_AFTER_MS) {
      state = "finalizing";
    }
  }

  return {
    id: d.uid,
    state,
    url: d.url ? `https://${d.url}` : null,
    createdAt: d.created ? new Date(d.created).toISOString() : null,
  };
}

/**
 * Trigger a fresh production deployment on a Vercel project. Used after
 * writing env vars post-deploy so the next deployment picks them up —
 * Vercel does not automatically redeploy when only env-vars change.
 *
 * Implemented as a deploy-hook-style call against `/v13/deployments` with
 * `gitSource.ref` pointing at the project's production branch (resolved
 * via the project metadata). Returns the deployment id so callers can
 * surface a "redeploying…" link.
 */
export async function triggerDeployment(
  userId: string,
  projectId: string,
  teamId?: string,
): Promise<{ deploymentId: string }> {
  const token = await getVercelToken(userId);

  // Look up the project to get its name + linked git repo. `/v13/deployments`
  // requires either gitSource (preferred — triggers a fresh build from the
  // production branch) or files (we don't have those locally).
  const project = (await vercelApi(
    token,
    `/v9/projects/${encodeURIComponent(projectId)}`,
    { teamId },
  )) as {
    name: string;
    link?: {
      type?: string;
      org?: string;
      repo?: string;
      repoId?: number;
      productionBranch?: string;
    };
  };

  if (!project.link?.repoId) {
    throw new Error("Vercel project has no linked git repo; cannot trigger redeploy");
  }

  const ref = project.link.productionBranch ?? "main";

  const data = (await vercelApi(token, "/v13/deployments", {
    method: "POST",
    body: JSON.stringify({
      name: project.name,
      target: "production",
      gitSource: {
        type: "github",
        repoId: project.link.repoId,
        ref,
      },
    }),
    teamId,
  })) as { id: string };

  return { deploymentId: data.id };
}

/**
 * Delete a Vercel project. Idempotent — Vercel returns 404 if the project
 * is already gone, which we swallow to match Netlify's deleteSite shape.
 */
export async function deleteProject(
  userId: string,
  projectId: string,
  teamId?: string,
): Promise<void> {
  const token = await getVercelToken(userId);

  const url = new URL(
    `${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}`,
  );
  if (teamId) url.searchParams.set("teamId", teamId);

  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  // 404 = already deleted; treat as success
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Vercel API error (${res.status}): ${body}`);
  }
}
