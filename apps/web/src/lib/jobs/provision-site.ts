import { prisma } from "@stagecraft/db";
import type { Prisma } from "@stagecraft/db";
import {
  createStepRunner,
  LeaseLostError,
  MAX_RETRY_ATTEMPTS,
  type JobContext,
  type JobResult,
  type StepRunner,
} from "@stagecraft/queue";
import { connectedProviders, type IntegrationProvider, type SiteSetupAction } from "@stagecraft/shared";

import { generateBrokerSecret, type GeneratedBrokerSecret } from "@/lib/broker-secret";
import {
  createRepo,
  findGithubAppInstallation,
  getOwnRepo,
  GitHubApiError,
  pushFiles,
} from "@/lib/integrations/github";
import { findAppInstallationForOwner } from "@/lib/github-app-token";
import {
  createSite as createNetlifySite,
  findSite as findNetlifySite,
  setEnvVars as setNetlifyEnvVars,
} from "@/lib/integrations/netlify";
import { getResendCredentials } from "@/lib/integrations/resend";
import {
  createProject as createVercelProject,
  findProject as findVercelProject,
  setEnvVars as setVercelEnvVars,
  triggerDeployment as triggerVercelDeployment,
  VercelGitHubAppNotInstalledError,
} from "@/lib/integrations/vercel";
import { readTemplateFiles, type TemplateFile } from "@/lib/template-reader";
import {
  buildSiteScaffoldFiles,
  buildDependabotAutoMergeWorkflow,
  SITE_AUTOMERGE_WORKFLOW_PATH,
  templateVersionFromFiles,
} from "@/lib/site-scaffold";

/**
 * Provisioning shared by the create_site and migrate_site jobs: a GitHub
 * repo holding the musician-site template, a Netlify site or Vercel project
 * deploying it, and the env vars the template needs at runtime. The two jobs
 * differ only in the content they push over the template (`contentOverlay`).
 *
 * Provisioning runs as the named steps in PROVISION_STEPS on a step runner
 * (see `createStepRunner` in @stagecraft/queue), so a retried or resumed run
 * of the same job skips the steps an earlier run finished.
 */

type DeployTarget = "netlify" | "vercel";

/**
 * Pick which deploy target to use for this site, based on the artist's
 * connected integrations. Vercel takes precedence when both are
 * connected — its API is more reliable for programmatic site creation
 * (it auto-resolves GitHub App installations; Netlify's API doesn't).
 *
 * Throws if neither is connected; the routes that queue the jobs check
 * this earlier, so a throw here means an integration was disconnected
 * between the request and the job run.
 */
export async function pickDeployTarget(userId: string): Promise<DeployTarget> {
  const integrations = await prisma.integrationAccount.findMany({
    where: { userId, provider: { in: ["netlify", "vercel"] satisfies IntegrationProvider[] } },
    select: { provider: true, metadata: true },
  });
  const connected = connectedProviders(integrations);

  if (connected.has("vercel")) return "vercel";
  if (connected.has("netlify")) return "netlify";

  throw new Error("No deploy-target integration connected (Vercel or Netlify required)");
}

/** The provisioning steps, in order. Each one's result is recorded on the job. */
export const PROVISION_STEPS = [
  "createRepo",
  "pushTemplate",
  "findInstallation",
  "mintBrokerSecret",
  "createHostProject",
  "setEnv",
] as const;

/** A failure retrying won't fix (a missing precondition): fail on the first run. */
export class PermanentProvisionError extends Error {}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * The deploy-target project as created (or adopted). JSON-only, because it
 * is stored as the `createHostProject` step's result.
 */
type HostProject = {
  deployTarget: DeployTarget;
  productionUrl: string;
  adminUrl: string;
  netlifySiteId?: string;
  netlifyLinkUrl?: string;
  vercelProjectId?: string;
  vercelProjectName?: string;
  vercelTeamId?: string | null;
  vercelTeamSlug?: string | null;
};

function hostProjectName(slug: string): string {
  return `stagecraft-site-${slug}`;
}

/** Shown when the site's repo name is already taken, usually by a deleted site's kept repo. */
function repoNameTakenMessage(owner: string, repoName: string): string {
  return (
    `A repository named ${owner}/${repoName} already exists on your GitHub account, ` +
    `probably from a site you deleted. Delete or rename it on GitHub, or choose a different site name.`
  );
}

