import { randomUUID } from "node:crypto";

import {
  collectionDefRepoPath,
  collectionDefSchema,
  itemFileShellSchema,
  itemRepoPath,
  itemSlugSchema,
  orderFileSchema,
  orderRepoPath,
  slugSchema,
  type CollectionDef,
} from "./collections";
import {
  localPathForRepoPath,
  stringifyContent,
  unlinkIfExists,
  writeText,
} from "./fs-helpers";
import {
  commitFiles,
  commitSelectedPathsInto,
  ConcurrentEditError,
  ensureBranchExists,
  mergeBranchInto,
  resetBranchTo,
  squashBranchInto,
  type FileToCommit,
} from "./git-commit";
import { publishTokenResponseSchema, type PublishWarning } from "./publish-types";
import { DRAFT_BRANCH, resolveDraftBranch } from "./draft-branch";

// The DRAFT_BRANCH constant and the per-editor resolver now live in
// ./draft-branch (ADR-011). Re-exported here for back-compat with
// existing importers (read-store, draft-changes, tests).
export { DRAFT_BRANCH };

export class PublishError extends Error {
  constructor(
    public code:
      | "broker-unreachable"
      | "broker-rejected"
      | "github-failed"
      | "no-platform-configured"
      // ADR-010 §6: `commitFiles` exhausted its retry budget on a
      // stale-ref race. Distinct from `github-failed` so the editor
      // can surface a "someone else just saved" UX. Mirrored in the
      // structured envelope (`publishErrorSchema` in publish-types.ts).
      | "concurrent-edit",
    message: string,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

/**
 * Thrown by `saveAndPublish()` when the change was committed to the draft
 * branch but publishing that draft to `main` then failed. The save
 * itself persisted (the draft-aware store already reads it), so callers
 * must not report it as a failed save — and a retry of the same request
 * would see the change as already applied. `publishFailure` is the
 * `publishDraftToMain` error; `code` / `message` mirror it.
 */
export class DraftSavedPublishError extends PublishError {
  constructor(
    public draftCommitSha: string | null,
    public publishFailure: PublishError,
  ) {
    super(publishFailure.code, publishFailure.message);
    this.name = "DraftSavedPublishError";
  }
}

/**
 * Targets the publish flow can write. Each target maps to a known
 * repo path under `src/content/collections/<slug>/...`. Item payloads
 * are validated against the collection's dynamic schema at the API-
 * route level (which has the CollectionDef in hand); this layer only
 * enforces the structural shell (`{ id, createdAt, updatedAt, values }`)
 * so an obviously malformed payload fails before commit.
 *
 * The legacy `page` / `site-config` / `header-config` / `appearance` /
 * `delete-page` kinds were removed in ADR-009 PR 3 — every editable
 * surface is now a collection, and `content.ts` translates the legacy
 * API into `collection-item` writes.
 */
export type PublishTarget =
  | { kind: "collection-def"; collectionSlug: string; data: CollectionDef }
  | {
      kind: "collection-item";
      collectionSlug: string;
      itemSlug: string;
      /** Pre-validated against the collection's schema by the caller. */
      data: unknown;
    }
  | { kind: "delete-collection-item"; collectionSlug: string; itemSlug: string }
  | { kind: "collection-order"; collectionSlug: string; data: string[] };

export type PublishArgs = {
  targets: PublishTarget[];
  authorEmail: string;
  authorName?: string;
  /** Human-readable subject for the commit. Defaults to a generated summary. */
  commitSubject?: string;
};

export type PublishResult = {
  /** SHA of the commit on the artist's repo, or null when in dev fallback mode. */
  commitSha: string | null;
  /** Whether this publish went through GitHub or the local-disk dev fallback. */
  mode: "github" | "local";
};

const STAGECRAFT_PLATFORM_URL_DEFAULT = "https://stagecraft.website";

export type Env = {
  platformUrl: string;
  siteId: string | undefined;
  brokerSecret: string | undefined;
  branch: string;
};

export function readEnv(): Env {
  const overridden = process.env.STAGECRAFT_PLATFORM_URL?.replace(/\/$/, "");
  return {
    platformUrl:
      overridden && overridden.length > 0
        ? overridden
        : STAGECRAFT_PLATFORM_URL_DEFAULT,
    siteId: process.env.STAGECRAFT_SITE_ID,
    brokerSecret: process.env.STAGECRAFT_BROKER_SECRET,
    branch: process.env.SITE_GIT_BRANCH ?? "main",
  };
}

export function isPlatformConfigured(env: Env = readEnv()): boolean {
  return Boolean(env.siteId && env.brokerSecret);
}

/**
 * Per-process cache of broker-minted publish tokens, keyed by
 * `siteId`. Each admin request normally takes one of these — without
 * a cache, navigating the admin (or hitting the indicator's polling)
 * mints a fresh installation token every time, which pressures the
 * platform broker and wastes ~50-100ms per request.
 *
 * Lifetime: lives for the life of the serverless instance / Node
 * process. A cold start re-mints. Cross-instance is fine because
 * tokens are GitHub-issued and valid in any process for the artist
 * site.
 *
 * Re-mint trigger: we treat the token as expired `TOKEN_RENEW_BUFFER_MS`
 * before the broker's declared `expiresAt`. The buffer keeps us from
 * returning a token that'd expire mid-publish, which would surface
 * as a confusing `auth-failed` from GitHub. The broker mints
 * 1-hour tokens today, so a 60s buffer leaves the artist's commit
 * comfortably within the valid window.
 */
type CachedToken = {
  token: string;
  owner: string;
  repo: string;
  expiresAtMs: number;
};

const TOKEN_RENEW_BUFFER_MS = 60_000;

const tokenCache = new Map<string, CachedToken>();

/**
 * Test-only: clear the per-process token cache. Module-level cache
 * leaks across test files unless reset, so any test that exercises
 * the real `fetchPublishToken` (rather than mocking the export
 * outright) should call this in `beforeEach`.
 */
export function __resetPublishTokenCacheForTests(): void {
  tokenCache.clear();
}

export async function fetchPublishToken(env: Env): Promise<{
  token: string;
  owner: string;
  repo: string;
}> {
  const siteId = env.siteId;
  if (siteId) {
    const cached = tokenCache.get(siteId);
    if (cached && cached.expiresAtMs - Date.now() > TOKEN_RENEW_BUFFER_MS) {
      return { token: cached.token, owner: cached.owner, repo: cached.repo };
    }
  }

  let response: Response;
  try {
    response = await fetch(`${env.platformUrl}/api/publish-token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.brokerSecret}`,
      },
      body: JSON.stringify({ siteId: env.siteId }),
    });
  } catch (cause) {
    throw new PublishError(
      "broker-unreachable",
      `Could not reach token broker: ${String(cause)}`,
    );
  }

