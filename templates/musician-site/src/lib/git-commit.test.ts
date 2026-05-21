import { describe, expect, it, vi, beforeEach } from "vitest";
import { RequestError } from "@octokit/request-error";

const getRef = vi.fn();
const getCommit = vi.fn();
const createBlob = vi.fn();
const createTree = vi.fn();
const createCommit = vi.fn();
const createRef = vi.fn();
const updateRef = vi.fn();
const reposMerge = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    git = { getRef, getCommit, createBlob, createTree, createCommit, createRef, updateRef };
    repos = { merge: reposMerge };
  },
}));

import {
  commitFiles,
  ConcurrentEditError,
  ensureBranchExists,
  mergeBranchInto,
  resetBranchTo,
  squashBranchInto,
} from "./git-commit";

beforeEach(() => {
  getRef.mockReset();
  getCommit.mockReset();
  createBlob.mockReset();
  createTree.mockReset();
  createCommit.mockReset();
  createRef.mockReset();
  updateRef.mockReset();
  reposMerge.mockReset();
});

function setupHappyPath() {
  getRef.mockResolvedValue({ data: { object: { sha: "head-sha" } } });
  getCommit.mockResolvedValue({ data: { tree: { sha: "tree-sha" } } });
  createBlob.mockImplementation(({ content }) =>
    Promise.resolve({ data: { sha: `blob-${content.slice(0, 8)}` } }),
  );
  createTree.mockResolvedValue({ data: { sha: "new-tree-sha" } });
  createCommit.mockResolvedValue({ data: { sha: "new-commit-sha" } });
  updateRef.mockResolvedValue({ data: {} });
}