/** Clock skew allowed between us and a provider when comparing creation times. */
const ADOPT_CLOCK_SKEW_MS = 2 * 60_000;

/**
 * Whether a resource found by name was created by an earlier attempt of
 * the step that started at `since`, rather than before it (someone else's,
 * or left from an earlier site). Unknown creation time never matches.
 */
function createdSince(createdAt: string | number | undefined, since: Date | null): boolean {
  if (!since || createdAt === undefined) return false;
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && created >= since.getTime() - ADOPT_CLOCK_SKEW_MS;
}

/**
 * Create the Netlify site, linked to the repo when Netlify's GitHub App can
 * be found. When `adoptSince` is set (an earlier attempt that started then
 * may have created it), an existing site with the same name created since
 * then is returned instead of creating another.
 */
async function createNetlifyHost(args: {
  userId: string;
  slug: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  adoptSince?: Date | null;
}): Promise<HostProject> {
  const name = hostProjectName(args.slug);
  if (args.adoptSince) {
    const existing = await findNetlifySite(args.userId, `${name}.netlify.app`);
    if (existing && createdSince(existing.createdAt, args.adoptSince)) {
      return {
        deployTarget: "netlify",
        productionUrl: existing.sslUrl,
        adminUrl: existing.adminUrl,
        netlifySiteId: existing.siteId,
        ...(existing.linked ? {} : { netlifyLinkUrl: `https://app.netlify.com/projects/${existing.siteName}/link` }),
      };
    }
  }

  // Find Netlify's GitHub App installation on the repo owner so the
  // create-site call can use App-based cloning. Without this, Netlify
  // silently falls back to deploy-key (SSH) mode, which fails on the
  // first build with "Host key verification failed". Lookup is best-
  // effort — if Netlify's App isn't installed, we omit the field and
  // the existing fallback path (plain Netlify site + manual link URL)
  // kicks in.
  const installationId = await findGithubAppInstallation(args.userId, "netlify", args.repoOwner);

  let netlifySite;
  let netlifyLinkUrl: string | undefined;
  try {
    netlifySite = await createNetlifySite({
      userId: args.userId,
      name,
      repo: {
        provider: "github",
        repo_path: `${args.repoOwner}/${args.repoName}`,
        repo_branch: args.repoBranch,
        cmd: "npm run build",
        dir: ".next",
        ...(installationId !== null ? { installation_id: installationId } : {}),
      },
    });
  } catch {
    netlifySite = await createNetlifySite({ userId: args.userId, name });
    netlifyLinkUrl = `https://app.netlify.com/projects/${netlifySite.siteName}/link`;
  }

  return {
    deployTarget: "netlify",
    productionUrl: netlifySite.sslUrl,
    adminUrl: netlifySite.adminUrl,
    netlifySiteId: netlifySite.siteId,
    ...(netlifyLinkUrl ? { netlifyLinkUrl } : {}),
  };
}

/** Set the runtime env vars on a Netlify site. Returns a warning instead of throwing. */
async function provisionNetlifyEnv(
  userId: string,
  netlifySiteId: string,
  envVars: Record<string, string>,
  // An earlier attempt may have set them already (with a broker secret
  // whose hash this run has since replaced), so overwrite rather than add.
  replace = false,
): Promise<string | undefined> {
  try {
    await setNetlifyEnvVars(userId, netlifySiteId, envVars, { replace });
    return undefined;
  } catch (cause) {
    return errorMessage(cause, "Failed to provision Netlify env vars");
  }
}

/** The Vercel team the artist scoped at /settings → Connect Vercel, if any. */
async function vercelTeamId(userId: string): Promise<string | undefined> {
  const integration = await prisma.integrationAccount.findUnique({
    where: { userId_provider: { userId, provider: "vercel" } },
    select: { metadata: true },
  });
  return integration?.metadata && typeof integration.metadata === "object" && integration.metadata !== null
    ? (integration.metadata as { teamId?: string | null }).teamId ?? undefined
    : undefined;
}