  if (!response.ok) {
    throw new PublishError(
      "broker-rejected",
      `Token broker returned ${response.status} ${response.statusText}`,
    );
  }

  const parsed = publishTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new PublishError(
      "broker-rejected",
      `Token broker returned malformed response: ${parsed.error.message}`,
    );
  }
  const token = parsed.data.token;
  const owner = parsed.data.repo.owner;
  const repo = parsed.data.repo.name;
  if (siteId) {
    tokenCache.set(siteId, {
      token,
      owner,
      repo,
      expiresAtMs: new Date(parsed.data.expiresAt).getTime(),
    });
  }
  return { token, owner, repo };
}

/**
 * Validate + normalise every target into a {repoPath, content} pair we can
 * hand to the commit flow. Each target's schema is parsed here so a bad
 * payload from the API fails before the GitHub call.
 *
 * Returns `delete-page` slugs separately because git-commit's `commitFiles`
 * only adds files; deletions need a different tree entry.
 */
function planFiles(targets: PublishTarget[]): {
  writes: FileToCommit[];
  deletePaths: string[];
} {
  const writes: FileToCommit[] = [];
  const deletePaths: string[] = [];

  for (const target of targets) {
    switch (target.kind) {
      case "collection-def": {
        const collectionSlug = slugSchema.parse(target.collectionSlug);
        const parsed = collectionDefSchema.parse(target.data);
        if (parsed.slug !== collectionSlug) {
          throw new Error(
            `collection-def: def.slug (${parsed.slug}) must match collectionSlug (${collectionSlug})`,
          );
        }
        writes.push({
          path: collectionDefRepoPath(collectionSlug),
          content: stringifyContent(parsed),
        });
        break;
      }
      case "collection-item": {
        const collectionSlug = slugSchema.parse(target.collectionSlug);
        const itemSlug = itemSlugSchema.parse(target.itemSlug);
        // Per-field validation (maxLength, options, etc.) requires the
        // CollectionDef and happens at the API-route level. Here we
        // enforce the structural shell — `{ id, values }` — so a
        // malformed payload (missing id, wrong wrapper, an entire
        // CollectionDef pasted by mistake) fails before commit rather
        // than at the next read.
        const shellChecked = itemFileShellSchema.parse(target.data);
        writes.push({
          path: itemRepoPath(collectionSlug, itemSlug),
          content: stringifyContent(shellChecked),
        });
        break;
      }
      case "delete-collection-item": {
        const collectionSlug = slugSchema.parse(target.collectionSlug);
        const itemSlug = itemSlugSchema.parse(target.itemSlug);
        deletePaths.push(itemRepoPath(collectionSlug, itemSlug));
        break;
      }
      case "collection-order": {
        const collectionSlug = slugSchema.parse(target.collectionSlug);
        const parsed = orderFileSchema.parse(target.data);
        writes.push({
          path: orderRepoPath(collectionSlug),
          content: stringifyContent(parsed),
        });
        break;
      }
    }
  }

  return { writes, deletePaths };
}