describe("commitFiles", () => {
  it("returns the new commit SHA on success", async () => {
    setupHappyPath();
    const sha = await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      message: "msg",
      files: [{ path: "a.txt", content: "hello" }],
    });
    expect(sha).toBe("new-commit-sha");
  });

  it("creates one blob per file", async () => {
    setupHappyPath();
    await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      message: "msg",
      files: [
        { path: "a.txt", content: "alpha" },
        { path: "b.txt", content: "beta" },
        { path: "c.txt", content: "gamma" },
      ],
    });
    expect(createBlob).toHaveBeenCalledTimes(3);
  });

  it("uses base_tree from HEAD's commit, not from arbitrary tree fetch", async () => {
    setupHappyPath();
    await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      message: "msg",
      files: [{ path: "a.txt", content: "x" }],
    });
    expect(createTree).toHaveBeenCalledWith(
      expect.objectContaining({ base_tree: "tree-sha" }),
    );
  });

  it("propagates author when provided", async () => {
    setupHappyPath();
    await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      message: "msg",
      files: [{ path: "a.txt", content: "x" }],
      author: { name: "Artist", email: "artist@example.com" },
    });
    expect(createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ author: { name: "Artist", email: "artist@example.com" } }),
    );
  });

  it("updates the ref with the new commit SHA", async () => {
    setupHappyPath();
    await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      message: "msg",
      files: [{ path: "a.txt", content: "x" }],
    });
    expect(updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "heads/main", sha: "new-commit-sha" }),
    );
  });

  it("defaults to utf-8 encoding when not specified", async () => {
    setupHappyPath();
    await commitFiles({
      token: "t", owner: "o", repo: "r", branch: "main", message: "msg",
      files: [{ path: "a.txt", content: "hello" }],
    });
    expect(createBlob).toHaveBeenCalledWith(
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("forwards base64 encoding when committing binary files", async () => {
    setupHappyPath();
    await commitFiles({
      token: "t", owner: "o", repo: "r", branch: "main", message: "msg",
      files: [
        { path: "img.webp", content: "AAAA", encoding: "base64" },
        { path: "page.json", content: "{}", encoding: "utf-8" },
      ],
    });
    expect(createBlob).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ encoding: "base64", content: "AAAA" }),
    );
    expect(createBlob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ encoding: "utf-8", content: "{}" }),
    );
  });

  it("includes delete tree entries (sha: null) for deletePaths", async () => {
    setupHappyPath();
    await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      message: "msg",
      files: [{ path: "src/content/pages/new.json", content: "{}" }],
      deletePaths: ["src/content/pages/old.json"],
    });
    // Blob is created only for the write — deletes have no blob.
    expect(createBlob).toHaveBeenCalledTimes(1);

    const treeArg = createTree.mock.calls[0][0] as { tree: { path: string; sha: string | null }[] };
    expect(treeArg.tree).toHaveLength(2);
    expect(treeArg.tree).toContainEqual(
      expect.objectContaining({ path: "src/content/pages/new.json", sha: expect.any(String) }),
    );
    expect(treeArg.tree).toContainEqual(
      expect.objectContaining({ path: "src/content/pages/old.json", sha: null }),
    );
  });

  it("supports a deletion-only commit (no writes)", async () => {
    setupHappyPath();
    await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "main",
      message: "delete page",
      files: [],
      deletePaths: ["src/content/pages/gone.json"],
    });
    expect(createBlob).not.toHaveBeenCalled();
    expect(createCommit).toHaveBeenCalledTimes(1);
  });

  it("propagates octokit errors", async () => {
    // Blob upload now happens before getRef (it's outside the retry
    // loop so retries reuse the same content-addressed SHAs). Mock
    // createBlob so the failure surfaces from getRef as intended.
    createBlob.mockResolvedValue({ data: { sha: "blob" } });
    getRef.mockRejectedValue(new Error("404"));
    await expect(
      commitFiles({
        token: "t",
        owner: "o",
        repo: "r",
        branch: "main",
        message: "msg",
        files: [{ path: "a.txt", content: "x" }],
      }),
    ).rejects.toThrow("404");
  });

  // ---------------------------------------------------------------------------
  // Retry on stale-ref 422 (ADR-010 §6)
  // ---------------------------------------------------------------------------

  function staleRefError(message = "Update is not a fast-forward"): RequestError {
    return new RequestError(message, 422, {
      request: { method: "PATCH", url: "x", headers: {} },
      response: { status: 422, url: "x", headers: {}, data: { message } },
    });
  }

  it("retries on stale-ref 422, succeeds on second attempt", async () => {
    // First updateRef sees draft-at-X; rebuild against draft-at-Y; succeed.
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: "head-X" } } })
      .mockResolvedValueOnce({ data: { object: { sha: "head-Y" } } });
    getCommit
      .mockResolvedValueOnce({ data: { tree: { sha: "tree-of-X" } } })
      .mockResolvedValueOnce({ data: { tree: { sha: "tree-of-Y" } } });
    createBlob.mockImplementation(({ content }) =>
      Promise.resolve({ data: { sha: `blob-${content.slice(0, 8)}` } }),
    );
    createTree
      .mockResolvedValueOnce({ data: { sha: "new-tree-1" } })
      .mockResolvedValueOnce({ data: { sha: "new-tree-2" } });
    createCommit
      .mockResolvedValueOnce({ data: { sha: "commit-1" } })
      .mockResolvedValueOnce({ data: { sha: "commit-2" } });
    updateRef
      .mockRejectedValueOnce(staleRefError())
      .mockResolvedValueOnce({ data: {} });

    const sha = await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "draft",
      message: "save",
      files: [{ path: "a.txt", content: "hello" }],
    });

    expect(sha).toBe("commit-2");
    // Blob is created exactly once even though the retry rebuilds the
    // tree — blobs are content-addressed and reused across attempts.
    expect(createBlob).toHaveBeenCalledTimes(1);
    // getRef, getCommit, createTree, createCommit each ran twice.
    expect(getRef).toHaveBeenCalledTimes(2);
    expect(getCommit).toHaveBeenCalledTimes(2);
    expect(createTree).toHaveBeenCalledTimes(2);
    expect(createCommit).toHaveBeenCalledTimes(2);
    expect(updateRef).toHaveBeenCalledTimes(2);
  });

  it("each retry uses a fresh base_tree and parent SHA from the new HEAD", async () => {
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: "head-X" } } })
      .mockResolvedValueOnce({ data: { object: { sha: "head-Y" } } });
    getCommit
      .mockResolvedValueOnce({ data: { tree: { sha: "tree-of-X" } } })
      .mockResolvedValueOnce({ data: { tree: { sha: "tree-of-Y" } } });
    createBlob.mockImplementation(({ content }) =>
      Promise.resolve({ data: { sha: `blob-${content.slice(0, 8)}` } }),
    );
    createTree
      .mockResolvedValueOnce({ data: { sha: "new-tree-1" } })
      .mockResolvedValueOnce({ data: { sha: "new-tree-2" } });
    createCommit
      .mockResolvedValueOnce({ data: { sha: "commit-1" } })
      .mockResolvedValueOnce({ data: { sha: "commit-2" } });
    updateRef
      .mockRejectedValueOnce(staleRefError())
      .mockResolvedValueOnce({ data: {} });

    await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "draft",
      message: "save",
      files: [{ path: "a.txt", content: "hello" }],
    });

    // First attempt builds on tree-of-X; retry builds on tree-of-Y.
    // This is the key correctness invariant: the rebuilt commit's
    // base_tree (and parent) reflect the new ref, not the stale one.
    expect(createTree).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ base_tree: "tree-of-X" }),
    );
    expect(createTree).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ base_tree: "tree-of-Y" }),
    );
    // Parent SHAs follow the same shape.
    expect(createCommit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ parents: ["head-X"] }),
    );
    expect(createCommit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ parents: ["head-Y"] }),
    );
  });

  it("throws ConcurrentEditError after 3 exhausted attempts", async () => {
    // Use distinct head SHAs across the three attempts — the realistic
    // race shape (the ref keeps moving each time we re-fetch). Asserting
    // `lastAttemptedParentSha === "head-3"` then proves the error
    // actually carries the LAST attempt's SHA, not the first.
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: "head-1" } } })
      .mockResolvedValueOnce({ data: { object: { sha: "head-2" } } })
      .mockResolvedValueOnce({ data: { object: { sha: "head-3" } } });
    getCommit
      .mockResolvedValueOnce({ data: { tree: { sha: "tree-1" } } })
      .mockResolvedValueOnce({ data: { tree: { sha: "tree-2" } } })
      .mockResolvedValueOnce({ data: { tree: { sha: "tree-3" } } });
    createBlob.mockImplementation(({ content }) =>
      Promise.resolve({ data: { sha: `blob-${content.slice(0, 8)}` } }),
    );
    createTree.mockResolvedValue({ data: { sha: "new-tree" } });
    createCommit.mockResolvedValue({ data: { sha: "commit" } });
    updateRef.mockRejectedValue(staleRefError());

    let thrown: unknown;
    try {
      await commitFiles({
        token: "t",
        owner: "o",
        repo: "r",
        branch: "draft",
        message: "save",
        files: [{ path: "a.txt", content: "x" }],
      });
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(ConcurrentEditError);
    const err = thrown as ConcurrentEditError;
    expect(err.ref).toBe("heads/draft");
    expect(err.attempts).toBe(3);
    expect(err.lastAttemptedParentSha).toBe("head-3");
    expect(err.cause).toBeInstanceOf(RequestError);
    // updateRef was tried exactly 3 times, no more.
    expect(updateRef).toHaveBeenCalledTimes(3);
  });

  // Locks the discriminator's accepted message catalog. If GitHub
  // changes the wording on `updateRef`'s stale-ref 422 (they have
  // historically — `fast-forward` vs `fast forward`), one of these
  // cases should fail, which is the signal to update `isStaleRefError`
  // and add the new phrasing here.
  it.each([
    "Update is not a fast-forward",
    "Update is not a fast forward",
    "Reference is not at expected value",
    "Update is not a Fast-Forward", // case-insensitive
  ])("treats 422 with message %j as a stale-ref signal and retries", async (msg) => {
    createBlob.mockResolvedValue({ data: { sha: "blob" } });
    getRef.mockResolvedValue({ data: { object: { sha: "head" } } });
    getCommit.mockResolvedValue({ data: { tree: { sha: "tree" } } });
    createTree.mockResolvedValue({ data: { sha: "new-tree" } });
    createCommit.mockResolvedValue({ data: { sha: "commit" } });
    updateRef
      .mockRejectedValueOnce(staleRefError(msg))
      .mockResolvedValueOnce({ data: {} });

    const sha = await commitFiles({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "draft",
      message: "save",
      files: [{ path: "a.txt", content: "x" }],
    });
    expect(sha).toBe("commit");
    expect(updateRef).toHaveBeenCalledTimes(2);
  });

  it("bubbles non-stale-ref 422 immediately without retrying", async () => {
    // 422 with a different message — e.g. the branch was deleted, or
    // a permissions issue. Not a stale-ref signal; the caller needs to
    // see it.
    getRef.mockResolvedValue({ data: { object: { sha: "head" } } });
    getCommit.mockResolvedValue({ data: { tree: { sha: "tree" } } });
    createBlob.mockResolvedValue({ data: { sha: "blob" } });
    createTree.mockResolvedValue({ data: { sha: "new-tree" } });
    createCommit.mockResolvedValue({ data: { sha: "commit" } });
    updateRef.mockRejectedValue(staleRefError("Reference does not exist"));

    await expect(
      commitFiles({
        token: "t",
        owner: "o",
        repo: "r",
        branch: "draft",
        message: "save",
        files: [{ path: "a.txt", content: "x" }],
      }),
    ).rejects.toThrow(/does not exist/);
    expect(updateRef).toHaveBeenCalledTimes(1);
  });

  it("bubbles a non-422 updateRef error immediately without retrying", async () => {
    getRef.mockResolvedValue({ data: { object: { sha: "head" } } });
    getCommit.mockResolvedValue({ data: { tree: { sha: "tree" } } });
    createBlob.mockResolvedValue({ data: { sha: "blob" } });
    createTree.mockResolvedValue({ data: { sha: "new-tree" } });
    createCommit.mockResolvedValue({ data: { sha: "commit" } });
    updateRef.mockRejectedValue(
      new RequestError("Internal server error", 500, {
        request: { method: "PATCH", url: "x", headers: {} },
        response: { status: 500, url: "x", headers: {}, data: {} },
      }),
    );

    await expect(
      commitFiles({
        token: "t",
        owner: "o",
        repo: "r",
        branch: "draft",
        message: "save",
        files: [{ path: "a.txt", content: "x" }],
      }),
    ).rejects.toThrow(/Internal server error/);
    expect(updateRef).toHaveBeenCalledTimes(1);
  });

  it("a 404 on getRef bubbles immediately (no retry triggered)", async () => {
    // The retry triggers on updateRef 422, not on getRef failures.
    // A 404 here means the branch doesn't exist — different recovery
    // (caller calls ensureBranchExists or fails publish).
    createBlob.mockResolvedValue({ data: { sha: "blob" } });
    getRef.mockRejectedValue(
      new RequestError("Not Found", 404, {
        request: { method: "GET", url: "x", headers: {} },
        response: { status: 404, url: "x", headers: {}, data: {} },
      }),
    );

    await expect(
      commitFiles({
        token: "t",
        owner: "o",
        repo: "r",
        branch: "draft",
        message: "save",
        files: [{ path: "a.txt", content: "x" }],
      }),
    ).rejects.toThrow(/Not Found/);
    // Only getRef ran (once) — the retry loop didn't even reach updateRef.
    expect(getRef).toHaveBeenCalledTimes(1);
    expect(updateRef).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ensureBranchExists (ADR-010)
// ---------------------------------------------------------------------------

function notFoundError(): Error {
  // The ensureBranchExists "missing branch" path keys off
  // `cause instanceof RequestError && cause.status === 404`, so the
  // test must supply that exact shape. RequestError lives in
  // @octokit/request-error (not re-exported from @octokit/rest).
  return new RequestError("Not Found", 404, {
    request: { method: "GET", url: "x", headers: {} },
    response: { status: 404, url: "x", headers: {}, data: {} },
  });
}

describe("ensureBranchExists", () => {
  it("no-op when the branch already exists", async () => {
    getRef.mockResolvedValue({ data: { object: { sha: "sha" } } });
    await ensureBranchExists({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "draft",
      fromBranch: "main",
    });
    expect(getRef).toHaveBeenCalledTimes(1);
    expect(getRef).toHaveBeenCalledWith({ owner: "o", repo: "r", ref: "heads/draft" });
    expect(createRef).not.toHaveBeenCalled();
  });

  it("creates the branch from fromBranch's HEAD when missing", async () => {
    getRef
      .mockRejectedValueOnce(notFoundError()) // first: heads/draft → 404
      .mockResolvedValueOnce({ data: { object: { sha: "main-head" } } }); // second: heads/main
    createRef.mockResolvedValue({ data: {} });

    await ensureBranchExists({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "draft",
      fromBranch: "main",
    });
    expect(createRef).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      ref: "refs/heads/draft",
      sha: "main-head",
    });
  });

  it("idempotent when createRef races with another caller (422 already exists)", async () => {
    getRef
      .mockRejectedValueOnce(notFoundError()) // first getRef: heads/draft → 404
      .mockResolvedValueOnce({ data: { object: { sha: "main-head" } } });
    // Someone else created the branch between our 404 and createRef.
    createRef.mockRejectedValue(
      new RequestError("Reference already exists", 422, {
        request: { method: "POST", url: "x", headers: {} },
        response: { status: 422, url: "x", headers: {}, data: {} },
      }),
    );
    await expect(
      ensureBranchExists({
        token: "t",
        owner: "o",
        repo: "r",
        branch: "draft",
        fromBranch: "main",
      }),
    ).resolves.toBeUndefined();
  });

  it("propagates non-404 errors from the first getRef", async () => {
    const boom = new Error("rate limit");
    getRef.mockRejectedValue(boom);
    await expect(
      ensureBranchExists({
        token: "t",
        owner: "o",
        repo: "r",
        branch: "draft",
        fromBranch: "main",
      }),
    ).rejects.toBe(boom);
    expect(createRef).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// squashBranchInto (ADR-010)
// ---------------------------------------------------------------------------

describe("squashBranchInto", () => {
  it("creates a new commit on toBranch with fromBranch's tree, then FFs fromBranch", async () => {
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: "draft-head" } } }) // fromBranch
      .mockResolvedValueOnce({ data: { object: { sha: "main-head" } } }); // toBranch
    getCommit.mockResolvedValue({ data: { tree: { sha: "draft-tree-sha" } } });
    createCommit.mockResolvedValue({ data: { sha: "squash-sha" } });
    updateRef.mockResolvedValue({ data: {} });

    const result = await squashBranchInto({
      token: "t",
      owner: "o",
      repo: "r",
      fromBranch: "draft",
      toBranch: "main",
      message: "Publish from draft",
      author: { name: "A", email: "a@e.com" },
    });

    expect(result).toEqual({ commitSha: "squash-sha", alreadyInSync: false });
    // Squash commit: parent = main's current HEAD, tree = draft's tree.
    expect(createCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "o",
        repo: "r",
        message: "Publish from draft",
        tree: "draft-tree-sha",
        parents: ["main-head"],
        author: { name: "A", email: "a@e.com" },
      }),
    );
    // Both refs end at the new commit. Order MATTERS: source (draft)
    // first, then target (main). On partial failure that order
    // preserves ADR-010's invariant `draft.sha === main.sha OR draft
    // is ahead of main`; the reverse order would leave draft behind
    // main and the next save would lose data.
    expect(updateRef).toHaveBeenNthCalledWith(1, {
      owner: "o",
      repo: "r",
      ref: "heads/draft",
      sha: "squash-sha",
    });
    expect(updateRef).toHaveBeenNthCalledWith(2, {
      owner: "o",
      repo: "r",
      ref: "heads/main",
      sha: "squash-sha",
    });
  });

  it("on partial failure (draft updated, main not) the invariant holds (draft ahead of main)", async () => {
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: "draft-head" } } })
      .mockResolvedValueOnce({ data: { object: { sha: "main-head" } } });
    getCommit.mockResolvedValue({ data: { tree: { sha: "draft-tree" } } });
    createCommit.mockResolvedValue({ data: { sha: "squash-sha" } });
    // First updateRef (draft) succeeds; second (main) throws.
    updateRef
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error("transient: 503"));
    await expect(
      squashBranchInto({
        token: "t",
        owner: "o",
        repo: "r",
        fromBranch: "draft",
        toBranch: "main",
        message: "msg",
      }),
    ).rejects.toThrow("transient: 503");
    // Crucially: draft *did* get updated to the squash. Next save's
    // commitFiles will append to it, and the retry's squash will
    // catch main up from a draft tree that includes the previous
    // squash's content.
    expect(updateRef).toHaveBeenNthCalledWith(1, expect.objectContaining({
      ref: "heads/draft",
      sha: "squash-sha",
    }));
  });

  it("returns alreadyInSync without creating a commit when the refs match", async () => {
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: "same" } } })
      .mockResolvedValueOnce({ data: { object: { sha: "same" } } });
    const result = await squashBranchInto({
      token: "t",
      owner: "o",
      repo: "r",
      fromBranch: "draft",
      toBranch: "main",
      message: "noop",
    });
    expect(result).toEqual({ commitSha: "same", alreadyInSync: true });
    expect(getCommit).not.toHaveBeenCalled();
    expect(createCommit).not.toHaveBeenCalled();
    expect(updateRef).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// mergeBranchInto (ADR-010 §7 — auto-rebase main → draft before each save)