/**
 * Create the Vercel project linked to the repo. When `adoptSince` is set
 * (an earlier attempt that started then may have created it), an existing
 * project with the same name created since then is returned instead. Throws VercelGitHubAppNotInstalledError when Vercel's
 * GitHub App is missing.
 */
async function createVercelHost(args: {
  userId: string;
  slug: string;
  repoOwner: string;
  repoName: string;
  adoptSince?: Date | null;
}): Promise<HostProject> {
  const teamId = await vercelTeamId(args.userId);
  const name = hostProjectName(args.slug);

  const existing = args.adoptSince ? await findVercelProject(args.userId, name, teamId) : null;
  const project =
    (existing && createdSince(existing.createdAt, args.adoptSince ?? null) ? existing : null) ??
    (await createVercelProject({
      userId: args.userId,
      name,
      teamId,
      repo: { repo: `${args.repoOwner}/${args.repoName}` },
      framework: "nextjs",
    }));

  return {
    deployTarget: "vercel",
    productionUrl: project.productionUrl,
    adminUrl: project.adminUrl,
    vercelProjectId: project.projectId,
    vercelProjectName: project.projectName,
    vercelTeamId: project.teamId,
    vercelTeamSlug: project.teamSlug,
  };
}

/**
 * Set the runtime env vars on a Vercel project, then trigger its first
 * production deploy. Returns a warning instead of throwing.
 *
 * Vercel doesn't auto-deploy on project creation when linking to an
 * existing repo — it only deploys on subsequent pushes or webhook events.
 * Without an explicit trigger here, the production URL 404s until something
 * else kicks off the first build.
 */
async function provisionVercelEnv(
  userId: string,
  projectId: string,
  teamId: string | null | undefined,
  envVars: Record<string, string>,
): Promise<string | undefined> {
  let envWarning: string | undefined;
  try {
    await setVercelEnvVars({ userId, projectId, teamId: teamId ?? undefined, vars: envVars });
  } catch (cause) {
    envWarning = errorMessage(cause, "Failed to provision Vercel env vars");
  }

  let deployWarning: string | undefined;
  try {
    await triggerVercelDeployment(userId, projectId, teamId ?? undefined);
  } catch (cause) {
    deployWarning = errorMessage(cause, "Failed to trigger Vercel deployment");
  }
  return envWarning ?? deployWarning;
}

/**
 * Generate a broker secret for the site and store its hash. The plaintext
 * only ever lives in memory: it goes into the deploy env vars and nowhere
 * else, so it is never part of a step result.
 */
async function mintBrokerSecret(siteId: string, installationId: number): Promise<GeneratedBrokerSecret> {
  const secret = generateBrokerSecret();
  await prisma.site.update({
    where: { id: siteId },
    data: { githubInstallationId: installationId, brokerSecretHash: secret.hash },
  });
  return secret;
}

/** What provisioning needs from the artist's account, checked before any step runs. */
export interface ProvisionPreconditions {
  adminEmail: string;
  deployTarget: DeployTarget;
  resendApiKey: string;
}

/**
 * Check what provisioning needs: a verified email, a deploy target and a
 * Resend account. The routes check the same integrations up front (see
 * `siteSetupIntegrationError` in @stagecraft/shared); this catches one
 * disconnected since. It runs on every run, since none of it is stored on
 * the job, and its failures are permanent.
 */
export async function checkProvisionPreconditions(
  userId: string,
  action: SiteSetupAction,
): Promise<ProvisionPreconditions> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user?.email) {
    throw new PermanentProvisionError("User has no verified email — connect Resend at /settings to set it");
  }
  let deployTarget: DeployTarget;
  try {
    deployTarget = await pickDeployTarget(userId);
  } catch (cause) {
    throw new PermanentProvisionError(errorMessage(cause, "No deploy-target integration connected"));
  }
  const resend = await getResendCredentials(userId);
  if (!resend) {
    throw new PermanentProvisionError(
      `Resend account not connected — connect Resend at /settings before ${action} a site`,
    );
  }
  return { adminEmail: user.email, deployTarget, resendApiKey: resend.apiKey };
}

type RepoStepResult = { owner: string; name: string; defaultBranch: string };

