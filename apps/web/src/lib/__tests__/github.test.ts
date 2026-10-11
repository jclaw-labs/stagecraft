import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockFetch = vi.fn();

vi.mock("@stagecraft/db", () => ({
  prisma: {
    integrationAccount: { findUnique: mockFindUnique },
  },
}));

vi.stubGlobal("fetch", mockFetch);

const {
  BLOB_UPLOAD_CONCURRENCY,
  checkGitHubToken,
  createBranch,
  createPullRequest,
  createRepo,
  githubRepoClient,
  lastPageFromLinkHeader,
  getAuthenticatedUser,
  getOwnRepo,
  GitHubApiError,
  MAX_TREE_CONTENT_BYTES,
  pushFiles,
} = await import("../integrations/github");

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("GitHub integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ accessToken: "gh-token-123" });
  });

  describe("getAuthenticatedUser", () => {
    it("returns the authenticated user", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "jclaw", id: 12345 }),
      });

      const user = await getAuthenticatedUser("gh-token-123");
      expect(user).toEqual({ login: "jclaw", id: 12345 });
    });
  });

  describe("createRepo", () => {
    it("creates a repo and returns structured result", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          owner: { login: "jclaw" },
          name: "my-site",
          full_name: "jclaw/my-site",
          html_url: "https://github.com/jclaw/my-site",
          clone_url: "https://github.com/jclaw/my-site.git",
          default_branch: "main",
        }),
      });

      const result = await createRepo({
        userId: "user-1",
        name: "my-site",
        description: "Test site",
      });

      expect(result).toEqual({
        owner: "jclaw",
        name: "my-site",
        fullName: "jclaw/my-site",
        htmlUrl: "https://github.com/jclaw/my-site",
        cloneUrl: "https://github.com/jclaw/my-site.git",
        defaultBranch: "main",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user/repos",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("creates the repo as private by default", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 1,
          owner: { login: "jclaw" },
          name: "my-site",
          full_name: "jclaw/my-site",
          html_url: "https://github.com/jclaw/my-site",
          clone_url: "https://github.com/jclaw/my-site.git",
          default_branch: "main",
        }),
      );

      await createRepo({ userId: "user-1", name: "my-site", description: "Test site" });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        name: "my-site",
        description: "Test site",
        private: true,
        auto_init: true,
      });
    });

    it("honors an explicit isPrivate: false", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: 1,
          owner: { login: "jclaw" },
          name: "my-site",
          full_name: "jclaw/my-site",
          html_url: "https://github.com/jclaw/my-site",
          clone_url: "https://github.com/jclaw/my-site.git",
          default_branch: "main",
        }),
      );

      await createRepo({ userId: "user-1", name: "my-site", isPrivate: false });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toMatchObject({ private: false });
    });

    it("throws when GitHub account is not connected", async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      await expect(
        createRepo({ userId: "user-1", name: "test" })
      ).rejects.toThrow("GitHub account not connected");
    });

    it("throws on GitHub API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => '{"message":"name already exists"}',
      });

      await expect(
        createRepo({ userId: "user-1", name: "existing-repo" })
      ).rejects.toThrow("GitHub API error (422)");
    });
  });

  describe("getOwnRepo", () => {
    it("returns the repo on the authenticated user's account", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ login: "jclaw", id: 1 }))
        .mockResolvedValueOnce(
          jsonResponse({
            id: 7,
            owner: { login: "jclaw" },
            name: "my-site",
            full_name: "jclaw/my-site",
            html_url: "https://github.com/jclaw/my-site",
            clone_url: "https://github.com/jclaw/my-site.git",
            default_branch: "main",
            created_at: "2026-10-09T11:00:05Z",
          }),
        );

      const repo = await getOwnRepo("user-1", "my-site");

      expect(repo).toMatchObject({
        owner: "jclaw",
        name: "my-site",
        defaultBranch: "main",
        createdAt: "2026-10-09T11:00:05Z",
      });
      expect(mockFetch.mock.calls[1][0]).toBe("https://api.github.com/repos/jclaw/my-site");
    });

    it("returns null when the repo doesn't exist", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ login: "jclaw", id: 1 }))
        .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404));

      expect(await getOwnRepo("user-1", "missing")).toBeNull();
    });

    it("rethrows other errors as GitHubApiError", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ login: "jclaw", id: 1 }))
        .mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500));

      await expect(getOwnRepo("user-1", "my-site")).rejects.toBeInstanceOf(GitHubApiError);
    });
  });

  describe("pushFiles", () => {
    type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

    /** Route GitHub calls by path and record them; `treeSha` names each new tree. */
    function mockGitData(options: { treeSha?: (call: number) => string } = {}) {
      const calls: Call[] = [];
      let treeCalls = 0;
      let blobCalls = 0;
      let blobsInFlight = 0;
      const stats = { peakBlobsInFlight: 0 };
      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined;
        calls.push({ url, method, body });
        if (url.includes("/git/ref/heads/")) return jsonResponse({ object: { sha: "parent-sha" } });
        if (url.endsWith("/git/commits/parent-sha")) return jsonResponse({ tree: { sha: "parent-tree" } });
        if (url.endsWith("/git/blobs")) {
          blobsInFlight++;
          stats.peakBlobsInFlight = Math.max(stats.peakBlobsInFlight, blobsInFlight);
          await new Promise((r) => setTimeout(r, 1));
          blobsInFlight--;
          return jsonResponse({ sha: `blob-${++blobCalls}` });
        }
        if (url.endsWith("/git/trees")) {
          treeCalls++;
          return jsonResponse({ sha: options.treeSha ? options.treeSha(treeCalls) : `tree-${treeCalls}` });
        }
        if (url.endsWith("/git/commits")) return jsonResponse({ sha: "commit-sha-1" });
        if (url.includes("/git/refs/heads/")) return jsonResponse({});
        throw new Error(`unexpected call ${method} ${url}`);
      });
      return { calls, stats };
    }

    const textFiles = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ path: `src/file-${i}.ts`, content: `export const n = ${i};\n` }));

    it("pushes text files inline in one tree on top of the branch's tree", async () => {
      const { calls } = mockGitData();

      const result = await pushFiles("user-1", "jclaw", "my-site", "main", textFiles(2), "Initial commit");

      expect(result).toEqual({ commitSha: "commit-sha-1", changed: true });
      expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.github.com/repos/jclaw/my-site", "")}`)).toEqual([
        "GET /git/ref/heads/main",
        "GET /git/commits/parent-sha",
        "POST /git/trees",
        "POST /git/commits",
        "PATCH /git/refs/heads/main",
      ]);
      const tree = calls[2].body!;
      expect(tree.base_tree).toBe("parent-tree");
      expect(tree.tree).toEqual([
        { path: "src/file-0.ts", mode: "100644", type: "blob", content: "export const n = 0;\n" },
        { path: "src/file-1.ts", mode: "100644", type: "blob", content: "export const n = 1;\n" },
      ]);
      expect(calls[3].body).toEqual({ message: "Initial commit", tree: "tree-1", parents: ["parent-sha"] });
      expect(calls[4].body).toEqual({ sha: "commit-sha-1" });
    });

    it("makes the same five calls for a template-sized push (no call per file)", async () => {
      const { calls } = mockGitData();

      await pushFiles("user-1", "jclaw", "my-site", "main", textFiles(400), "Initial site");

      expect(calls).toHaveLength(5);
      expect(calls.filter((c) => c.url.endsWith("/git/blobs"))).toHaveLength(0);
      expect((calls[2].body!.tree as unknown[]).length).toBe(400);
    });

    it("splits text past MAX_TREE_CONTENT_BYTES into chained tree requests", async () => {
      const { calls } = mockGitData();
      const big = "x".repeat(Math.floor(MAX_TREE_CONTENT_BYTES / 2) + 1);
      const files = [0, 1, 2].map((i) => ({ path: `big-${i}.txt`, content: big }));

      await pushFiles("user-1", "jclaw", "my-site", "main", files, "Big");

      const trees = calls.filter((c) => c.url.endsWith("/git/trees"));
      expect(trees.map((t) => t.body!.base_tree)).toEqual(["parent-tree", "tree-1", "tree-2"]);
      expect(trees.map((t) => (t.body!.tree as unknown[]).length)).toEqual([1, 1, 1]);
      expect(calls.find((c) => c.url.endsWith("/git/commits") && c.method === "POST")!.body!.tree).toBe("tree-3");
    });

    it("uploads only binary files as blobs, at most BLOB_UPLOAD_CONCURRENCY at once", async () => {
      const { calls, stats } = mockGitData();
      const images = Array.from({ length: 10 }, (_, i) => ({
        path: `public/img-${i}.png`,
        content: "iVBORw0KGgo=",
        encoding: "base64" as const,
      }));

      await pushFiles("user-1", "jclaw", "my-site", "main", [...textFiles(3), ...images], "Add images");

      const blobs = calls.filter((c) => c.url.endsWith("/git/blobs"));
      expect(blobs).toHaveLength(10);
      expect(blobs.every((b) => b.body!.encoding === "base64" && b.body!.content === "iVBORw0KGgo=")).toBe(true);
      expect(stats.peakBlobsInFlight).toBeLessThanOrEqual(BLOB_UPLOAD_CONCURRENCY);
      expect(stats.peakBlobsInFlight).toBeGreaterThan(1);
      // 5 fixed calls + one per binary file.
      expect(calls).toHaveLength(15);

      const entries = calls.find((c) => c.url.endsWith("/git/trees"))!.body!.tree as Array<Record<string, unknown>>;
      expect(entries).toHaveLength(13);
      const image = entries.find((e) => e.path === "public/img-0.png")!;
      expect(image).toMatchObject({ mode: "100644", type: "blob" });
      expect(image.sha).toMatch(/^blob-\d+$/);
      expect(image).not.toHaveProperty("content");
      expect(entries.find((e) => e.path === "src/file-0.ts")).toHaveProperty("content");
    });

    it("makes no commit when the branch already has these files", async () => {
      const { calls } = mockGitData({ treeSha: () => "parent-tree" });

      const result = await pushFiles("user-1", "jclaw", "my-site", "main", textFiles(2), "Retry");

      expect(result).toEqual({ commitSha: "parent-sha", changed: false });
      expect(calls.some((c) => c.url.endsWith("/git/commits") && c.method === "POST")).toBe(false);
      expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    });

    it("fails without committing when a blob upload fails", async () => {
      mockGitData();
      const base = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url: string, init?: RequestInit) =>
        url.endsWith("/git/blobs") ? jsonResponse({ message: "too big" }, 422) : base(url, init),
      );

      await expect(
        pushFiles(
          "user-1",
          "jclaw",
          "my-site",
          "main",
          [{ path: "a.png", content: "AA==", encoding: "base64" }],
          "Add image",
        ),
      ).rejects.toThrow("GitHub API error (422)");
      expect(mockFetch.mock.calls.some(([url]) => (url as string).endsWith("/git/commits"))).toBe(false);
    });
  });
});

