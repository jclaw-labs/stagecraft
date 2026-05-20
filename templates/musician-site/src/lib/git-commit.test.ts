import { describe, expect, it, vi, beforeEach } from "vitest";
import { RequestError } from "@octokit/request-error";

const getRef = vi.fn();
const getCommit = vi.fn();
const createBlob = vi.fn();
const createTree = vi.fn();
const createCommit = vi.fn();
const createRef = vi.fn();
const updateRef = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    git = { getRef, getCommit, createBlob, createTree, createCommit, createRef, updateRef };
  },
}));

import { commitFiles, ensureBranchExists, squashBranchInto } from "./git-commit";

beforeEach(() => {
  getRef.mockReset();
  getCommit.mockReset();
  createBlob.mockReset();
  createTree.mockReset();
  createCommit.mockReset();
  createRef.mockReset();
  updateRef.mockReset();
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
    // Both refs end at the new commit. Order: main first (the
    // user-visible deploy ref), then draft FF's to match.
    expect(updateRef).toHaveBeenNthCalledWith(1, {
      owner: "o",
      repo: "r",
      ref: "heads/main",
      sha: "squash-sha",
    });
    expect(updateRef).toHaveBeenNthCalledWith(2, {
      owner: "o",
      repo: "r",
      ref: "heads/draft",
      sha: "squash-sha",
    });
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