export interface ProvisionSiteArgs {
  runner: StepRunner;
  siteId: string;
  userId: string;
  name: string;
  slug: string;
  preconditions: ProvisionPreconditions;
  /** Files pushed over the template; one replaces the template file at its path. Empty for a new site. */
  contentOverlay: readonly TemplateFile[];
  repoDescription: string;
  commitMessage: string;
}

/** What a provisioned site reports in its job result. */
export type ProvisionedSite = {
  deployTarget: DeployTarget;
  githubUrl: string;
  adminUrl: string;
  productionUrl: string;
  netlifySiteId?: string;
  netlifyAdminUrl?: string;
  netlifyLinkUrl?: string;
  vercelProjectId?: string;
  vercelProjectName?: string;
  envWarning?: string;
};

/**
 * Run the PROVISION_STEPS for a site and mark it active. Errors propagate;
 * `runProvisionJob` decides whether they're retried.
 */
export async function provisionSite(args: ProvisionSiteArgs): Promise<ProvisionedSite> {
  const { runner, siteId, userId, slug, preconditions, contentOverlay } = args;
  const { deployTarget, adminEmail, resendApiKey } = preconditions;

  // 1. Create the GitHub repo. If an earlier run started this step but
  //    didn't record it, the repo may exist already: adopt it rather than
  //    failing on "name already exists", but only if it was created since
  //    that run started. An older repo with the name isn't this job's.
  const repoName = hostProjectName(slug);
  const repo = await runner.run<RepoStepResult>("createRepo", async ({ interrupted, firstStartedAt }) => {
    let created;
    try {
      created = await createRepo({
        userId,
        name: repoName,
        description: args.repoDescription,
        isPrivate: true,
      });
    } catch (cause) {
      if (!(cause instanceof GitHubApiError && cause.status === 422)) throw cause;
      // 422 is how GitHub reports "name already exists". Look the repo up:
      // an interrupted run may adopt it, and otherwise the artist is told
      // which repo is in the way. Deleting a site keeps its repo, so this is
      // the usual outcome of deleting a site and recreating it by name. On
      // a first attempt a failed lookup falls back to GitHub's own message.
      const existing = interrupted
        ? await getOwnRepo(userId, repoName)
        : await getOwnRepo(userId, repoName).catch(() => null);
      const adopted =
        interrupted && existing && createdSince(existing.createdAt, firstStartedAt) ? existing : null;
      if (!adopted) {
        throw new PermanentProvisionError(
          existing ? repoNameTakenMessage(existing.owner, repoName) : errorMessage(cause, ""),
        );
      }
      created = adopted;
    }
    await prisma.site.update({
      where: { id: siteId },
      data: {
        githubRepoOwner: created.owner,
        githubRepoName: created.name,
        githubDefaultBranch: created.defaultBranch,
      },
    });
    return { owner: created.owner, name: created.name, defaultBranch: created.defaultBranch };
  });

  // 2. Push the template with the overlay on top, plus the platform
  //    scaffold (Dependabot config + template stamp) so the site keeps its
  //    deps current after it stops tracking the template. See
  //    site-scaffold.ts. A new site pushes the template as-is: the artist
  //    personalizes content via the Puck editor at /admin once it's up.
  //    pushFiles makes no commit when the branch already has these files,
  //    so re-running after an interrupted push is safe.
  await runner.run("pushTemplate", async () => {
    const templateFiles = await readTemplateFiles();
    const overlayPaths = new Set(contentOverlay.map((f) => f.path));
    const files = [
      ...templateFiles.filter((f) => !overlayPaths.has(f.path)),
      ...contentOverlay.map((f) => ({ path: f.path, content: f.content })),
      ...buildSiteScaffoldFiles({
        template: "musician-site",
        templateVersion: templateVersionFromFiles(templateFiles),
      }),
    ];
    const { commitSha } = await pushFiles(
      userId,
      repo.owner,
      repo.name,
      repo.defaultBranch,
      files,
      args.commitMessage,
    );

    // The Dependabot auto-merge workflow ships in its own commit: files
    // under .github/workflows/ require the `workflow` OAuth scope, which a
    // token issued before we requested it won't have. Best-effort — on
    // failure we log and continue (the artist re-authenticates to enable
    // auto-merge; the cooldown Dependabot PRs work regardless).
    let workflowPushed = true;
    try {
      await pushFiles(
        userId,
        repo.owner,
        repo.name,
        repo.defaultBranch,
        [{ path: SITE_AUTOMERGE_WORKFLOW_PATH, content: buildDependabotAutoMergeWorkflow() }],
        "Add Dependabot auto-merge workflow",
      );
    } catch (cause) {
      workflowPushed = false;
      console.warn(
        "[provision-site] auto-merge workflow push failed (missing `workflow` scope?); site provisioned without it",
        { siteId, owner: repo.owner, name: repo.name, error: errorMessage(cause, String(cause)) },
      );
    }
    return { commitSha, workflowPushed };
  });

  // 3. Look for the platform's GitHub App ("stagecraft-bot") on the repo
  //    owner. When found, the broker secret is minted now and baked into
  //    the first deploy's env vars, so the artist skips the per-site
  //    "Connect repo" step. When not (most often GitHub denies
  //    `/user/installations` over an OAuth token and no env fallback is
  //    set), the install-callback flow is the safety net: the artist clicks
  //    "Connect repo" later and the callback provisions the secret.
  const installationId = await runner.run<number | null>("findInstallation", async () => {
    const viaUser = await findGithubAppInstallation(userId, "stagecraft-bot", repo.owner);
    if (viaUser !== null) return viaUser;
    try {
      return await findAppInstallationForOwner(repo.owner);
    } catch {
      return null; // App credentials not configured — skip.
    }
  });

  // 4. Mint the broker secret.
  let brokerSecret: GeneratedBrokerSecret | null = null;
  await runner.run("mintBrokerSecret", async () => {
    if (installationId === null) return { minted: false };
    brokerSecret = await mintBrokerSecret(siteId, installationId);
    return { minted: true };
  });

  // 5. Create the deploy project on the chosen target, linked to the repo.
  //    Its ids go on the Site right away so deleting the site cleans it up
  //    even if a later step fails.
  const host = await runner.run<HostProject>("createHostProject", async ({ firstStartedAt }) => {
    const repoArgs = { userId, slug, repoOwner: repo.owner, repoName: repo.name, adoptSince: firstStartedAt };
    const project =
      deployTarget === "vercel"
        ? await createVercelHost(repoArgs)
        : await createNetlifyHost({ ...repoArgs, repoBranch: repo.defaultBranch });
    await prisma.site.update({
      where: { id: siteId },
      data: {
        deployTarget: project.deployTarget,
        ...(project.netlifySiteId
          ? { netlifySiteId: project.netlifySiteId, netlifyAdminUrl: project.adminUrl }
          : {}),
        ...(project.vercelProjectId
          ? {
              vercelProjectId: project.vercelProjectId,
              vercelProjectName: project.vercelProjectName,
              vercelTeamId: project.vercelTeamId,
              vercelTeamSlug: project.vercelTeamSlug,
            }
          : {}),
      },
    });
    return project;
  });

  // 6. Set the runtime env vars (and, on Vercel, trigger the first deploy).
  //    Failures here are soft: the site still goes active, with a warning.
  //
  // Intentionally NOT provisioned (the template defaults them):
  //   - STAGECRAFT_PLATFORM_URL — hardcoded prod default in publish.ts
  //   - MAGIC_LINK_FROM — defaults to Resend sandbox in email.ts; only
  //     provisioned when the artist has a custom verified sender (future)
  //   - MAGIC_LINK_SIGNING_SECRET — derived from STAGECRAFT_BROKER_SECRET
  //     via HKDF inside the template's auth.ts (see deriveMagicLinkSecret)
  const env = await runner.run("setEnv", async ({ interrupted }) => {
    // The plaintext secret is never stored, so a run that resumed after
    // step 4 mints a fresh one here; its hash replaces the earlier one.
    if (installationId !== null && brokerSecret === null) {
      brokerSecret = await mintBrokerSecret(siteId, installationId);
    }
    const secret: GeneratedBrokerSecret | null = brokerSecret;
    const envVars: Record<string, string> = {
      // ADMIN_EMAIL = the platform user's email-of-record, set during
      // Resend connect. Same email everywhere: sign in to Stagecraft, the
      // artist site's /admin, and the inbox that receives magic links.
      ADMIN_EMAIL: adminEmail,
      // STAGECRAFT_SITE_ID, not SITE_ID — Netlify reserves the latter
      // (auto-injects its own site id into Functions). Same name on Vercel
      // so the artist template stays single-codepath.
      STAGECRAFT_SITE_ID: siteId,
      RESEND_API_KEY: resendApiKey,
      ...(secret ? { STAGECRAFT_BROKER_SECRET: secret.plaintext } : {}),
    };
    const warning =
      host.deployTarget === "vercel"
        ? await provisionVercelEnv(userId, host.vercelProjectId!, host.vercelTeamId, envVars)
        : await provisionNetlifyEnv(userId, host.netlifySiteId!, envVars, interrupted);
    return { warning: warning ?? null };
  });

  // Finish: the site goes active. Not a step: it's one idempotent write.
  await prisma.site.update({
    where: { id: siteId },
    data: { productionUrl: host.productionUrl, status: "active" },
  });

  return {
    deployTarget: host.deployTarget,
    githubUrl: `https://github.com/${repo.owner}/${repo.name}`,
    adminUrl: host.adminUrl,
    productionUrl: host.productionUrl,
    ...(host.netlifySiteId ? { netlifyAdminUrl: host.adminUrl, netlifySiteId: host.netlifySiteId } : {}),
    ...(host.vercelProjectId
      ? { vercelProjectId: host.vercelProjectId, vercelProjectName: host.vercelProjectName }
      : {}),
    ...(host.netlifyLinkUrl ? { netlifyLinkUrl: host.netlifyLinkUrl } : {}),
    ...(env.warning ? { envWarning: env.warning } : {}),
  };
}

