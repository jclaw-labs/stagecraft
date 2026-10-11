import { prisma } from "@stagecraft/db";
import {
  createStepRunner,
  readStepProgress,
  type JobContext,
  type JobResult,
  type StepRunner,
} from "@stagecraft/queue";
import type { JobType, UpgradeSiteBlocker, UpgradeSiteResultData } from "@stagecraft/shared";

import {
  checkGitHubToken,
  createBranch,
  createPullRequest,
  GitHubApiError,
  githubRepoClient,
  type CommitFile,
  type GitHubRepoClient,
} from "@/lib/integrations/github";
import {
  buildDependabotAutoMergeWorkflow,
  buildSiteScaffoldFiles,
  SITE_AUTOMERGE_WORKFLOW_PATH,
  TEMPLATE_STAMP_PATH,
} from "@/lib/site-scaffold";
import {
  changedCodeFiles,
  fetchTargetSchemaVersion,
  isCollectionFile,
  isDraftBranch,
  isLockfile,
  isOnRelease,
  manifestBaseline,
  migrateCollections,
  readStamp,
  targetShell,
  templatePushBaseline,
  TEMPLATE_PUSH_MARKER_PATH,
  UnsupportedSchemaVersionError,
  UPGRADE_BRANCH,
  upgradeCommitMessage,
  upgradeDeletions,
  upgradePullRequestBody,
  upgradePullRequestTitle,
  type Baseline,
  type StampSummary,
  type TargetShell,
} from "@/lib/site-upgrade";
import { readTemplateFiles } from "@/lib/template-reader";

/**
 * The upgrade_site job: open (or update) a pull request on a site's repo
 * that moves it onto a release of `@jclaw-labs/musician-site`, the one-time
 * migration and every later major alike (ADR-016 §4).
 *
 * It runs as the named steps below on the step runner provisioning uses
 * (`createStepRunner`), so a retried run skips the finished ones:
 *
 *   1. `checkBaseline`: compare our code paths in the repo against the
 *      baseline, and stop with the changed files on a customized site.
 *   2. `commitUpgrade`: build the upgrade commit on the default branch's
 *      head and point `stagecraft/upgrade` at it.
 *   3. `openPullRequest`: update the branch's open pull request, or open one.
 *
 * It acts as the site's owner, with their GitHub OAuth token (the GitHub App
 * has no pull-request or workflow permission, ADR-008), and never touches
 * the default branch. A stopped run (`UpgradeSiteBlocker`) fails the job
 * without retries; anything else thrown is retried by the worker.
 */

/** The upgrade steps, in order. Each one's result is recorded on the job. */
export const UPGRADE_SITE_STEPS = ["checkBaseline", "commitUpgrade", "openPullRequest"] as const;

/** The OAuth scopes the upgrade needs: `repo` to push, `workflow` for `.github/workflows/`. */
export const UPGRADE_REQUIRED_SCOPES = ["repo", "workflow"] as const;

/** The jobs whose `pushTemplate` step record is the template push (ADR-016 §4). */
const PROVISIONING_JOB_TYPES: JobType[] = ["create_site", "migrate_site"];

/** Why a run stopped: what the job reports, with the blocker in its data. */
class UpgradeBlockedError extends Error {
  constructor(
    readonly blocker: UpgradeSiteBlocker,
    message: string,
    readonly details: Pick<UpgradeSiteResultData, "changedFiles" | "draftBranches"> = {},
  ) {
    super(message);
    this.name = "UpgradeBlockedError";
  }
}

export const REAUTH_MESSAGE =
  "Stagecraft can't use your GitHub sign-in to open the upgrade pull request: it has expired or doesn't " +
  "include permission to update workflows. Sign in with GitHub again, then run the upgrade again.";

type BaselineResult = {
  /** The default branch's head the comparison read; the upgrade commit builds on it. */
  headSha: string;
  /** Where the baseline came from. */
  baseline: "manifest" | "template_push";
  /** The template push commit, for a site without a manifest. */
  baselineSha: string | null;
  upToDate: boolean;
};

type CommitResult = { commitSha: string; deletedCount: number; migratedFiles: string[]; addsWorkflow: boolean; removesLockfile: boolean };