function summariseTargets(targets: PublishTarget[]): string {
  // Stable order so re-runs produce the same commit subject.
  const parts: string[] = [];
  const collectionDefs = targets
    .filter((t): t is Extract<PublishTarget, { kind: "collection-def" }> => t.kind === "collection-def")
    .map((t) => t.collectionSlug);
  if (collectionDefs.length) parts.push(`collection defs: ${collectionDefs.join(", ")}`);
  const collectionItems = targets
    .filter((t): t is Extract<PublishTarget, { kind: "collection-item" }> => t.kind === "collection-item")
    .map((t) => `${t.collectionSlug}/${t.itemSlug}`);
  if (collectionItems.length) parts.push(`items: ${collectionItems.join(", ")}`);
  const orders = targets
    .filter((t): t is Extract<PublishTarget, { kind: "collection-order" }> => t.kind === "collection-order")
    .map((t) => t.collectionSlug);
  if (orders.length) parts.push(`order: ${orders.join(", ")}`);
  const itemDeletes = targets
    .filter((t): t is Extract<PublishTarget, { kind: "delete-collection-item" }> => t.kind === "delete-collection-item")
    .map((t) => `${t.collectionSlug}/${t.itemSlug}`);
  if (itemDeletes.length) parts.push(`delete items: ${itemDeletes.join(", ")}`);
  return parts.length ? `Update ${parts.join(" + ")}` : "Update content";
}

async function writeLocal(targets: PublishTarget[]): Promise<PublishResult> {
  const { writes, deletePaths } = planFiles(targets);
  await Promise.all(
    writes.map((file) => writeText(localPathForRepoPath(file.path), file.content)),
  );
  await Promise.all(deletePaths.map((p) => unlinkIfExists(localPathForRepoPath(p))));
  return { commitSha: null, mode: "local" };
}