/**
 * Run a provisioning job handler's body on a step runner and settle its
 * failures the same way for create_site and migrate_site.
 *
 * A transient failure is thrown back to the worker, which re-queues the job
 * with backoff (up to MAX_RETRY_ATTEMPTS); the next run resumes at the step
 * that failed. Once retries are spent, or for a failure retrying can't fix
 * (PermanentProvisionError), the site is marked `error` and the job fails
 * with its step progress kept, so a manual retry resumes from there too.
 */
export async function runProvisionJob<P extends object>(
  ctx: JobContext,
  args: {
    /** Payload fields the job can't run without, e.g. ["name", "slug"]. */
    requiredFields: readonly (keyof P & string)[];
    unknownErrorMessage: string;
    run: (runner: StepRunner) => Promise<JobResult>;
  },
): Promise<JobResult> {
  const siteId = ctx.job.siteId;
  const payload = ctx.job.requestPayload as Record<string, unknown> | null;
  if (args.requiredFields.some((field) => !payload?.[field])) {
    // Not retryable, so don't leave the site showing `creating`.
    await prisma.site.update({ where: { id: siteId }, data: { status: "error" } });
    return { success: false, message: `Missing required payload fields: ${args.requiredFields.join(", ")}` };
  }

  const runner = await createStepRunner(ctx.job.id);

  try {
    return await args.run(runner);
  } catch (error) {
    // Another run owns the job now; leave the site to it.
    if (error instanceof LeaseLostError) throw error;

    const steps = runner.progress() as unknown as Prisma.JsonObject;

    if (error instanceof VercelGitHubAppNotInstalledError) {
      // Keep the repo: once the artist installs Vercel's App, a retry
      // resumes at createHostProject instead of starting over.
      await prisma.site.update({ where: { id: siteId }, data: { status: "error" } });
      return {
        success: false,
        message: error.message,
        failureCategory: "vercel_github_app_missing",
        data: { installUrl: error.installUrl, steps },
      };
    }

    const retryable = !(error instanceof PermanentProvisionError);
    if (retryable && ctx.job.retryAttempts < MAX_RETRY_ATTEMPTS) {
      // The worker re-queues the job with backoff; the site stays `creating`.
      throw error;
    }

    await prisma.site.update({ where: { id: siteId }, data: { status: "error" } });
    return {
      success: false,
      message: errorMessage(error, args.unknownErrorMessage),
      data: { steps },
    };
  }
}