/** A fetch response with headers, for the calls that read them. */
function headerResponse(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return { ...jsonResponse(body, status), headers: new Headers(headers) };
}

/** The [method, path, parsed body] of every fetch call so far. */
function calls(): Array<[string, string, unknown]> {
  return mockFetch.mock.calls.map(([url, init]) => [
    (init as RequestInit | undefined)?.method ?? "GET",
    (url as string).replace("https://api.github.com", ""),
    (init as RequestInit | undefined)?.body ? JSON.parse((init as RequestInit).body as string) : undefined,
  ]);
}

describe("checkGitHubToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ accessToken: "gh-token-123" });
  });

  it("is ok when the token has every required scope", async () => {
    mockFetch.mockResolvedValueOnce(headerResponse({ login: "jclaw" }, { "x-oauth-scopes": "read:user, repo, user:email, workflow" }));
    expect(await checkGitHubToken("user-1", ["repo", "workflow"])).toEqual({
      status: "ok",
      scopes: ["read:user", "repo", "user:email", "workflow"],
    });
  });

  it("names the scopes a token was granted without", async () => {
    mockFetch.mockResolvedValueOnce(headerResponse({ login: "jclaw" }, { "x-oauth-scopes": "read:user, repo" }));
    expect(await checkGitHubToken("user-1", ["repo", "workflow"])).toEqual({
      status: "missing_scopes",
      missingScopes: ["workflow"],
    });
  });

  it("is stale when GitHub answers 401", async () => {
    mockFetch.mockResolvedValueOnce(headerResponse({ message: "Bad credentials" }, {}, 401));
    expect(await checkGitHubToken("user-1", ["repo"])).toEqual({ status: "stale" });
  });

  it("is missing when no GitHub account is connected", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await checkGitHubToken("user-1", ["repo"])).toEqual({ status: "missing" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when the stored token can't be read, rather than asking for a sign-in", async () => {
    mockFindUnique.mockRejectedValueOnce(new Error("connection refused"));
    await expect(checkGitHubToken("user-1", ["repo"])).rejects.toThrow("connection refused");
  });

  it("takes a token without a scopes header as having them", async () => {
    mockFetch.mockResolvedValueOnce(headerResponse({ login: "jclaw" }));
    expect(await checkGitHubToken("user-1", ["repo", "workflow"])).toEqual({ status: "ok", scopes: ["repo", "workflow"] });
  });

  it("throws other GitHub errors", async () => {
    mockFetch.mockResolvedValueOnce(headerResponse({ message: "oops" }, {}, 502));
    await expect(checkGitHubToken("user-1", ["repo"])).rejects.toThrow("GitHub API error (502)");
  });
});