/**
 * Save the targets to the draft branch, then publish the draft to
 * `main` in the same call: `saveToDraft` followed by
 * `publishDraftToMain`. Most admin saves stop at `saveToDraft`; this is
 * for the one-shot flows (the welcome wizard) that go live straight away.
 *
 * Returns the squash commit's SHA on `main` (the deploy trigger).
 */
export async function saveAndPublish(args: PublishArgs): Promise<PublishResult> {
  if (args.targets.length === 0) {
    throw new PublishError("github-failed", "saveAndPublish: no targets supplied");
  }
  const env = readEnv();
  if (!isPlatformConfigured(env)) {
    return writeLocal(args.targets);
  }

  const saveResult = await saveToDraft(args);
  if (saveResult.mode === "local") {
    return saveResult;
  }
  // Strip the extra `alreadyInSync` field from publishDraftToMain's
  // return so callers see exactly the PublishResult
  // shape. The publishDraftToMain result type is widened
  // (PublishResult & { alreadyInSync }); narrowing here keeps the
  // type contract honest.
  //
  // The draft commit above has landed by now, so a failure from here on
  // is "saved, not published" — `DraftSavedPublishError`, not a plain
  // `PublishError` that would read as a failed save.
  let publishResult: PublishDraftToMainResult;
  try {
    publishResult = await publishDraftToMain({
      authorEmail: args.authorEmail,
      authorName: args.authorName,
      commitSubject: args.commitSubject,
    });
  } catch (cause) {
    if (cause instanceof PublishError) {
      throw new DraftSavedPublishError(saveResult.commitSha, cause);
    }
    throw cause;
  }
  return { commitSha: publishResult.commitSha, mode: publishResult.mode };
}

// ---------------------------------------------------------------------------
// Shared prep step: ensure draft exists + auto-rebase main into draft
// ---------------------------------------------------------------------------

type EnsureAndRebaseArgs = {
  token: string;
  owner: string;
  repo: string;
  mainBranch: string;
  /** The editor's draft branch to ensure + rebase (ADR-011). */
  draftBranch: string;
  author: { name: string; email: string };
};

/**
 * Pre-flight for any draft-bound operation: make sure `draft` exists
 * (creating it off `mainBranch` if not), then auto-rebase `mainBranch`
 * into `draft` so we land on top of any direct-to-main pushes
 * (ADR-010 §7). Throws step-labelled PublishErrors so the caller can
 * see which step failed.
 *
 * Shared by `commitToDraft` and `publishDraftToMain` — the two flows
 * that need draft to be present and up-to-date before doing their
 * own thing (commit vs squash).
 */
async function ensureDraftAndRebase(args: EnsureAndRebaseArgs): Promise<void> {
  const { token, owner, repo, mainBranch, draftBranch, author } = args;

  try {
    await ensureBranchExists({
      token,
      owner,
      repo,
      branch: draftBranch,
      fromBranch: mainBranch,
    });
  } catch (cause) {
    throw new PublishError("github-failed", `ensure draft branch: ${String(cause)}`);
  }

  // The merge commit's author is the GitHub App (GitHub's `repos.merge`
  // endpoint doesn't accept an author field — committer is always the
  // authenticated principal). Mixed audit trail on draft is acceptable
  // since these commits get squashed away on Publish anyway.
  void author;
  try {
    const merge = await mergeBranchInto({
      token,
      owner,
      repo,
      from: mainBranch,
      into: draftBranch,
    });
    if (merge.kind === "conflict") {
      throw new PublishError(
        "github-failed",
        `auto-rebase: draft can't merge cleanly with ${mainBranch}. Discard pending changes or contact support.`,
      );
    }
  } catch (cause) {
    if (cause instanceof PublishError) throw cause;
    throw new PublishError("github-failed", `auto-rebase: ${String(cause)}`);
  }
}

// ---------------------------------------------------------------------------
// commitToDraft — shared ensure → auto-rebase → commit flow
// ---------------------------------------------------------------------------

