import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

export type FileToCommit = {
  /** Path relative to the repo root, e.g. "src/content/pages/home.json". */
  path: string;
  /** Content as a UTF-8 string, or as a base64-encoded string for binaries. */
  content: string;
  /**
   * Encoding of `content`. Defaults to "utf-8" for text. Set "base64" when
   * committing binary files (e.g. images), and pass `content` as the
   * base64-encoded payload (e.g. `buffer.toString("base64")`).
   */
  encoding?: "utf-8" | "base64";
};

export type CommitArgs = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  /** Commit message subject + optional body. */
  message: string;
  files: FileToCommit[];
  /**
   * Paths to delete in the same commit (relative to repo root). Useful for
   * page deletion. Combined with `files` so a single publish can rename
   * (write new + delete old) atomically.
   */
  deletePaths?: string[];
  /** Author appears in `git log`. Defaults to a generic author if omitted. */
  author?: { name: string; email: string };
};

/**
 * Thrown by `commitFiles` when every retry attempt was beaten to the
 * branch by another caller — i.e. `updateRef` returned the
 * stale-ref 422 even after re-fetching head and rebuilding the tree.
 *
 * Per ADR-010 §6: two concurrent saves can each refresh `draft.sha`,
 * build commits in parallel, and update-ref in some order; the loser
 * sees 422. We retry on the loser's side; if it keeps losing, the
 * caller (`publish.ts`) maps this to a user-facing "someone else just
 * saved" message.
 *
 * `lastAttemptedParentSha` is the head SHA the final attempt was
 * parented on — useful for log forensics. `cause` is the underlying
 * `RequestError`.
 */
export class ConcurrentEditError extends Error {
  constructor(
    public readonly ref: string,
    public readonly attempts: number,
    public readonly lastAttemptedParentSha: string,
    public readonly cause: unknown,
  ) {
    super(
      `Concurrent edit on ${ref}: ${attempts} attempts exhausted. ` +
        `Last attempted parent SHA was ${lastAttemptedParentSha}; ` +
        `the ref was updated by another caller before each updateRef.`,
    );
    this.name = "ConcurrentEditError";
  }
}

/** How many tree-rebuild-and-updateRef cycles `commitFiles` tries before giving up. */
const MAX_COMMIT_ATTEMPTS = 3;

/**
 * Discriminates the stale-ref 422 from other 422 shapes GitHub returns
 * on `updateRef`. The retry case is "the ref moved under us": message
 * is some flavour of "Update is not a fast-forward" or "Reference is
 * not at expected value". Other 422s (e.g. "Reference does not exist"
 * when the branch was deleted) shouldn't retry — they need a higher-
 * level recovery.
 */
function isStaleRefError(cause: unknown): cause is RequestError {
  if (!(cause instanceof RequestError) || cause.status !== 422) return false;
  const message = cause.message ?? "";
  return /not a fast.?forward|not at expected value/i.test(message);
}

/**
 * Commit one or more files in a single commit using GitHub's Git Data API.
 * Pure function over the Octokit interface — no side effects beyond the API
 * calls. Returns the new commit SHA.
 *
 * The flow: get HEAD ref → get tree → create blobs → create tree →
 * create commit → update ref. See ADR-007 §5 and ADR-008.
 *
 * `deletePaths` items are added as tree entries with `sha: null`, which the
 * GitHub API treats as "remove from tree" relative to `base_tree`.
 *
 * Concurrent-edit handling (ADR-010 §6): if `updateRef` returns the
 * stale-ref 422 (another caller updated `branch` between our
 * `getRef` and our `updateRef`), we re-fetch HEAD, rebuild the tree
 * off the new base, and try again — up to {@link MAX_COMMIT_ATTEMPTS}
 * times. Blob creation lives outside the retry because blobs are
 * content-addressed: the SHAs we computed on the first pass remain
 * valid across retries. After exhausting attempts we throw
 * {@link ConcurrentEditError} so callers can map it to a user-facing
 * message.
 */
