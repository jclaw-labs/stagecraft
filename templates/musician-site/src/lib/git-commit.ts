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
 * Commit one or more files in a single commit using GitHub's Git Data API.
 * Pure function over the Octokit interface — no side effects beyond the API
 * calls. Returns the new commit SHA.
 *
 * The flow: get HEAD ref → get tree → create blobs → create tree →
 * create commit → update ref. See ADR-007 §5 and ADR-008.
 *
 * `deletePaths` items are added as tree entries with `sha: null`, which the
 * GitHub API treats as "remove from tree" relative to `base_tree`.
 */
export async function commitFiles(args: CommitArgs): Promise<string> {
  const octokit = new Octokit({ auth: args.token });
  const { owner, repo, branch } = args;

  const ref = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const headSha = ref.data.object.sha;

  const headCommit = await octokit.git.getCommit({ owner, repo, commit_sha: headSha });
  const baseTreeSha = headCommit.data.tree.sha;

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

  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  });

  return commit.data.sha;
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
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: base.data.object.sha,
  });
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

  // Update the destination first — that's the one the public site
  // builds from. If the draft FF fails afterwards, the destination
  // is still correct (just at a SHA that draft doesn't yet match,
  // which the next save's `ensureBranchExists` + commit will
  // observe and reconcile).
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${toBranch}`,
    sha: squash.data.sha,
  });
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${fromBranch}`,
    sha: squash.data.sha,
  });

  return { commitSha: squash.data.sha, alreadyInSync: false };
}

function isNotFound(cause: unknown): boolean {
  return cause instanceof RequestError && cause.status === 404;
}