export type CommitToDraftArgs = {
  token: string;
  owner: string;
  repo: string;
  /** The published branch — typically `main`. From `env.branch`. */
  mainBranch: string;
  /** Commit message (subject + optional body). `[skip ci]` is appended internally. */
  message: string;
  files: FileToCommit[];
  deletePaths?: string[];
  author: { name: string; email: string };
};

/**
 * Shared "stage a commit on the draft branch" dance, used by both
 * `saveToDraft` (content edits) and `commitUploadedImage` (binary
 * blobs). Centralises the ensure → auto-rebase → commit sequence so
 * the two callers can't drift apart on error handling, message
 * format, or step ordering.
 *
 * Returns the new draft commit's SHA. Caller decides whether to
 * follow up with `publishDraftToMain` (immediate-publish path) or
 * leave the commit pending (explicit-publish path).
 *
 * Errors are wrapped step-by-step so a failure tells you exactly
 * which step blew up.
 */
async function commitToDraft(args: CommitToDraftArgs): Promise<string> {
  const { token, owner, repo, mainBranch, message, files, deletePaths, author } = args;
  // Per-editor draft branch (ADR-011); resolves to the shared `draft`
  // for single-editor sites. Shared by saveToDraft + image commits.
  const draftBranch = resolveDraftBranch(author.email);

  await ensureDraftAndRebase({ token, owner, repo, mainBranch, draftBranch, author });

  try {
    return await commitFiles({
      token,
      owner,
      repo,
      branch: draftBranch,
      message: `${message}\n\n[skip ci]`,
      files,
      deletePaths,
      author,
    });
  } catch (cause) {
    // The retry-on-stale-ref loop inside `commitFiles` exhausted; map
    // to the distinct `concurrent-edit` code so the editor can show
    // a "someone else just saved" UX instead of a generic GitHub
    // failure. Carries the underlying message so logs keep the
    // forensic detail (last attempted parent SHA, attempt count).
    //
    // Asymmetry: the concurrent-edit path doesn't prepend a
    // "commit to draft:" step label like the generic path does. The
    // ConcurrentEditError message already names the ref (`heads/draft:
    // 3 attempts exhausted...`), so the step is implicit; a prefix
    // would read as "commit to draft: Concurrent edit on heads/draft"
    // which duplicates the ref.
    if (cause instanceof ConcurrentEditError) {
      throw new PublishError("concurrent-edit", cause.message);
    }
    throw new PublishError("github-failed", `commit to draft: ${String(cause)}`);
  }
}

// Re-export the helper for commit-image.ts. Not part of the public
// publish.ts surface (the helper is module-internal in spirit), but
// commit-image.ts is in the same package and shares this dance.
export { commitToDraft as _commitToDraft };

// ---------------------------------------------------------------------------
// saveToDraft — write to draft only, no squash, no deploy
// ---------------------------------------------------------------------------

/**
 * Persist the artist's pending changes to the `draft` branch. Does
 * NOT publish to `main` — the deploy doesn't fire. Use this for every
 * mid-edit save; the explicit Publish flow promotes draft → main
 * separately.
 *
 * Returns the new draft commit's SHA. The caller doesn't normally need
 * to poll a deploy for this — no deploy fires.
 *
 * Dev fallback: writes to local disk like `saveAndPublish()` does (no
 * branches in dev). The mode/commitSha pair stays the same shape.
 */
export async function saveToDraft(args: PublishArgs): Promise<PublishResult> {
  if (args.targets.length === 0) {
    throw new PublishError("github-failed", "saveToDraft: no targets supplied");
  }
  const env = readEnv();
  if (!isPlatformConfigured(env)) {
    return writeLocal(args.targets);
  }

  const { writes, deletePaths } = planFiles(args.targets);
  const { token, owner, repo } = await fetchPublishToken(env);
  const publishId = randomUUID();
  const subject = args.commitSubject ?? summariseTargets(args.targets);
  const message = `${subject}\n\nStagecraft-Publish-Id: ${publishId}`;
  const author = { name: args.authorName ?? "Artist", email: args.authorEmail };

  const draftSha = await commitToDraft({
    token,
    owner,
    repo,
    mainBranch: env.branch,
    message,
    files: writes,
    deletePaths,
    author,
  });
  return { commitSha: draftSha, mode: "github" };
}

