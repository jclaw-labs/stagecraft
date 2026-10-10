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
  createRepo,
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