describe("lastPageFromLinkHeader", () => {
  it("reads the last page", () => {
    expect(
      lastPageFromLinkHeader(
        '<https://api.github.com/repos/a/b/commits?per_page=1&page=2>; rel="next", <https://api.github.com/repos/a/b/commits?per_page=1&page=57>; rel="last"',
      ),
    ).toBe(57);
  });

  it("is null without a last link", () => {
    expect(lastPageFromLinkHeader(null)).toBeNull();
    expect(lastPageFromLinkHeader('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
  });
});

describe("githubRepoClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ accessToken: "gh-token-123" });
  });

  const client = () => githubRepoClient("user-1", "jclaw", "site");

  it("reads the token once for all its calls", async () => {
    const repo = await client();
    mockFetch.mockResolvedValue(headerResponse({ object: { sha: "abc" } }));
    await repo.getBranchHead("main");
    await repo.getBranchHead("draft");
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it("returns null for a missing branch", async () => {
    const repo = await client();
    mockFetch.mockResolvedValueOnce(headerResponse({ message: "Not Found" }, {}, 404));
    expect(await repo.getBranchHead("stagecraft/upgrade")).toBeNull();
    expect(calls()[0][1]).toBe("/repos/jclaw/site/git/ref/heads/stagecraft/upgrade");
  });

  it("lists a commit's files, blobs only", async () => {
    const repo = await client();
    mockFetch
      .mockResolvedValueOnce(headerResponse({ tree: { sha: "tree-1" } }))
      .mockResolvedValueOnce(
        headerResponse({
          truncated: false,
          tree: [
            { path: "src", type: "tree", sha: "t" },
            { path: "src/a.ts", type: "blob", sha: "b1" },
          ],
        }),
      );
    expect([...(await repo.getTree("c1"))]).toEqual([["src/a.ts", "b1"]]);
    expect(calls()[1][1]).toBe("/repos/jclaw/site/git/trees/tree-1?recursive=1");
  });

  it("refuses a truncated tree", async () => {
    const repo = await client();
    mockFetch
      .mockResolvedValueOnce(headerResponse({ tree: { sha: "tree-1" } }))
      .mockResolvedValueOnce(headerResponse({ truncated: true, tree: [] }));
    await expect(repo.getTree("c1")).rejects.toThrow("too large");
  });

  it("decodes a base64 blob", async () => {
    const repo = await client();
    mockFetch.mockResolvedValueOnce(headerResponse({ content: Buffer.from("héllo").toString("base64"), encoding: "base64" }));
    expect(await repo.getBlobText("b1")).toBe("héllo");
  });

  it("finds the oldest commit touching a path from the last page", async () => {
    const repo = await client();
    mockFetch
      .mockResolvedValueOnce(
        headerResponse([{ sha: "newest" }], {
          link: '<https://api.github.com/repos/jclaw/site/commits?path=src%2Flib&sha=main&per_page=1&page=3>; rel="last"',
        }),
      )
      .mockResolvedValueOnce(headerResponse([{ sha: "oldest" }]));
    expect(await repo.findOldestCommitTouching("src/lib", "main")).toBe("oldest");
    expect(calls()[1][1]).toBe("/repos/jclaw/site/commits?path=src%2Flib&sha=main&per_page=1&page=3");
  });

  it("takes the only commit when there's one page, and null when there's none", async () => {
    const repo = await client();
    mockFetch.mockResolvedValueOnce(headerResponse([{ sha: "only" }])).mockResolvedValueOnce(headerResponse([]));
    expect(await repo.findOldestCommitTouching("src/lib", "main")).toBe("only");
    expect(await repo.findOldestCommitTouching("src/lib", "main")).toBeNull();
  });

  it("tells whether a commit touches a path", async () => {
    const repo = await client();
    mockFetch
      .mockResolvedValueOnce(headerResponse([{ sha: "c1" }]))
      .mockResolvedValueOnce(headerResponse([{ sha: "c0" }]))
      .mockResolvedValueOnce(headerResponse({ message: "No commit found" }, {}, 422));
    expect(await repo.commitTouchesPath("c1", "src/lib")).toBe(true);
    expect(await repo.commitTouchesPath("c2", "src/lib")).toBe(false);
    expect(await repo.commitTouchesPath("gone", "src/lib")).toBe(false);
  });

  it("pages through branches", async () => {
    const repo = await client();
    const page = (n: number, offset: number) => Array.from({ length: n }, (_, i) => ({ name: `b${offset + i}` }));
    mockFetch.mockResolvedValueOnce(headerResponse(page(100, 0))).mockResolvedValueOnce(headerResponse(page(2, 100)));
    expect(await repo.listBranches()).toHaveLength(102);
    expect(calls().map(([, path]) => path)).toEqual([
      "/repos/jclaw/site/branches?per_page=100&page=1",
      "/repos/jclaw/site/branches?per_page=100&page=2",
    ]);
  });

  it("lists the files a branch changed, both names of a rename", async () => {
    const repo = await client();
    mockFetch.mockResolvedValueOnce(
      headerResponse({ files: [{ filename: "a.json" }, { filename: "b.json", previous_filename: "old.json" }] }),
    );
    expect(await repo.changedFilesSince("main", "draft-x")).toEqual(["a.json", "b.json", "old.json"]);
    expect(calls()[0][1]).toBe("/repos/jclaw/site/compare/main...draft-x");
  });

  it("creates a commit that writes and deletes files, without moving a branch", async () => {
    const repo = await client();
    mockFetch
      .mockResolvedValueOnce(headerResponse({ tree: { sha: "base-tree" } }))
      .mockResolvedValueOnce(headerResponse({ sha: "new-tree" }))
      .mockResolvedValueOnce(headerResponse({ sha: "new-commit" }));

    const sha = await repo.createCommit({
      parentSha: "parent",
      files: [{ path: "package.json", content: "{}" }],
      deletePaths: ["src/lib/a.ts"],
      message: "Upgrade",
    });

    expect(sha).toBe("new-commit");
    const recorded = calls();
    expect(recorded[1]).toEqual([
      "POST",
      "/repos/jclaw/site/git/trees",
      {
        base_tree: "base-tree",
        tree: [
          { path: "package.json", mode: "100644", type: "blob", content: "{}" },
          { path: "src/lib/a.ts", mode: "100644", type: "blob", sha: null },
        ],
      },
    ]);
    expect(recorded[2]).toEqual(["POST", "/repos/jclaw/site/git/commits", { message: "Upgrade", tree: "new-tree", parents: ["parent"] }]);
    expect(recorded).toHaveLength(3);
  });

  it("force-moves a branch", async () => {
    const repo = await client();
    mockFetch.mockResolvedValueOnce(headerResponse({}));
    await repo.setBranchHead("stagecraft/upgrade", "c9");
    expect(calls()[0]).toEqual(["PATCH", "/repos/jclaw/site/git/refs/heads/stagecraft/upgrade", { sha: "c9", force: true }]);
  });

  it("finds the open pull request from a branch, and updates it", async () => {
    const repo = await client();
    mockFetch
      .mockResolvedValueOnce(headerResponse([{ number: 4, html_url: "https://github.com/jclaw/site/pull/4", state: "open" }]))
      .mockResolvedValueOnce(headerResponse({ number: 4, html_url: "https://github.com/jclaw/site/pull/4", state: "open" }))
      .mockResolvedValueOnce(headerResponse([]));

    expect(await repo.findOpenPullRequest("stagecraft/upgrade", "main")).toEqual({
      number: 4,
      htmlUrl: "https://github.com/jclaw/site/pull/4",
      state: "open",
    });
    await repo.updatePullRequest(4, { title: "T", body: "B" });
    expect(await repo.findOpenPullRequest("stagecraft/upgrade", "main")).toBeNull();

    const recorded = calls();
    expect(recorded[0][1]).toBe("/repos/jclaw/site/pulls?head=jclaw%3Astagecraft%2Fupgrade&base=main&state=open");
    expect(recorded[1]).toEqual(["PATCH", "/repos/jclaw/site/pulls/4", { title: "T", body: "B" }]);
  });
});

describe("createBranch and createPullRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ accessToken: "gh-token-123" });
  });

  it("creates a branch at the base branch's head", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ object: { sha: "head" } })).mockResolvedValueOnce(jsonResponse({}));
    await createBranch("user-1", "jclaw", "site", "main", "stagecraft/upgrade");
    expect(calls()[1]).toEqual(["POST", "/repos/jclaw/site/git/refs", { ref: "refs/heads/stagecraft/upgrade", sha: "head" }]);
  });

  it("opens a pull request", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ number: 7, html_url: "https://github.com/jclaw/site/pull/7", state: "open" }));
    const pr = await createPullRequest("user-1", "jclaw", "site", { title: "T", body: "B", head: "stagecraft/upgrade", base: "main" });
    expect(pr).toEqual({ number: 7, htmlUrl: "https://github.com/jclaw/site/pull/7", state: "open" });
    expect(calls()[0]).toEqual(["POST", "/repos/jclaw/site/pulls", { title: "T", body: "B", head: "stagecraft/upgrade", base: "main" }]);
  });
});