// ---------------------------------------------------------------------------
// publishDraftToMain — squash draft into main, deploy
// ---------------------------------------------------------------------------

export type PublishDraftToMainArgs = {
  authorEmail: string;
  authorName?: string;
  /** Optional override for the squash commit's subject. */
  commitSubject?: string;
};

export type PublishDraftToMainResult = PublishResult & {
  /** True when draft and main were already in sync (no commit created). */
  alreadyInSync: boolean;
  /**
   * Set when the publish shipped to `main` but reconciling the draft
   * afterwards didn't finish. The publish still succeeded; the editor
   * shows the matching note. Absent on a clean publish.
   */
  warning?: PublishWarning;
};

/**
 * Publish every pending change on `draft` to `main` in one squash
 * commit. The squash's tree comes from `draft`'s HEAD; its parent is
 * `main`'s current HEAD. After the commit lands on `main`, `main` is
 * merged back into `draft` (a clean merge: the trees match) so the
 * draft is a descendant of `main` again. As with `publishSelectedToMain`,
 * a failed reconcile doesn't fail the publish: it resolves with a
 * `warning`.
 *
 * Auto-rebase fires first (belt and suspenders alongside saveToDraft's
 * own rebase) so a `main` push between the artist's last save and
 * Publish doesn't get silently dropped.
 *
 * Returns the squash commit's SHA on `main` — the deploy trigger.
 * `alreadyInSync` is true when there was nothing pending (no-op);
 * callers can use it to skip deploy polling.
 *
 * Dev fallback: no-op. Files are already on disk; there's no draft
 * branch to promote.
 */
export async function publishDraftToMain(
  args: PublishDraftToMainArgs,
): Promise<PublishDraftToMainResult> {
  const env = readEnv();
  if (!isPlatformConfigured(env)) {
    // Nothing to do in dev — every save already wrote to disk.
    return { commitSha: null, mode: "local", alreadyInSync: true };
  }

  const { token, owner, repo } = await fetchPublishToken(env);
  const publishId = randomUUID();
  const subject = args.commitSubject ?? "Publish pending changes";
  const message = `${subject}\n\nStagecraft-Publish-Id: ${publishId}`;
  const author = { name: args.authorName ?? "Artist", email: args.authorEmail };
  const draftBranch = resolveDraftBranch(args.authorEmail);

  await ensureDraftAndRebase({ token, owner, repo, mainBranch: env.branch, draftBranch, author });

  let squash: { commitSha: string; alreadyInSync: boolean };
  try {
    squash = await squashBranchInto({
      token,
      owner,
      repo,
      fromBranch: draftBranch,
      toBranch: env.branch,
      message,
      author,
    });
  } catch (cause) {
    // `squashBranchInto`'s stale-ref retry on `main` exhausted — another
    // publish kept winning the race (ADR-012 "Concurrency").
    if (cause instanceof ConcurrentEditError) {
      throw new PublishError("concurrent-edit", cause.message);
    }
    throw new PublishError("github-failed", `squash draft → main: ${String(cause)}`);
  }
  const published = {
    commitSha: squash.commitSha,
    mode: "github" as const,
    alreadyInSync: squash.alreadyInSync,
  };
  if (squash.alreadyInSync) return published;

  const warning = await reconcileDraftAfterPublish({
    token,
    owner,
    repo,
    mainBranch: env.branch,
    draftBranch,
  });
  return warning ? { ...published, warning } : published;
}

