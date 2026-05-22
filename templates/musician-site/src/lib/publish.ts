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
  type ReadStore,
} from "./collections";
import {
  localPathForRepoPath,
  stringifyContent,
  unlinkIfExists,
  writeText,
} from "./fs-helpers";
import {
  commitFiles,
  ConcurrentEditError,
  ensureBranchExists,
  mergeBranchInto,
  resetBranchTo,
  squashBranchInto,
  type FileToCommit,
} from "./git-commit";
import { publishTokenResponseSchema } from "./publish-types";

/**
 * Persistent companion branch for ADR-010's two-branch publish model.
 * Always at or ahead of `main`; admin commits land here; the squash
 * step on Publish merges it into `main` and FF's it back to match.
 */
export const DRAFT_BRANCH = "draft";

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

export async function fetchPublishToken(env: Env): Promise<{
  token: string;
  owner: string;
  repo: string;
}> {
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
  return {
    token: parsed.data.token,
    owner: parsed.data.repo.owner,
    repo: parsed.data.repo.name,
  };
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
 * Save + immediate publish (PR 1 of ADR-010's rollout). Kept as a
 * back-compat shim for callers that haven't yet been migrated to
 * separate Save and Publish flows. Internally: `saveToDraft` followed
 * by `publishDraftToMain`. Both flows are independently exported so
 * new callers can compose them directly.
 *
 * Returns the squash commit's SHA on `main` (the deploy trigger) —
 * preserves the v1 contract.
 */
export async function publish(args: PublishArgs): Promise<PublishResult> {
  if (args.targets.length === 0) {
    throw new PublishError("github-failed", "publish: no targets supplied");
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
  // return so back-compat callers see exactly the v1 PublishResult
  // shape. The publishDraftToMain result type is widened
  // (PublishResult & { alreadyInSync }); narrowing here keeps the
  // type contract honest.
  const publishResult = await publishDraftToMain({
    authorEmail: args.authorEmail,
    authorName: args.authorName,
    commitSubject: args.commitSubject,
  });
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
  const { token, owner, repo, mainBranch, author } = args;

  try {
    await ensureBranchExists({
      token,
      owner,
      repo,
      branch: DRAFT_BRANCH,
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
      into: DRAFT_BRANCH,
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

  await ensureDraftAndRebase({ token, owner, repo, mainBranch, author });

  try {
    return await commitFiles({
      token,
      owner,
      repo,
      branch: DRAFT_BRANCH,
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
 * Dev fallback: writes to local disk like `publish()` does (no
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
};

/**
 * Publish every pending change on `draft` to `main` in one squash
 * commit. The squash's tree comes from `draft`'s HEAD; its parent is
 * `main`'s current HEAD. After the commit lands on `main`, `draft` is
 * fast-forwarded to match.
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

  await ensureDraftAndRebase({ token, owner, repo, mainBranch: env.branch, author });

  let squash: { commitSha: string; alreadyInSync: boolean };
  try {
    squash = await squashBranchInto({
      token,
      owner,
      repo,
      fromBranch: DRAFT_BRANCH,
      toBranch: env.branch,
      message,
      author,
    });
  } catch (cause) {
    throw new PublishError("github-failed", `squash draft → main: ${String(cause)}`);
  }
  return {
    commitSha: squash.commitSha,
    mode: "github",
    alreadyInSync: squash.alreadyInSync,
  };
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
   * Session-bound author email. Currently unused — GitHub's `repos.merge`
   * + `updateRef` track the GitHub App as the committer regardless of
   * what we pass. Kept on the signature so callers thread session
   * context uniformly, and so a future audit log (or a per-discard
   * commit message) can pick it up without an API change.
   */
  authorEmail: string;
}): Promise<DiscardDraftResult> {
  void args.authorEmail;

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
      branch: DRAFT_BRANCH,
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

/**
 * Convenience for the Puck editor's onPublish handler: write a page
 * locally via the wrapper layer (so the editor sees fresh values on
 * the next read) and then push a `collection-item` commit through the
 * broker / GitHub. Local writes happen before the commit so a publish
 * failure leaves the artist with a saved-but-undeployed page rather
 * than nothing.
 *
 * Splitting "local write" from "commit" matches the existing
 * `/api/publish` semantics: a `publishWarning` in the response means
 * the local write succeeded but the commit didn't.
 */
export async function publishPage(args: {
  pageSlug: string;
  /** Legacy PuckData shape: `{ content, root: { props: {...} } }`. */
  data: unknown;
  authorEmail: string;
  authorName?: string;
  /**
   * Read store used by `writePage` to look up the existing item's
   * id / createdAt / showInNav and preserve them across the update.
   * Admin callers pass a draft-backed store so the lookup sees the
   * artist's live state across containers; the FS-only re-read
   * below stays direct because the post-write item exists only on
   * local disk until `saveToDraft` commits it.
   */
  store: ReadStore;
}): Promise<PublishResult> {
  const { writePage } = await import("./content");
  await writePage(args.pageSlug, args.data as Parameters<typeof writePage>[1], args.store);
  const { readItem } = await import("./collections/store");
  const { pagesCollectionDef } = await import("./collections/seeds");
  const item = await readItem("pages", args.pageSlug, pagesCollectionDef);
  if (!item) {
    throw new PublishError("github-failed", `Page ${args.pageSlug} disappeared after write`);
  }
  return saveToDraft({
    targets: [
      {
        kind: "collection-item",
        collectionSlug: "pages",
        itemSlug: args.pageSlug,
        data: { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, values: item.values },
      },
    ],
    authorEmail: args.authorEmail,
    authorName: args.authorName,
    commitSubject: `Update ${args.pageSlug}`,
  });
}