export async function commitFiles(args: CommitArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.token });
  const { owner, repo, branch } = args;

  // Blobs are content-addressed and idempotent — hoisted out of the
  // retry loop so a stale-ref retry doesn't re-upload identical
  // content.
  const blobs = await Promise.all(
    args.files.map(async (file) => {
      const blob = await octokit.git.createBlob({
        owner,
        repo,
        content: file.content,
        encoding: file.encoding ?? "utf-8",
      });
      return { path: file.path, sha: blob.data.sha };
    }),
  );

  // GitHub's TS types model the tree entry's `sha` as `string`, but the
  // REST API also accepts `null` to delete. Force-cast at the array level
  // so we can construct a heterogeneous tree without losing the rest of
  // the type-checking.
  type TreeEntry = {
    path: string;
    mode: "100644";
    type: "blob";
    sha: string | null;
  };
  const tree: TreeEntry[] = [
    ...blobs.map((b) => ({ path: b.path, mode: "100644" as const, type: "blob" as const, sha: b.sha })),
    ...(args.deletePaths ?? []).map((p) => ({
      path: p,
      mode: "100644" as const,
      type: "blob" as const,
      sha: null,
    })),
  ];

  // Initialised to "" only to satisfy TypeScript's flow analysis
  // across the loop / catch boundary — `lastParentSha` is always
  // reassigned to `headSha` below before any path that reads it
  // (the `ConcurrentEditError` throw lives after the assignment in
  // the same iteration).
  //
  // No backoff between attempts is intentional. The realistic
  // concurrent-save rate is "two browser tabs," not a thundering
  // herd; adding a sleep would just slow every save without changing
  // collision behaviour. Revisit if telemetry shows actual herd
  // patterns.
  let lastParentSha = "";
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
    const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const headSha = ref.data.object.sha;
    lastParentSha = headSha;

    const headCommit = await octokit.git.getCommit({ owner, repo, commit_sha: headSha });
    const baseTreeSha = headCommit.data.tree.sha;

    // Octokit's TS type for `tree` doesn't model `sha: null` as a deletion,
    // but the REST endpoint accepts it. Cast to bypass the typed property
    // check; runtime behaviour is what we're asserting in git-commit.test.ts.
    const createdTree = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree,
    } as unknown as Parameters<typeof octokit.git.createTree>[0]);

    const commit = await octokit.git.createCommit({
      owner,
      repo,
      message: args.message,
      tree: createdTree.data.sha,
      parents: [headSha],
      author: args.author,
    });

    try {
      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commit.data.sha,
      });
      return commit.data.sha;
    } catch (cause) {
      if (!isStaleRefError(cause)) throw cause;
      if (attempt === MAX_COMMIT_ATTEMPTS) {
        throw new ConcurrentEditError(
          `heads/${branch}`,
          MAX_COMMIT_ATTEMPTS,
          lastParentSha,
          cause,
        );
      }
      // Else: fall through, loop body re-fetches HEAD and rebuilds.
    }
  }

  // Unreachable: the loop body either returns on success or throws on
  // exhaustion. The throw here exists so TypeScript can prove the
  // function returns `string`.
  throw new Error("commitFiles: retry loop exited without returning or throwing");
}

// ---------------------------------------------------------------------------
// Branch management helpers used by ADR-010's two-branch publish model
// ---------------------------------------------------------------------------

export type EnsureBranchExistsArgs = {
  token: string;
  owner: string;
  repo: string;
  /** The branch we want to guarantee exists, e.g. "draft". */
  branch: string;
  /** Where to base the new branch off of when it doesn't exist yet. */
  fromBranch: string;
};

/**
 * Make sure `branch` exists on the artist's repo, creating it from
 * `fromBranch`'s current HEAD if not. Idempotent — call before any
 * commit that targets `branch`.
 *
 * The 404 path is the only "doesn't exist" signal GitHub returns for
 * a missing ref. Other errors bubble; the caller wraps them as
 * PublishError at the publish.ts boundary.
 */