// ---------------------------------------------------------------------------

describe("mergeBranchInto", () => {
  it("returns merged with the new commit SHA on a clean merge (201)", async () => {
    reposMerge.mockResolvedValue({
      status: 201,
      data: { sha: "merge-commit-sha" },
    });
    const result = await mergeBranchInto({
      token: "t",
      owner: "o",
      repo: "r",
      from: "main",
      into: "draft",
    });
    expect(result).toEqual({ kind: "merged", mergeCommitSha: "merge-commit-sha" });
    expect(reposMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "o",
        repo: "r",
        base: "draft",
        head: "main",
        commit_message: expect.stringContaining("[skip ci]"),
      }),
    );
  });

  it("returns already-included when GitHub reports nothing to merge", async () => {
    // Octokit normalises 204 No Content to a 204 response without data.
    reposMerge.mockResolvedValue({ status: 204, data: null });
    const result = await mergeBranchInto({
      token: "t",
      owner: "o",
      repo: "r",
      from: "main",
      into: "draft",
    });
    expect(result).toEqual({ kind: "already-included", reason: "noop" });
  });

  it("returns conflict when GitHub returns 409", async () => {
    reposMerge.mockRejectedValue(
      new RequestError("Merge conflict", 409, {
        request: { method: "POST", url: "x", headers: {} },
        response: { status: 409, url: "x", headers: {}, data: {} },
      }),
    );
    const result = await mergeBranchInto({
      token: "t",
      owner: "o",
      repo: "r",
      from: "main",
      into: "draft",
    });
    expect(result).toEqual({ kind: "conflict" });
  });

  it("treats a 204 RequestError as already-included (Octokit's typing quirk)", async () => {
    reposMerge.mockRejectedValue(
      new RequestError("No Content", 204, {
        request: { method: "POST", url: "x", headers: {} },
        response: { status: 204, url: "x", headers: {}, data: {} },
      }),
    );
    const result = await mergeBranchInto({
      token: "t",
      owner: "o",
      repo: "r",
      from: "main",
      into: "draft",
    });
    expect(result).toEqual({ kind: "already-included", reason: "ancestor" });
  });

  it("propagates non-conflict / non-204 errors", async () => {
    reposMerge.mockRejectedValue(
      new RequestError("Not Found", 404, {
        request: { method: "POST", url: "x", headers: {} },
        response: { status: 404, url: "x", headers: {}, data: {} },
      }),
    );
    await expect(
      mergeBranchInto({
        token: "t",
        owner: "o",
        repo: "r",
        from: "main",
        into: "draft",
      }),
    ).rejects.toThrow("Not Found");
  });

  it("respects a custom commit message", async () => {
    reposMerge.mockResolvedValue({
      status: 201,
      data: { sha: "merge-sha" },
    });
    await mergeBranchInto({
      token: "t",
      owner: "o",
      repo: "r",
      from: "main",
      into: "draft",
      commitMessage: "Custom merge message",
    });
    expect(reposMerge).toHaveBeenCalledWith(
      expect.objectContaining({ commit_message: "Custom merge message" }),
    );
  });
});