type PullRequestStepResult = { number: number; url: string; action: "opened" | "updated" };

/** The `pushTemplate` commit the site's provisioning job recorded, if any (#375). */
async function recordedTemplatePush(siteId: string): Promise<string | null> {
  const job = await prisma.siteJob.findFirst({
    where: { siteId, type: { in: PROVISIONING_JOB_TYPES } },
    orderBy: { createdAt: "asc" },
    select: { resultPayload: true },
  });
  if (!job) return null;
  const result = readStepProgress(job.resultPayload).pushTemplate?.result;
  const commitSha =
    typeof result === "object" && result !== null && !Array.isArray(result) ? result.commitSha : undefined;
  return typeof commitSha === "string" ? commitSha : null;
}

/**
 * The baseline for a site without a manifest: the oldest commit touching
 * `src/lib/`. A `pushTemplate` step record that touches `src/lib/` must be
 * that commit, or the job stops for a hand check; a record that doesn't
 * (a resumed push can record the workflow commit) is ignored.
 */
async function findTemplatePush(client: GitHubRepoClient, siteId: string, branch: string): Promise<string> {
  const oldest = await client.findOldestCommitTouching(TEMPLATE_PUSH_MARKER_PATH, branch);
  if (!oldest) {
    throw new UpgradeBlockedError(
      "baseline_mismatch",
      `No commit on ${branch} touches ${TEMPLATE_PUSH_MARKER_PATH}/, so there's no template push to compare the site against. Check it by hand.`,
    );
  }
  const recorded = await recordedTemplatePush(siteId);
  if (recorded && recorded !== oldest && (await client.commitTouchesPath(recorded, TEMPLATE_PUSH_MARKER_PATH))) {
    throw new UpgradeBlockedError(
      "baseline_mismatch",
      `The template push recorded at setup (${recorded}) isn't the oldest commit touching ${TEMPLATE_PUSH_MARKER_PATH}/ (${oldest}). Check the site by hand.`,
    );
  }
  return oldest;
}

/** The repo's stamp file, if any. */
async function readStampFile(client: GitHubRepoClient, tree: ReadonlyMap<string, string>) {
  const sha = tree.get(TEMPLATE_STAMP_PATH);
  return readStamp(sha ? await client.getBlobText(sha) : null);
}

/**
 * The baseline a site is compared against: its stamp's manifest, or for a
 * site without one, the template push (`baselineSha`, from
 * `findTemplatePush`).
 */
async function resolveBaseline(
  client: GitHubRepoClient,
  tree: ReadonlyMap<string, string>,
  stamp: StampSummary,
  baselineSha: string | null,
): Promise<Baseline> {
  if (stamp.manifest) return manifestBaseline(stamp.manifest);
  if (!baselineSha) throw new Error("A site without a manifest needs its template push as the baseline");
  return templatePushBaseline(await client.getTree(baselineSha), tree);
}

async function checkBaseline(
  client: GitHubRepoClient,
  siteId: string,
  branch: string,
  shell: TargetShell,
): Promise<BaselineResult> {
  const headSha = await client.getBranchHead(branch);
  if (!headSha) throw new Error(`${client.owner}/${client.repo} has no ${branch} branch`);
  const tree = await client.getTree(headSha);
  const stamp = await readStampFile(client, tree);
  const packageSha = tree.get("package.json");
  const packageJson = packageSha ? await client.getBlobText(packageSha) : null;

  const baselineSha = stamp.manifest ? null : await findTemplatePush(client, siteId, branch);
  const baseline = await resolveBaseline(client, tree, stamp, baselineSha);
  const changedFiles = await changedCodeFiles(baseline, tree, (sha) => client.getBlobText(sha));
  if (changedFiles.length > 0) {
    throw new UpgradeBlockedError(
      "customized",
      `This site's code was changed in its repository (${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}), so it needs upgrading by hand.`,
      { changedFiles },
    );
  }
  return {
    headSha,
    baseline: stamp.manifest ? "manifest" : "template_push",
    baselineSha,
    upToDate: isOnRelease(packageJson, stamp, shell.packageVersion),
  };
}