export async function ensureBranchExists(args: EnsureBranchExistsArgs): Promise<void> {
  const octokit = new Octokit({ auth: args.token });
  const { owner, repo, branch, fromBranch } = args;
  try {
    await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
    return;
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
  }
  const base = await octokit.git.getRef({ owner, repo, ref: `heads/${fromBranch}` });
  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: base.data.object.sha,
    });
  } catch (cause) {
    // Race: another process (a parallel save in another tab, the
    // broker's bootstrap, etc.) created the branch between our 404
    // and our createRef. GitHub returns 422 "Reference already
    // exists". Idempotent: the branch is there, our work is done.
    if (cause instanceof RequestError && cause.status === 422) return;
    throw cause;
  }
}

export type SquashBranchIntoArgs = {
  token: string;
  owner: string;
  repo: string;
  /** Source branch — `draft`. Its tree becomes the squash commit's tree. */
  fromBranch: string;
  /** Target branch — `main`. Receives the new squash commit on top of HEAD. */
  toBranch: string;
  /** Commit message subject (+ optional body). */
  message: string;
  author?: { name: string; email: string };
};

export type SquashBranchIntoResult = {
  /** SHA of the new squash commit on `toBranch`. */
  commitSha: string;
  /**
   * `true` when nothing was published because the branches already
   * matched. `commitSha` is `toBranch`'s existing HEAD in that case.
   */
  alreadyInSync: boolean;
};

/**
 * Squash `fromBranch` into `toBranch`: create a new commit on
 * `toBranch` whose parent is `toBranch`'s current HEAD and whose
 * tree comes from `fromBranch`'s current HEAD. Then fast-forward
 * `fromBranch` to point at the new commit (so the invariant
 * `fromBranch === toBranch OR fromBranch is ahead of toBranch`
 * holds again).
 *
 * Per ADR-010 §3 — this is the Publish flow. The per-save commits
 * on `fromBranch` between the previous and new `toBranch` HEAD
 * become unreachable from any active ref (visible only via reflog
 * before GitHub garbage-collects them).
 *
 * No-op when the two branches already point at the same SHA;
 * returns `alreadyInSync: true` so the caller can skip downstream
 * work (no deploy to wait for).
 */
export async function squashBranchInto(
  args: SquashBranchIntoArgs,
): Promise<SquashBranchIntoResult> {
  const octokit = new Octokit({ auth: args.token });
  const { owner, repo, fromBranch, toBranch } = args;

  const [fromRef, toRef] = await Promise.all([
    octokit.git.getRef({ owner, repo, ref: `heads/${fromBranch}` }),
    octokit.git.getRef({ owner, repo, ref: `heads/${toBranch}` }),
  ]);
  const fromSha = fromRef.data.object.sha;
  const toSha = toRef.data.object.sha;

  if (fromSha === toSha) {
    return { commitSha: toSha, alreadyInSync: true };
  }

  // Take the tree pointer off the source-branch's HEAD commit. We're
  // not building a new tree from blobs — we're reusing what `draft`
  // already committed.
  const fromCommit = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: fromSha,
  });

  const squash = await octokit.git.createCommit({
    owner,
    repo,
    message: args.message,
    tree: fromCommit.data.tree.sha,
    parents: [toSha],
    author: args.author,
  });

  // Update the source ref first — that preserves ADR-010's invariant
  // (`fromBranch === toBranch OR fromBranch is ahead of toBranch`) on
  // partial failure. If we updated `toBranch` first and then the
  // `fromBranch` FF failed, `fromBranch` would be BEHIND `toBranch`,
  // and the next save's commit would be parented on stale draft
  // state — silently dropping `toBranch`'s recent content on the
  // next squash. Doing it this way leaves `fromBranch` ahead of
  // `toBranch` on partial failure, which the next call self-heals.
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${fromBranch}`,
    sha: squash.data.sha,
  });
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${toBranch}`,
    sha: squash.data.sha,
  });

  return { commitSha: squash.data.sha, alreadyInSync: false };
}