/**
 * After a publish has moved `main`, merge `main` back into the draft so
 * the draft is a descendant of `main` again (ADR-010's invariant) and
 * the published paths stop showing as pending. The publish has already
 * shipped, so a failure is returned as a {@link PublishWarning}, never
 * thrown: `draft-resync-pending` for a transient failure (the next
 * save's auto-rebase heals it), `draft-resync-conflict` when the draft
 * can't merge the new `main`.
 */
async function reconcileDraftAfterPublish(args: {
  token: string;
  owner: string;
  repo: string;
  mainBranch: string;
  draftBranch: string;
}): Promise<PublishWarning | undefined> {
  const { token, owner, repo, mainBranch, draftBranch } = args;
  try {
    const merge = await mergeBranchInto({ token, owner, repo, from: mainBranch, into: draftBranch });
    if (merge.kind === "conflict") {
      console.warn(
        `[publish] reconcile after publish: ${draftBranch} can't merge cleanly with ${mainBranch}.`,
      );
      return "draft-resync-conflict";
    }
    return undefined;
  } catch (cause) {
    console.warn(
      `[publish] reconcile ${draftBranch} after publish failed; the next save's auto-rebase resyncs it: ${String(cause)}`,
    );
    return "draft-resync-pending";
  }
}

// ---------------------------------------------------------------------------
// publishSelectedToMain — publish a subset of pending changes (ADR-012)
// ---------------------------------------------------------------------------

export type PublishSelectedToMainArgs = {
  authorEmail: string;
  authorName?: string;
  /**
   * Pending paths to copy to `main` — the caller derives these from the
   * live diff (the added/modified items it selected, expanding image
   * variants and the new side of a rename).
   */
  copyPaths: string[];
  /**
   * Pending paths to delete from `main` (selected items removed on the
   * draft, plus the old side of a rename). Explicit, never inferred, so a
   * copy path that can't be resolved is never silently treated as a
   * deletion.
   */
  deletePaths?: string[];
  /** Optional override for the commit subject. */
  commitSubject?: string;
};

export type PublishSelectedToMainResult = PublishDraftToMainResult;

/**
 * Publish a SUBSET of the editor's pending changes (ADR-012). Builds one
 * commit on `main` containing only `paths` (copied from the editor's
 * draft branch) — which triggers the deploy — then merges `main` back
 * into the draft branch so the published paths converge and the
 * unselected changes stay pending. Contrast `publishDraftToMain`, which
 * squashes the whole draft.
 *
 * Leaves the draft a descendant of `main` (ADR-010's invariant holds);
 * the next pending-changes compare reports only the leftover items.
 *
 * Once the commit to `main` lands the publish has shipped, so a failed
 * reconcile does NOT throw: it resolves with a `warning`
 * (`draft-resync-pending` for a transient failure — the next save's
 * auto-rebase heals it; `draft-resync-conflict` when the draft can't
 * merge the new `main`).
 *
 * Dev fallback: no-op — files are already on disk.
 */