/**
 * The collection definitions the target release needs rewritten. Before
 * returning any, checks every draft branch: one with unpublished changes to
 * a rewritten file would conflict with the upgrade, so the job stops and
 * asks the artist to publish or discard them first.
 */
async function migrateContent(
  client: GitHubRepoClient,
  tree: ReadonlyMap<string, string>,
  branch: string,
  shell: TargetShell,
  fetchImpl: typeof fetch | undefined,
): Promise<CommitFile[]> {
  const collectionPaths = [...tree.keys()].filter(isCollectionFile);
  if (collectionPaths.length === 0) return [];
  const target = await fetchTargetSchemaVersion(shell.packageVersion, { fetchImpl });
  const collections = await Promise.all(
    collectionPaths.map(async (path) => ({ path, content: await client.getBlobText(tree.get(path)!) })),
  );
  let migrated: CommitFile[];
  try {
    migrated = migrateCollections(collections, target);
  } catch (error) {
    if (error instanceof UnsupportedSchemaVersionError) {
      throw new UpgradeBlockedError("unsupported_schema", error.message);
    }
    throw error;
  }
  if (migrated.length === 0) return [];

  const rewritten = new Set(migrated.map((f) => f.path));
  const blocking: string[] = [];
  for (const draft of (await client.listBranches()).filter(isDraftBranch).sort()) {
    const changed = await client.changedFilesSince(branch, draft);
    if (changed.some((path) => rewritten.has(path))) blocking.push(draft);
  }
  if (blocking.length > 0) {
    throw new UpgradeBlockedError(
      "drafts_pending",
      "This upgrade rewrites content that has unpublished edits in the site's editor. Publish or discard those edits, then run the upgrade again.",
      { draftBranches: blocking },
    );
  }
  return migrated;
}

async function commitUpgrade(
  client: GitHubRepoClient,
  args: { userId: string; branch: string; checked: BaselineResult; shell: TargetShell; fetchImpl?: typeof fetch },
): Promise<CommitResult> {
  const { userId, branch, shell } = args;
  const { headSha } = args.checked;
  const tree = await client.getTree(headSha);
  const stamp = await readStampFile(client, tree);
  const baseline = await resolveBaseline(client, tree, stamp, args.checked.baselineSha);
  const migrated = await migrateContent(client, tree, branch, shell, args.fetchImpl);

  const createdAt = stamp.createdAt && !Number.isNaN(Date.parse(stamp.createdAt)) ? new Date(stamp.createdAt) : new Date();
  const writes: CommitFile[] = [
    ...shell.files,
    ...buildSiteScaffoldFiles({ template: "musician-site", files: shell.files, createdAt }),
    { path: SITE_AUTOMERGE_WORKFLOW_PATH, content: buildDependabotAutoMergeWorkflow() },
    ...migrated,
  ];
  const deletePaths = upgradeDeletions(tree, baseline, writes);
  const commitSha = await client.createCommit({
    parentSha: headSha,
    files: writes,
    deletePaths,
    message: upgradeCommitMessage(shell.packageVersion),
  });

  // One branch for every run: a re-run moves it to the new commit, so its
  // open pull request shows the latest upgrade instead of a second one.
  if ((await client.getBranchHead(UPGRADE_BRANCH)) === null) {
    await createBranch(userId, client.owner, client.repo, branch, UPGRADE_BRANCH);
  }
  await client.setBranchHead(UPGRADE_BRANCH, commitSha);

  return {
    commitSha,
    deletedCount: deletePaths.filter((path) => !isLockfile(path)).length,
    migratedFiles: migrated.map((f) => f.path),
    addsWorkflow: !tree.has(SITE_AUTOMERGE_WORKFLOW_PATH),
    removesLockfile: deletePaths.some(isLockfile),
  };
}