function isNotFound(cause: unknown): boolean {
  return cause instanceof RequestError && cause.status === 404;
}

// ---------------------------------------------------------------------------
// Auto-rebase (ADR-010 §7)
// ---------------------------------------------------------------------------

export type MergeBranchIntoArgs = {
  token: string;
  owner: string;
  repo: string;
  /** Source branch — typically `main`. Its commits get merged into `into`. */
  from: string;
  /** Target branch — typically `draft`. Receives the merge commit. */
  into: string;
  /** Commit message for the merge commit, if one is created. */
  commitMessage?: string;
};

export type MergeBranchIntoResult =
  | { kind: "already-included"; reason: "ancestor" | "noop" }
  | { kind: "merged"; mergeCommitSha: string }
  | { kind: "conflict" };

/**
 * Bring `into` up to date with `from` by creating a merge commit on
 * `into`. ADR-010 §7 "Main moves outside of publish" — fires before
 * every save and every publish so `draft` never falls behind `main`,
 * even when a developer pushes directly to `main`.
 *
 * Outcomes:
 *   - `from`'s HEAD is already an ancestor of `into` → no-op
 *     (`ancestor`), no merge commit created.
 *   - GitHub's merge succeeds cleanly → returns the new merge commit
 *     SHA (`merged`).
 *   - Files conflict between the two branches → returns `conflict`.
 *     Caller surfaces this as a structured error to the artist; the
 *     resolution path is "discard the draft and re-author" (or
 *     contact support).
 *
 * Uses GitHub's `repos.merge` endpoint — atomic at the GitHub side,
 * one API call, returns 201 / 204 / 409 / 404. 204 is "already
 * merged" (the more common signal that there's nothing to do). 409
 * is the conflict signal.
 */
export async function mergeBranchInto(
  args: MergeBranchIntoArgs,
): Promise<MergeBranchIntoResult> {
  const octokit = new Octokit({ auth: args.token });
  try {
    const response = await octokit.repos.merge({
      owner: args.owner,
      repo: args.repo,
      base: args.into,
      head: args.from,
      commit_message:
        args.commitMessage ??
        `Merge ${args.from} into ${args.into} [skip ci]`,
    });
    // 201 → new merge commit created. 204 → nothing to merge (head is
    // already reachable from base). Octokit normalises the response;
    // status comes from `response.status`.
    if (response.status === 201) {
      return { kind: "merged", mergeCommitSha: response.data.sha };
    }
    // Defensive: anything other than 201 in the success path is the
    // "no-op" case in practice. Octokit may surface 204 with no body.
    return { kind: "already-included", reason: "noop" };
  } catch (cause) {
    if (cause instanceof RequestError) {
      // 409 → merge conflict. Surface as a structured outcome so
      // the caller can wrap it as a user-facing "your draft can't
      // merge with main's recent changes" error rather than a 500.
      if (cause.status === 409) {
        return { kind: "conflict" };
      }
      // 204 sometimes surfaces as a RequestError on Octokit's typing;
      // treat it the same as the success no-op.
      if (cause.status === 204) {
        return { kind: "already-included", reason: "ancestor" };
      }
    }
    throw cause;
  }
}

// ---------------------------------------------------------------------------
// Discard a branch back to another branch's HEAD (ADR-010 §4)
// ---------------------------------------------------------------------------

export type ResetBranchToArgs = {
  token: string;
  owner: string;
  repo: string;
  /** The branch being reset (usually `draft`). */
  branch: string;
  /** The branch whose HEAD `branch` should point at (usually `main`). */
  toBranch: string;
};

export type ResetBranchToResult = {
  /**
   * SHA `branch` was pointing at before the reset. `null` if `branch`
   * didn't exist (fresh site).
   */
  resetFromSha: string | null;
  /** SHA `branch` now points at (equal to `toBranch`'s current HEAD). */
  toSha: string;
  /** True when `branch` already equalled `toBranch` (no-op). */
  alreadyInSync: boolean;
};