export async function publishSelectedToMain(
  args: PublishSelectedToMainArgs,
): Promise<PublishSelectedToMainResult> {
  const env = readEnv();
  if (!isPlatformConfigured(env)) {
    return { commitSha: null, mode: "local", alreadyInSync: true };
  }

  const copyPaths = [...new Set(args.copyPaths)];
  const deletePaths = [...new Set(args.deletePaths ?? [])];
  if (copyPaths.length === 0 && deletePaths.length === 0) {
    return { commitSha: null, mode: "github", alreadyInSync: true };
  }

  const { token, owner, repo } = await fetchPublishToken(env);
  const author = { name: args.authorName ?? "Artist", email: args.authorEmail };
  const draftBranch = resolveDraftBranch(args.authorEmail);

  // Pre-flight: ensure the draft branch exists and is rebased on main, so
  // the subset we copy from it sits on top of the latest main (ADR-010 §7).
  await ensureDraftAndRebase({ token, owner, repo, mainBranch: env.branch, draftBranch, author });

  const subject = args.commitSubject ?? "Publish selected changes";
  const message = `${subject}\n\nStagecraft-Publish-Id: ${randomUUID()}`;

  let result: Awaited<ReturnType<typeof commitSelectedPathsInto>>;
  try {
    result = await commitSelectedPathsInto({
      token,
      owner,
      repo,
      fromBranch: draftBranch,
      toBranch: env.branch,
      copyPaths,
      deletePaths,
      message,
      author,
    });
  } catch (cause) {
    if (cause instanceof ConcurrentEditError) {
      throw new PublishError("concurrent-edit", cause.message);
    }
    throw new PublishError("github-failed", `publish selected → main: ${String(cause)}`);
  }

  const published = {
    commitSha: result.commitSha,
    mode: "github" as const,
    alreadyInSync: result.alreadyInSync,
  };

  // Nothing shipped, so there's nothing to reconcile.
  if (result.alreadyInSync) return published;

  // Reconcile the draft: merge the new main back in. The published paths
  // are byte-identical on both branches (clean merge); the unselected
  // changes exist only on draft and remain pending.
  const warning = await reconcileDraftAfterPublish({
    token,
    owner,
    repo,
    mainBranch: env.branch,
    draftBranch,
  });
  return warning ? { ...published, warning } : published;
}

// ---------------------------------------------------------------------------
// discardDraft — reset draft back to main (ADR-010 §4)
// ---------------------------------------------------------------------------

export type DiscardDraftResult =
  | {
      mode: "github";
      /**
       * SHA `draft` was pointing at before the discard. `null` if
       * draft didn't exist yet (a fresh site that hit Discard before
       * any save).
       */
      discardedFromSha: string | null;
      /** SHA `draft` now points at (equal to `main`). */
      mainSha: string;
      /**
       * True when draft was already at main (nothing to discard).
       * Callers can surface this as "nothing pending" without
       * touching state.
       */
      alreadyInSync: boolean;
    }
  | { mode: "local" };

/**
 * Throw `draft` away and reset it to `main`'s current HEAD. Force-
 * pushes the ref; the previous draft commits become unreachable
 * (visible only via reflog before GitHub garbage-collects them).
 *
 * Per ADR-010 §4 this is the "I changed my mind, discard everything
 * I've saved since the last publish" affordance. Distinct from the
 * deletes that publish-time wipes out — `discardDraft` is the
 * artist's explicit undo, not a side effect.
 *
 * Dev fallback: no-op. Files are already on disk; there's no draft
 * branch concept to reset. Returns `{ mode: "local" }`.
 *
 * Note: the artist's local-disk state isn't touched in production
 * either — only the remote `draft` ref moves. The next admin read
 * from another container (or after a redeploy) will see `main`'s
 * state, since draft now equals main. Containers that have writes
 * cached in their own memory diverge until they cold-start; the
 * runtime-fetch + cache layer (PR 4 in the rollout) makes this
 * symmetric across containers.
 */
export async function discardDraft(args: {
  /**
   * Session-bound author email. Used to resolve which per-editor draft
   * branch to discard (ADR-011) — for single-editor sites this is the
   * shared `draft`. The GitHub App remains the committer regardless
   * (`updateRef` tracks the authenticated principal).
   */
  authorEmail: string;
}): Promise<DiscardDraftResult> {
  const draftBranch = resolveDraftBranch(args.authorEmail);

  const env = readEnv();
  if (!isPlatformConfigured(env)) {
    return { mode: "local" };
  }

  const { token, owner, repo } = await fetchPublishToken(env);

  let reset: Awaited<ReturnType<typeof resetBranchTo>>;
  try {
    reset = await resetBranchTo({
      token,
      owner,
      repo,
      branch: draftBranch,
      toBranch: env.branch,
    });
  } catch (cause) {
    throw new PublishError("github-failed", `discard draft: ${String(cause)}`);
  }
  return {
    mode: "github",
    discardedFromSha: reset.resetFromSha,
    mainSha: reset.toSha,
    alreadyInSync: reset.alreadyInSync,
  };
}