async function openPullRequest(
  client: GitHubRepoClient,
  args: { userId: string; branch: string; shell: TargetShell; commit: CommitResult },
): Promise<PullRequestStepResult> {
  const { userId, branch, shell, commit } = args;
  const title = upgradePullRequestTitle(shell.packageVersion);
  const body = upgradePullRequestBody({
    packageVersion: shell.packageVersion,
    deletedCount: commit.deletedCount,
    migratedFiles: commit.migratedFiles,
    addsWorkflow: commit.addsWorkflow,
    removesLockfile: commit.removesLockfile,
  });
  const existing = await client.findOpenPullRequest(UPGRADE_BRANCH, branch);
  if (existing) {
    const updated = await client.updatePullRequest(existing.number, { title, body });
    return { number: updated.number, url: updated.htmlUrl, action: "updated" };
  }
  const opened = await createPullRequest(userId, client.owner, client.repo, { title, body, head: UPGRADE_BRANCH, base: branch });
  return { number: opened.number, url: opened.htmlUrl, action: "opened" };
}

function blocked(error: UpgradeBlockedError, runner: StepRunner | null, packageVersion?: string): JobResult {
  const data: UpgradeSiteResultData = {
    blocker: error.blocker,
    ...(packageVersion ? { packageVersion } : {}),
    ...error.details,
  };
  return {
    success: false,
    message: error.message,
    failureCategory: error.blocker === "reauth_required" ? "github_api_error" : "validation_error",
    data: { ...data, ...(runner ? { steps: runner.progress() } : {}) },
  };
}

/** Options for tests: the registry fetch. */
export interface UpgradeSiteOptions {
  fetchImpl?: typeof fetch;
}

/**
 * The upgrade_site job handler, run by the job queue (see lib/jobs/worker.ts).
 */
export async function handleUpgradeSite(ctx: JobContext, options: UpgradeSiteOptions = {}): Promise<JobResult> {
  const { siteId, userId } = ctx.job;
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { githubRepoOwner: true, githubRepoName: true, githubDefaultBranch: true },
  });
  if (!site?.githubRepoOwner || !site.githubRepoName) {
    return { success: false, message: "This site has no GitHub repository to upgrade", failureCategory: "validation_error" };
  }
  const branch = site.githubDefaultBranch;

  let runner: StepRunner | null = null;
  let shell: TargetShell | null = null;
  try {
    shell = targetShell(await readTemplateFiles());
    if (!shell) {
      throw new UpgradeBlockedError(
        "no_release",
        "No release of the musician-site package is available to upgrade to yet.",
      );
    }
    const target: TargetShell = shell;

    // Checked on every run: nothing about the token is stored on the job.
    const token = await checkGitHubToken(userId, UPGRADE_REQUIRED_SCOPES);
    if (token.status !== "ok") throw new UpgradeBlockedError("reauth_required", REAUTH_MESSAGE);

    const client = await githubRepoClient(userId, site.githubRepoOwner, site.githubRepoName);
    const steps = await createStepRunner(ctx.job.id);
    runner = steps;

    const checked = await steps.run<BaselineResult>("checkBaseline", () => checkBaseline(client, siteId, branch, target));
    if (checked.upToDate) {
      const data: UpgradeSiteResultData = { packageVersion: target.packageVersion, upToDate: true };
      return { success: true, data: { ...data, steps: steps.progress() } };
    }

    const commit = await steps.run<CommitResult>("commitUpgrade", () =>
      commitUpgrade(client, { userId, branch, checked, shell: target, fetchImpl: options.fetchImpl }),
    );

    const pullRequest = await steps.run<PullRequestStepResult>("openPullRequest", () =>
      openPullRequest(client, { userId, branch, shell: target, commit }),
    );

    const data: UpgradeSiteResultData = { packageVersion: target.packageVersion, pullRequest };
    return { success: true, data: { ...data, steps: steps.progress() } };
  } catch (error) {
    if (error instanceof UpgradeBlockedError) return blocked(error, runner, shell?.packageVersion);
    // GitHub rejecting the token part way is the same stale sign-in.
    if (error instanceof GitHubApiError && error.status === 401) {
      return blocked(new UpgradeBlockedError("reauth_required", REAUTH_MESSAGE), runner, shell?.packageVersion);
    }
    // Anything else (including LeaseLostError) goes back to the worker,
    // which retries with backoff and resumes at the unfinished step.
    throw error;
  }
}