/**
 * Force-reset `branch` to point at `toBranch`'s current HEAD. Used by
 * ADR-010 §4's discard flow — `draft` gets wiped back to `main`.
 *
 * The previous `branch` commits become unreachable from any active
 * ref (visible only via GitHub's reflog for a short retention window).
 * Idempotent: a missing `branch` is treated as "nothing to reset"
 * and reported as `alreadyInSync: true` rather than an error.
 *
 * Force-push is required because the new SHA generally isn't a
 * descendant of `branch`'s current HEAD — GitHub rejects non-FF ref
 * updates by default.
 */
export async function resetBranchTo(
  args: ResetBranchToArgs,
): Promise<ResetBranchToResult> {
  const octokit = new Octokit({ auth: args.token });
  const { owner, repo, branch, toBranch } = args;

  const toRef = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${toBranch}`,
  });
  const toSha = toRef.data.object.sha;

  let resetFromSha: string | null = null;
  try {
    const fromRef = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    resetFromSha = fromRef.data.object.sha;
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
    // Branch doesn't exist — nothing to reset.
    return { resetFromSha: null, toSha, alreadyInSync: true };
  }

  if (resetFromSha === toSha) {
    return { resetFromSha, toSha, alreadyInSync: true };
  }

  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: toSha,
    force: true,
  });

  return { resetFromSha, toSha, alreadyInSync: false };
}

// ---------------------------------------------------------------------------
// commitSelectedPathsInto — publish a subset of one branch's paths onto
// another (ADR-012, per-item Publish)
// ---------------------------------------------------------------------------

export type CommitSelectedPathsIntoArgs = {
  token: string;
  owner: string;
  repo: string;
  /** Source branch to copy blob content from (the editor's draft). */
  fromBranch: string;
  /** Target branch to commit onto (the published branch, `main`). */
  toBranch: string;
  /**
   * Paths to copy from `fromBranch` into `toBranch`, by reference to
   * their existing blob SHAs (binary-safe, no re-upload + mode-faithful).
   * Each MUST resolve to a blob on `fromBranch` — if one doesn't, the
   * call throws rather than silently dropping it (a missing copy path
   * must never be reinterpreted as a deletion).
   */
  copyPaths: string[];
  /**
   * Paths to delete from `toBranch` (they were removed on `fromBranch`).
   * Explicit, never inferred — so a copy path that fails to resolve can't
   * masquerade as a deletion. Renames pass the new path in `copyPaths`
   * and the old path here.
   */
  deletePaths: string[];
  message: string;
  author: { name: string; email: string };
};

export type CommitSelectedPathsIntoResult = {
  /** SHA of the new commit on `toBranch` (or its unchanged HEAD on a no-op). */
  commitSha: string;
  /**
   * True when there was nothing to publish — no paths supplied, or the
   * resulting tree was byte-identical to `toBranch` (so no commit was
   * created and no deploy is triggered).
   */
  alreadyInSync: boolean;
};

/**
 * Build one commit on `toBranch` whose tree is `toBranch`'s tree with
 * only `paths` overlaid from `fromBranch` (added/modified by blob-SHA
 * reference, removed via `sha: null`). The source blob SHAs are resolved
 * once up front (the source branch isn't what we race on); the
 * `updateRef toBranch` uses the same stale-ref retry as `commitFiles`,
 * so a concurrent publish to `toBranch` rebuilds on the new HEAD.
 *
 * Pure over the Octokit interface — no `[skip ci]`, since this commit is
 * a publish (it should trigger the deploy).
 */
export async function commitSelectedPathsInto(
  args: CommitSelectedPathsIntoArgs,
): Promise<CommitSelectedPathsIntoResult> {
  const octokit = new Octokit({ auth: args.token });
  const { owner, repo, fromBranch, toBranch, copyPaths, deletePaths, message, author } = args;

  if (copyPaths.length === 0 && deletePaths.length === 0) {
    const toRef = await octokit.git.getRef({ owner, repo, ref: `heads/${toBranch}` });
    return { commitSha: toRef.data.object.sha, alreadyInSync: true };
  }

  type TreeEntry = { path: string; mode: string; type: "blob"; sha: string | null };
  const deleteEntries: TreeEntry[] = deletePaths.map((path) => ({
    path,
    mode: "100644",
    type: "blob",
    sha: null,
  }));

  // Resolve the source branch's blob SHAs (+ modes) for the copy paths.
  // Hoisted out of the retry loop — we only race on the target ref.
  let copyEntries: TreeEntry[] = [];
  if (copyPaths.length > 0) {
    const fromRef = await octokit.git.getRef({ owner, repo, ref: `heads/${fromBranch}` });
    const fromCommit = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: fromRef.data.object.sha,
    });
    const fromTree = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: fromCommit.data.tree.sha,
      recursive: "true",
    });
    // Fail safe on a truncated tree: an incomplete listing would make a
    // present path look missing, and "missing copy path" must never be
    // silently turned into a deletion (data loss).
    if (fromTree.data.truncated) {
      throw new Error(
        `commitSelectedPathsInto: ${fromBranch}'s tree is too large to list in one request (truncated); cannot resolve copy paths safely.`,
      );
    }
    const blobByPath = new Map<string, { sha: string; mode: string }>();
    for (const entry of fromTree.data.tree) {
      if (entry.type === "blob" && entry.path && entry.sha) {
        blobByPath.set(entry.path, { sha: entry.sha, mode: entry.mode ?? "100644" });
      }
    }
    const missing = copyPaths.filter((p) => !blobByPath.has(p));
    if (missing.length > 0) {
      throw new Error(
        `commitSelectedPathsInto: copy paths not found as files on ${fromBranch}: ${missing.join(", ")}`,
      );
    }
    copyEntries = copyPaths.map((path) => {
      const blob = blobByPath.get(path)!;
      // Mode-faithful (preserve executable/symlink modes from the source).
      return { path, mode: blob.mode, type: "blob", sha: blob.sha };
    });
  }

  const tree: TreeEntry[] = [...copyEntries, ...deleteEntries];

  let lastParentSha = "";
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
    const toRef = await octokit.git.getRef({ owner, repo, ref: `heads/${toBranch}` });
    const toSha = toRef.data.object.sha;
    lastParentSha = toSha;

    const toCommit = await octokit.git.getCommit({ owner, repo, commit_sha: toSha });

    const createdTree = await octokit.git.createTree({
      owner,
      repo,
      base_tree: toCommit.data.tree.sha,
      tree,
    } as unknown as Parameters<typeof octokit.git.createTree>[0]);

    // No-op guard: if the overlay didn't change the target's tree (every
    // selected path already matched), don't create an empty commit — it
    // would trigger a pointless deploy. Mirrors squashBranchInto's
    // fromSha===toSha short-circuit.
    if (createdTree.data.sha === toCommit.data.tree.sha) {
      return { commitSha: toSha, alreadyInSync: true };
    }

    const commit = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: createdTree.data.sha,
      parents: [toSha],
      author,
    });

    try {
      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${toBranch}`,
        sha: commit.data.sha,
      });
      return { commitSha: commit.data.sha, alreadyInSync: false };
    } catch (cause) {
      if (!isStaleRefError(cause)) throw cause;
      if (attempt === MAX_COMMIT_ATTEMPTS) {
        throw new ConcurrentEditError(
          `heads/${toBranch}`,
          MAX_COMMIT_ATTEMPTS,
          lastParentSha,
          cause,
        );
      }
      // Else: re-fetch toBranch HEAD and rebuild on the new base.
    }
  }

  throw new Error("commitSelectedPathsInto: retry loop exited without returning or throwing");
}