// ---------------------------------------------------------------------------
// resetBranchTo (ADR-010 §4 — discard the draft branch)
// ---------------------------------------------------------------------------

describe("resetBranchTo", () => {
  function notFoundError(): Error {
    return new RequestError("Not Found", 404, {
      request: { method: "GET", url: "x", headers: {} },
      response: { status: 404, url: "x", headers: {}, data: {} },
    });
  }

  it("force-updates the branch to mains HEAD when they differ", async () => {
    getRef
      // First call: toBranch (main) HEAD
      .mockResolvedValueOnce({ data: { object: { sha: "main-sha" } } })
      // Second call: the branch being reset (draft) HEAD
      .mockResolvedValueOnce({ data: { object: { sha: "old-draft" } } });
    updateRef.mockResolvedValue({ data: {} });

    const result = await resetBranchTo({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "draft",
      toBranch: "main",
    });
    expect(result).toEqual({
      resetFromSha: "old-draft",
      toSha: "main-sha",
      alreadyInSync: false,
    });
    expect(updateRef).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: "heads/draft",
        sha: "main-sha",
        force: true,
      }),
    );
  });

  it("reports alreadyInSync when the branches match (no updateRef call)", async () => {
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: "same" } } })
      .mockResolvedValueOnce({ data: { object: { sha: "same" } } });
    const result = await resetBranchTo({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "draft",
      toBranch: "main",
    });
    expect(result).toEqual({
      resetFromSha: "same",
      toSha: "same",
      alreadyInSync: true,
    });
    expect(updateRef).not.toHaveBeenCalled();
  });

  it("treats a missing source branch as alreadyInSync with null resetFromSha", async () => {
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: "main-sha" } } })
      .mockRejectedValueOnce(notFoundError());
    const result = await resetBranchTo({
      token: "t",
      owner: "o",
      repo: "r",
      branch: "draft",
      toBranch: "main",
    });
    expect(result).toEqual({
      resetFromSha: null,
      toSha: "main-sha",
      alreadyInSync: true,
    });
    expect(updateRef).not.toHaveBeenCalled();
  });

  it("propagates non-404 errors when fetching the source branch", async () => {
    getRef
      .mockResolvedValueOnce({ data: { object: { sha: "main-sha" } } })
      .mockRejectedValueOnce(new Error("rate limit hit"));
    await expect(
      resetBranchTo({
        token: "t",
        owner: "o",
        repo: "r",
        branch: "draft",
        toBranch: "main",
      }),
    ).rejects.toThrow("rate limit hit");
  });

  it("propagates errors when fetching the target branch", async () => {
    getRef.mockRejectedValue(new Error("main does not exist"));
    await expect(
      resetBranchTo({
        token: "t",
        owner: "o",
        repo: "r",
        branch: "draft",
        toBranch: "main",
      }),
    ).rejects.toThrow("main does not exist");
  });
});
