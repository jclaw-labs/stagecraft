import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobContext } from "@stagecraft/queue";

import type { GitHubRepoClient, GitHubTokenCheck, PullRequestResult } from "../integrations/github";
import { gitBlobSha, SITE_AUTOMERGE_WORKFLOW_PATH, TEMPLATE_STAMP_PATH } from "../site-scaffold";
import type { TemplateFile } from "../template-reader";

const mocks = vi.hoisted(() => ({
  siteFindUnique: vi.fn(),
  jobFindUnique: vi.fn(),
  jobFindFirst: vi.fn(),
  jobUpdateMany: vi.fn(),
  checkGitHubToken: vi.fn(),
  githubRepoClient: vi.fn(),
  createBranch: vi.fn(),
  createPullRequest: vi.fn(),
  readTemplateFiles: vi.fn(),
}));

vi.mock("@stagecraft/db", () => ({
  prisma: {
    site: { findUnique: mocks.siteFindUnique },
    siteJob: { findUnique: mocks.jobFindUnique, findFirst: mocks.jobFindFirst, updateMany: mocks.jobUpdateMany },
  },
}));

vi.mock("@/lib/integrations/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integrations/github")>();
  return {
    GitHubApiError: actual.GitHubApiError,
    checkGitHubToken: mocks.checkGitHubToken,
    githubRepoClient: mocks.githubRepoClient,
    createBranch: mocks.createBranch,
    createPullRequest: mocks.createPullRequest,
  };
});

vi.mock("@/lib/template-reader", () => ({ readTemplateFiles: mocks.readTemplateFiles }));

// A chain one step longer than the real one, so a target release can need
// content rewritten: version 1 → 2 marks the collection as upgraded.
vi.mock("@jclaw-labs/content-upgraders", () => ({
  OLDEST_SCHEMA_VERSION: 1,
  LATEST_SCHEMA_VERSION: 2,
  upgradeCollection: (collection: Record<string, unknown>, target: number) =>
    collection.schemaVersion === 1 && target === 2 ? { ...collection, schemaVersion: 2, upgraded: true } : collection,
}));

const { handleUpgradeSite, REAUTH_MESSAGE } = await import("./upgrade-site");
const { GitHubApiError } = await import("../integrations/github");

// ---------------------------------------------------------------------------
// An in-memory GitHub repo behind the GitHubRepoClient interface.
// ---------------------------------------------------------------------------

type Tree = Map<string, string>;

class FakeRepo {
  readonly owner = "jclaw";
  readonly repo = "stagecraft-site-sarah";
  branches = new Map<string, string>();
  commits = new Map<string, { tree: Tree; parent: string | null; message: string }>();
  blobs = new Map<string, string>();
  pulls: Array<PullRequestResult & { head: string; base: string; title: string; body: string }> = [];
  private nextCommit = 1;

  /** Commit `files` (null deletes) on `parent`, returning the new commit's SHA. */
  commit(parent: string | null, files: Record<string, string | null>, message = "Edit"): string {
    const tree = new Map(parent ? this.commits.get(parent)!.tree : []);
    for (const [path, content] of Object.entries(files)) {
      if (content === null) {
        tree.delete(path);
      } else {
        const sha = gitBlobSha(content);
        this.blobs.set(sha, content);
        tree.set(path, sha);
      }
    }
    const sha = `c${String(this.nextCommit++).padStart(39, "0")}`;
    this.commits.set(sha, { tree, parent, message });
    return sha;
  }

  /** Commit on `branch` and move it. */
  commitOn(branch: string, files: Record<string, string | null>): string {
    const sha = this.commit(this.branches.get(branch) ?? null, files);
    this.branches.set(branch, sha);
    return sha;
  }

  files(ref: string): Record<string, string> {
    const sha = this.branches.get(ref) ?? ref;
    return Object.fromEntries([...this.commits.get(sha)!.tree].map(([path, blob]) => [path, this.blobs.get(blob)!]));
  }

  private ancestors(sha: string): string[] {
    const chain: string[] = [];
    for (let at: string | null = sha; at; at = this.commits.get(at)!.parent) chain.push(at);
    return chain;
  }

  private touches(sha: string, path: string): boolean {
    const { tree, parent } = this.commits.get(sha)!;
    const before = parent ? this.commits.get(parent)!.tree : new Map<string, string>();
    const under = (t: Tree) => [...t].filter(([p]) => p.startsWith(`${path}/`)).map(([p, s]) => `${p}:${s}`).sort().join();
    return under(tree) !== under(before);
  }

  client(): GitHubRepoClient {
    return {
      owner: this.owner,
      repo: this.repo,
      getBranchHead: async (branch) => this.branches.get(branch) ?? null,
      getTree: async (sha) => new Map(this.commits.get(sha)!.tree),
      getCommitMessage: async (sha) => this.commits.get(sha)!.message,
      getBlobText: async (sha) => this.blobs.get(sha)!,
      findOldestCommitTouching: async (path, ref) =>
        this.ancestors(this.branches.get(ref)!).filter((sha) => this.touches(sha, path)).at(-1) ?? null,
      commitTouchesPath: async (sha, path) => this.commits.has(sha) && this.touches(sha, path),
      listBranches: async () => [...this.branches.keys()],
      changedFilesSince: async (base, head) => {
        const baseAncestors = new Set(this.ancestors(this.branches.get(base)!));
        const mergeBase = this.ancestors(this.branches.get(head)!).find((sha) => baseAncestors.has(sha))!;
        const from = this.commits.get(mergeBase)!.tree;
        const to = this.commits.get(this.branches.get(head)!)!.tree;
        return [...new Set([...from.keys(), ...to.keys()])].filter((p) => from.get(p) !== to.get(p));
      },
      createCommit: async ({ parentSha, files, deletePaths, message }) =>
        this.commit(
          parentSha,
          {
            ...Object.fromEntries(files.map((f) => [f.path, f.content])),
            ...Object.fromEntries(deletePaths.map((p) => [p, null])),
          },
          message,
        ),
      setBranchHead: async (branch, sha) => {
        if (!this.branches.has(branch)) throw new GitHubApiError(422, "Reference does not exist");
        this.branches.set(branch, sha);
      },
      findOpenPullRequest: async (head, base) =>
        this.pulls.find((pr) => pr.head === head && pr.base === base && pr.state === "open") ?? null,
      updatePullRequest: async (number, update) => {
        const pr = this.pulls.find((p) => p.number === number)!;
        Object.assign(pr, update);
        return pr;
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures: an old full-template site, and the shell bundles it moves onto.
// ---------------------------------------------------------------------------

const OLD_PACKAGE_JSON = JSON.stringify(
  {
    name: "musician-site",
    private: true,
    scripts: { build: "next build" },
    dependencies: { next: "^15.2.0", react: "^19.0.0", zod: "^4.0.0" },
  },
  null,
  2,
);

const COLLECTION_V1 = JSON.stringify({ schemaVersion: 1, name: "pages" }, null, 2) + "\n";

/** What provisioning pushed before the stamp had a manifest. */
const TEMPLATE_PUSH: Record<string, string> = {
  "src/lib/content-store.ts": "export const store = 1;\n",
  "src/lib/collections/schema.ts": "export const schema = 1;\n",
  "src/components/Hero.tsx": "export default function Hero() { return null; }\n",
  "src/app/layout.tsx": "export default function Layout() { return null; }\n",
  "src/app/admin/page.tsx": "export default function Admin() { return null; }\n",
  "src/middleware.ts": "export function middleware() {}\n",
  "next.config.ts": "export default {};\n",
  "package.json": OLD_PACKAGE_JSON,
  "tsconfig.json": "{}\n",
  "eslint.config.mjs": "export default [];\n",
  "src/content/pages/_collection.json": COLLECTION_V1,
  "src/content/pages/home.json": '{"title":"Home"}\n',
  "public/images/hero.txt": "image\n",
  ".github/dependabot.yml": "version: 2\n",
  [TEMPLATE_STAMP_PATH]: '{"template":"musician-site","templateVersion":"0.0.1","createdAt":"2026-05-01T00:00:00.000Z"}\n',
};

function shellBundle(version: string): TemplateFile[] {
  return [
    {
      path: "package.json",
      content:
        JSON.stringify(
          {
            name: "musician-site",
            version: "0.0.1",
            private: true,
            stagecraft: { shellVersion: 1 },
            dependencies: { "@jclaw-labs/musician-site": version, next: "^15.5.27", react: "^19.0.0", "react-dom": "^19.0.0" },
          },
          null,
          2,
        ) + "\n",
    },
    { path: "next.config.ts", content: `import { withStagecraft } from "@jclaw-labs/musician-site/config"; // ${version}\nexport default withStagecraft({});\n` },
    { path: "src/middleware.ts", content: 'export { middleware } from "@jclaw-labs/musician-site/middleware";\n' },
    { path: "src/app/layout.tsx", content: 'export { default } from "@jclaw-labs/musician-site/layout";\n' },
    { path: "src/app/api/[...path]/route.ts", content: 'export { GET, POST } from "@jclaw-labs/musician-site/api";\n' },
    { path: "tsconfig.json", content: '{ "compilerOptions": {} }\n' },
    { path: "src/content/pages/home.json", content: '{"title":"Starter"}\n' },
  ];
}

/** A site the way provisioning left it: auto_init README, the template push, the workflow commit. */
function provisionedRepo(): { repo: FakeRepo; pushSha: string; workflowSha: string } {
  const repo = new FakeRepo();
  repo.commitOn("main", { "README.md": "# site\n" });
  const pushSha = repo.commitOn("main", TEMPLATE_PUSH);
  const workflowSha = repo.commitOn("main", { [SITE_AUTOMERGE_WORKFLOW_PATH]: "name: old\n" });
  return { repo, pushSha, workflowSha };
}

// ---------------------------------------------------------------------------
// Harness: the job row the step runner reads and writes, and the mocks.
// ---------------------------------------------------------------------------

let jobRow: { status: string; startedAt: Date | null; resultPayload: unknown };
let repo: FakeRepo;
let nextPrNumber: number;

function makeContext(): JobContext {
  return {
    job: {
      id: "job-1",
      siteId: "site-1",
      userId: "user-1",
      type: "upgrade_site",
      status: "running",
      requestPayload: null,
      resultPayload: null,
      errorMessage: null,
      failureCategory: null,
      repairAttempts: 0,
      retryAttempts: 0,
      runAt: null,
      lockedUntil: null,
      startedAt: jobRow.startedAt,
      completedAt: null,
      createdAt: new Date(),
    },
  };
}

/** Run the job as a fresh job row (each platform action queues a new job). */
async function runJob(fetchImpl = registryWith(1)) {
  jobRow = { status: "running", startedAt: new Date("2026-10-11T12:00:00Z"), resultPayload: null };
  return handleUpgradeSite(makeContext(), { fetchImpl });
}

/** A registry whose metadata for every version reads `schemaVersion`. */
function registryWith(schemaVersion: number) {
  return vi.fn(async () => new Response(JSON.stringify({ stagecraft: { schemaVersion } }), { status: 200 })) as unknown as typeof fetch;
}

function setProvisioningRecord(commitSha: string | null) {
  mocks.jobFindFirst.mockResolvedValue(
    commitSha
      ? { resultPayload: { steps: { pushTemplate: { state: "completed", attempts: 1, result: { commitSha, workflowPushed: true } } } } }
      : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  nextPrNumber = 7;
  jobRow = { status: "running", startedAt: new Date("2026-10-11T12:00:00Z"), resultPayload: null };
  mocks.jobFindUnique.mockImplementation(async () => ({ ...jobRow }));
  mocks.jobUpdateMany.mockImplementation(async ({ where, data }) => {
    if (where.status !== jobRow.status || where.startedAt !== jobRow.startedAt) return { count: 0 };
    jobRow = { ...jobRow, ...data };
    return { count: 1 };
  });
  mocks.siteFindUnique.mockResolvedValue({
    githubRepoOwner: "jclaw",
    githubRepoName: "stagecraft-site-sarah",
    githubDefaultBranch: "main",
  });
  mocks.checkGitHubToken.mockResolvedValue({ status: "ok", scopes: ["repo", "workflow"] } satisfies GitHubTokenCheck);
  mocks.readTemplateFiles.mockResolvedValue(shellBundle("1.0.0"));

  const provisioned = provisionedRepo();
  repo = provisioned.repo;
  setProvisioningRecord(provisioned.pushSha);

  mocks.githubRepoClient.mockImplementation(async () => repo.client());
  mocks.createBranch.mockImplementation(async (_userId, _owner, _repo, base: string, branch: string) => {
    repo.branches.set(branch, repo.branches.get(base)!);
  });
  mocks.createPullRequest.mockImplementation(async (_userId, _owner, _repo, options) => {
    const pr = { number: nextPrNumber++, htmlUrl: `https://github.com/jclaw/stagecraft-site-sarah/pull/${nextPrNumber - 1}`, state: "open", ...options };
    repo.pulls.push(pr);
    return { number: pr.number, htmlUrl: pr.htmlUrl, state: pr.state };
  });
});

describe("handleUpgradeSite — a clean site", () => {
  it("opens a pull request from stagecraft/upgrade that moves the site onto the package", async () => {
    const result = await runJob();

    expect(result).toMatchObject({
      success: true,
      data: {
        packageVersion: "1.0.0",
        pullRequest: { number: 7, url: "https://github.com/jclaw/stagecraft-site-sarah/pull/7", action: "opened" },
      },
    });
    expect(mocks.createPullRequest).toHaveBeenCalledWith("user-1", "jclaw", "stagecraft-site-sarah", expect.objectContaining({
      head: "stagecraft/upgrade",
      base: "main",
      title: "Upgrade to @jclaw-labs/musician-site 1.0.0",
    }));

    const files = repo.files("stagecraft/upgrade");
    // Our code is gone, the shell is in, the artist's files are untouched.
    expect(Object.keys(files).filter((p) => p.startsWith("src/lib/") || p.startsWith("src/components/"))).toEqual([]);
    expect(files["src/app/admin/page.tsx"]).toBeUndefined();
    expect(files["eslint.config.mjs"]).toBeUndefined();
    expect(files["src/app/api/[...path]/route.ts"]).toContain("@jclaw-labs/musician-site/api");
    expect(files["src/middleware.ts"]).toContain("@jclaw-labs/musician-site/middleware");
    expect(files["src/content/pages/home.json"]).toBe('{"title":"Home"}\n');
    expect(files["src/content/pages/_collection.json"]).toBe(COLLECTION_V1);
    expect(files["public/images/hero.txt"]).toBe("image\n");
    expect(files["README.md"]).toBe("# site\n");
    expect(JSON.parse(files["package.json"]).dependencies["@jclaw-labs/musician-site"]).toBe("1.0.0");

    // The stamp records the release and a manifest of the shell it wrote.
    const stamp = JSON.parse(files[TEMPLATE_STAMP_PATH]);
    expect(stamp.packageVersion).toBe("1.0.0");
    expect(stamp.createdAt).toBe("2026-05-01T00:00:00.000Z");
    expect(Object.keys(stamp.manifest).sort()).toEqual(
      ["next.config.ts", "package.json", "src/app/api/[...path]/route.ts", "src/app/layout.tsx", "src/middleware.ts", "tsconfig.json"],
    );
    expect(files[".github/dependabot.yml"]).toContain("@jclaw-labs/musician-site");
    expect(files[SITE_AUTOMERGE_WORKFLOW_PATH]).toContain("Dependabot auto-merge");

    // Nothing on main changes.
    expect(repo.files("main")["src/lib/content-store.ts"]).toBeDefined();
  });

  it("records each step on the job", async () => {
    await runJob();
    const steps = (jobRow.resultPayload as { steps: Record<string, { state: string }> }).steps;
    expect(Object.keys(steps)).toEqual(["checkBaseline", "commitUpgrade", "openPullRequest"]);
    expect(Object.values(steps).every((step) => step.state === "completed")).toBe(true);
  });

  it("reports a site already on the release as up to date, without a pull request", async () => {
    await runJob();
    repo.branches.set("main", repo.branches.get("stagecraft/upgrade")!);
    repo.pulls[0].state = "closed";
    mocks.createPullRequest.mockClear();

    const result = await runJob();

    expect(result).toMatchObject({ success: true, data: { packageVersion: "1.0.0", upToDate: true } });
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
  });
});

describe("handleUpgradeSite — a site Dependabot moved", () => {
  /** Migrate to 1.0.0, merge it, then let Dependabot pin the package at `pin`. */
  async function migratedThenBumped(pin: string) {
    await runJob();
    repo.branches.set("main", repo.branches.get("stagecraft/upgrade")!);
    repo.pulls[0].state = "closed";
    const pkg = JSON.parse(repo.files("main")["package.json"]);
    pkg.dependencies["@jclaw-labs/musician-site"] = pin;
    repo.commitOn("main", { "package.json": JSON.stringify(pkg, null, 2) + "\n" });
    mocks.createPullRequest.mockClear();
  }

  it("doesn't downgrade a site already past the platform's release", async () => {
    await migratedThenBumped("1.2.0");
    mocks.readTemplateFiles.mockResolvedValue(shellBundle("1.1.0"));
    const before = repo.branches.get("stagecraft/upgrade");

    const result = await runJob();

    expect(result).toMatchObject({ success: true, data: { packageVersion: "1.1.0", upToDate: true, currentVersion: "1.2.0" } });
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
    expect(repo.branches.get("stagecraft/upgrade")).toBe(before);
  });

  it("reports a site on the platform's release as up to date even though its stamp lags", async () => {
    await migratedThenBumped("1.0.1");
    mocks.readTemplateFiles.mockResolvedValue(shellBundle("1.0.1"));
    expect(JSON.parse(repo.files("main")[TEMPLATE_STAMP_PATH]).packageVersion).toBe("1.0.0");

    expect(await runJob()).toMatchObject({ success: true, data: { upToDate: true, currentVersion: "1.0.1" } });
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
  });

  it("still opens a pull request for a release past the site's", async () => {
    await migratedThenBumped("1.0.1");
    mocks.readTemplateFiles.mockResolvedValue(shellBundle("2.0.0"));

    expect(await runJob()).toMatchObject({ success: true, data: { packageVersion: "2.0.0", pullRequest: { action: "opened" } } });
  });
});

describe("handleUpgradeSite — customizations", () => {
  it("stops on a customized site and reports the changed files, opening no pull request", async () => {
    repo.commitOn("main", {
      "src/lib/content-store.ts": "export const store = 2; // mine\n",
      "src/components/Extra.tsx": "export {};\n",
      "src/middleware.ts": null,
    });

    const result = await runJob();

    expect(result).toMatchObject({
      success: false,
      failureCategory: "validation_error",
      data: {
        blocker: "customized",
        changedFiles: ["src/components/Extra.tsx", "src/lib/content-store.ts", "src/middleware.ts"],
      },
    });
    expect(result.message).toContain("3 files");
    expect(repo.branches.has("stagecraft/upgrade")).toBe(false);
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
  });

  it("doesn't count a Dependabot-bumped package.json as a customization", async () => {
    const bumped = JSON.parse(OLD_PACKAGE_JSON);
    bumped.dependencies.next = "^15.5.27";
    bumped.dependencies.zod = "^4.4.2";
    repo.commitOn("main", { "package.json": JSON.stringify(bumped, null, 2) });

    const result = await runJob();

    expect(result).toMatchObject({ success: true, data: { pullRequest: { action: "opened" } } });
  });

  it("counts a package.json change beyond versions as a customization", async () => {
    const edited = JSON.parse(OLD_PACKAGE_JSON);
    edited.scripts.postbuild = "node sitemap.js";
    repo.commitOn("main", { "package.json": JSON.stringify(edited, null, 2) });

    const result = await runJob();

    expect(result).toMatchObject({ success: false, data: { blocker: "customized", changedFiles: ["package.json"] } });
  });

  it("counts a dependency moved to a git spec as a customization", async () => {
    const forked = JSON.parse(OLD_PACKAGE_JSON);
    forked.dependencies.next = "github:sarah/next#patched";
    repo.commitOn("main", { "package.json": JSON.stringify(forked, null, 2) });

    expect(await runJob()).toMatchObject({ success: false, data: { blocker: "customized", changedFiles: ["package.json"] } });
  });

  it("lists a shell file it writes over the artist's edit in the pull request", async () => {
    repo.commitOn("main", { "tsconfig.json": '{ "compilerOptions": { "strict": true } }\n' });

    expect((await runJob()).success).toBe(true);
    expect(repo.files("stagecraft/upgrade")["tsconfig.json"]).toBe('{ "compilerOptions": {} }\n');
    expect(repo.pulls[0].body).toContain("- `tsconfig.json`");
  });

  it("doesn't list a shell file the artist never changed", async () => {
    await runJob();
    expect(repo.pulls[0].body).not.toContain("changed in your repository");
  });

  it("ignores changes to .github/, the stamp and lockfiles", async () => {
    repo.commitOn("main", {
      ".github/dependabot.yml": "version: 2 # edited\n",
      [TEMPLATE_STAMP_PATH]: '{"template":"musician-site","templateVersion":"0.0.2"}\n',
      "package-lock.json": '{"lockfileVersion":3}\n',
    });

    expect((await runJob()).success).toBe(true);
  });
});

describe("handleUpgradeSite — the baseline", () => {
  it("uses the oldest commit touching src/lib/ for a site without a manifest or a step record", async () => {
    setProvisioningRecord(null);

    const result = await runJob();

    expect(result).toMatchObject({ success: true, data: { pullRequest: { action: "opened" } } });
    expect(mocks.jobFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { siteId: "site-1", type: { in: ["create_site", "migrate_site"] } } }),
    );
  });

  it("ignores a step record pointing at a commit that doesn't touch src/lib/", async () => {
    // A resumed push can record the workflow commit.
    setProvisioningRecord(repo.branches.get("main")!);

    expect((await runJob()).success).toBe(true);
  });

  it("stops for a hand check when the step record touches src/lib/ but isn't the oldest such commit", async () => {
    const later = repo.commitOn("main", { "src/lib/content-store.ts": "export const store = 1; // again\n" });
    // Put the file back, so only the baseline disagrees, not the code.
    repo.commitOn("main", { "src/lib/content-store.ts": TEMPLATE_PUSH["src/lib/content-store.ts"] });
    setProvisioningRecord(later);

    const result = await runJob();

    expect(result).toMatchObject({ success: false, data: { blocker: "baseline_mismatch" } });
    expect(result.message).toContain(later);
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
  });

  it("compares a site against its stamp's manifest when it has one", async () => {
    // A site created with a manifest: the manifest lists our files.
    const manifest = Object.fromEntries(
      Object.entries(TEMPLATE_PUSH)
        .filter(([path]) => !path.startsWith("src/content/") && !path.startsWith("public/images/"))
        .map(([path, content]) => [path, gitBlobSha(content)]),
    );
    repo.commitOn("main", {
      [TEMPLATE_STAMP_PATH]: JSON.stringify({ template: "musician-site", templateVersion: "0.0.1", packageVersion: null, manifest, createdAt: "2026-10-01T00:00:00.000Z" }),
      // Outside the pre-manifest code paths, but in the manifest.
      "eslint.config.mjs": "export default [{ rules: {} }];\n",
    });
    // No src/lib/ history needed: the manifest is the baseline.
    setProvisioningRecord(null);

    const result = await runJob();

    expect(result).toMatchObject({ success: false, data: { blocker: "customized", changedFiles: ["eslint.config.mjs"] } });
  });
});

describe("handleUpgradeSite — re-runs and later majors", () => {
  it("updates the open pull request on a re-run instead of opening another", async () => {
    await runJob();
    const firstCommit = repo.branches.get("stagecraft/upgrade");
    repo.commitOn("main", { "src/content/pages/home.json": '{"title":"Home, edited"}\n' });

    const result = await runJob();

    expect(result).toMatchObject({ success: true, data: { pullRequest: { number: 7, action: "updated" } } });
    expect(repo.pulls).toHaveLength(1);
    expect(mocks.createPullRequest).toHaveBeenCalledTimes(1);
    expect(mocks.createBranch).toHaveBeenCalledTimes(1);
    expect(repo.branches.get("stagecraft/upgrade")).not.toBe(firstCommit);
    expect(repo.files("stagecraft/upgrade")["src/content/pages/home.json"]).toBe('{"title":"Home, edited"}\n');
  });

  it("stops rather than discard commits someone pushed to stagecraft/upgrade", async () => {
    await runJob();
    repo.commitOn("stagecraft/upgrade", { "src/content/pages/fix.json": "{}\n" });
    const pushed = repo.branches.get("stagecraft/upgrade");

    const result = await runJob();

    expect(result).toMatchObject({ success: false, failureCategory: "validation_error", data: { blocker: "upgrade_branch_changed" } });
    expect(repo.branches.get("stagecraft/upgrade")).toBe(pushed);
    expect(repo.pulls[0].state).toBe("open");
  });

  it("moves a branch that holds nothing of its own (a run that stopped after creating it)", async () => {
    repo.branches.set("stagecraft/upgrade", repo.branches.get("main")!);

    expect(await runJob()).toMatchObject({ success: true, data: { pullRequest: { action: "opened" } } });
    expect(repo.files("stagecraft/upgrade")["src/middleware.ts"]).toContain("@jclaw-labs/musician-site/middleware");
  });

  it("opens a new pull request for the next major once the first upgrade is merged", async () => {
    await runJob();
    repo.branches.set("main", repo.branches.get("stagecraft/upgrade")!);
    repo.pulls[0].state = "closed";
    mocks.readTemplateFiles.mockResolvedValue(shellBundle("2.0.0"));

    const result = await runJob();

    expect(result).toMatchObject({
      success: true,
      data: { packageVersion: "2.0.0", pullRequest: { number: 8, action: "opened" } },
    });
    const files = repo.files("stagecraft/upgrade");
    expect(JSON.parse(files["package.json"]).dependencies["@jclaw-labs/musician-site"]).toBe("2.0.0");
    expect(JSON.parse(files[TEMPLATE_STAMP_PATH]).packageVersion).toBe("2.0.0");
    expect(files["next.config.ts"]).toContain("2.0.0");
  });

  it("stops on a migrated site whose shell the artist changed", async () => {
    await runJob();
    repo.branches.set("main", repo.branches.get("stagecraft/upgrade")!);
    repo.pulls[0].state = "closed";
    repo.commitOn("main", { "src/app/layout.tsx": "export { default } from './mine';\n" });
    mocks.readTemplateFiles.mockResolvedValue(shellBundle("2.0.0"));

    expect(await runJob()).toMatchObject({ success: false, data: { blocker: "customized", changedFiles: ["src/app/layout.tsx"] } });
  });
});

describe("handleUpgradeSite — workflow and lockfile", () => {
  it("adds the auto-merge workflow to a repo missing it", async () => {
    repo.commitOn("main", { [SITE_AUTOMERGE_WORKFLOW_PATH]: null });

    await runJob();

    expect(repo.files("stagecraft/upgrade")[SITE_AUTOMERGE_WORKFLOW_PATH]).toContain("Dependabot auto-merge");
    expect(repo.pulls[0].body).toContain("which your repository didn't have");
  });

  it("doesn't mention the workflow as new when the repo has it", async () => {
    await runJob();
    expect(repo.pulls[0].body).not.toContain("which your repository didn't have");
  });

  it("deletes a committed lockfile", async () => {
    repo.commitOn("main", { "package-lock.json": '{"lockfileVersion":3}\n' });

    await runJob();

    expect(repo.files("stagecraft/upgrade")["package-lock.json"]).toBeUndefined();
    expect(repo.pulls[0].body).toContain("lockfile is deleted");
  });
});

describe("handleUpgradeSite — content upgrades", () => {
  it("rewrites content the target release needs upgraded, and asks for pending edits to be published", async () => {
    repo.branches.set("draft", repo.branches.get("main")!);
    repo.commitOn("draft", { "src/content/pages/home.json": '{"title":"Draft"}\n' });

    const result = await runJob(registryWith(2));

    expect(result.success).toBe(true);
    const collection = JSON.parse(repo.files("stagecraft/upgrade")["src/content/pages/_collection.json"]);
    expect(collection).toEqual({ schemaVersion: 2, name: "pages", upgraded: true });
    expect(repo.pulls[0].body).toContain("`src/content/pages/_collection.json`");
    expect(repo.pulls[0].body).toContain("publish or discard any edits");
  });

  it("opens no pull request while a draft has unpublished changes to a file the upgrade rewrites", async () => {
    repo.branches.set("draft-ed", repo.branches.get("main")!);
    repo.commitOn("draft-ed", { "src/content/pages/_collection.json": JSON.stringify({ schemaVersion: 1, name: "Pages!" }) });

    const result = await runJob(registryWith(2));

    expect(result).toMatchObject({ success: false, data: { blocker: "drafts_pending", draftBranches: ["draft-ed"] } });
    expect(repo.branches.has("stagecraft/upgrade")).toBe(false);
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
  });

  it("doesn't check drafts when the target release needs no content rewritten", async () => {
    repo.branches.set("draft", repo.branches.get("main")!);
    repo.commitOn("draft", { "src/content/pages/_collection.json": JSON.stringify({ schemaVersion: 1, name: "Pages!" }) });

    expect((await runJob(registryWith(1))).success).toBe(true);
    expect(repo.files("stagecraft/upgrade")["src/content/pages/_collection.json"]).toBe(COLLECTION_V1);
  });

  it("stops when the target reads a schemaVersion past the platform's upgraders", async () => {
    expect(await runJob(registryWith(3))).toMatchObject({ success: false, data: { blocker: "unsupported_schema" } });
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
  });
});

describe("handleUpgradeSite — credentials and preconditions", () => {
  it.each<[string, GitHubTokenCheck]>([
    ["stale", { status: "stale" }],
    ["missing the workflow scope", { status: "missing_scopes", missingScopes: ["workflow"] }],
    ["missing", { status: "missing" }],
  ])("asks the owner to sign in again when their token is %s", async (_label, check) => {
    mocks.checkGitHubToken.mockResolvedValue(check);

    const result = await runJob();

    expect(result).toMatchObject({
      success: false,
      message: REAUTH_MESSAGE,
      failureCategory: "github_api_error",
      data: { blocker: "reauth_required" },
    });
    expect(mocks.checkGitHubToken).toHaveBeenCalledWith("user-1", ["repo", "workflow"]);
    expect(mocks.githubRepoClient).not.toHaveBeenCalled();
  });

  it("asks the owner to sign in again when GitHub rejects the token part way", async () => {
    mocks.githubRepoClient.mockImplementation(async () => ({
      ...repo.client(),
      getBranchHead: async () => {
        throw new GitHubApiError(401, "Bad credentials");
      },
    }));

    expect(await runJob()).toMatchObject({ success: false, data: { blocker: "reauth_required" } });
  });

  it("stops when no release is on npm's latest yet (the bundle is the full template)", async () => {
    mocks.readTemplateFiles.mockResolvedValue([{ path: "package.json", content: OLD_PACKAGE_JSON }]);

    expect(await runJob()).toMatchObject({ success: false, data: { blocker: "no_release" } });
    expect(mocks.checkGitHubToken).not.toHaveBeenCalled();
  });

  it("fails a site with no repository", async () => {
    mocks.siteFindUnique.mockResolvedValue({ githubRepoOwner: null, githubRepoName: null, githubDefaultBranch: "main" });

    expect(await runJob()).toMatchObject({ success: false, message: "This site has no GitHub repository to upgrade" });
  });

  it("throws other errors back to the worker to retry, resuming at the unfinished step", async () => {
    mocks.createPullRequest.mockRejectedValueOnce(new GitHubApiError(502, "Bad gateway"));
    jobRow = { status: "running", startedAt: new Date("2026-10-11T12:00:00Z"), resultPayload: null };
    await expect(handleUpgradeSite(makeContext(), { fetchImpl: registryWith(1) })).rejects.toThrow("Bad gateway");
    const commitsBefore = repo.commits.size;

    // The worker re-queues the same job: same row, new claim.
    jobRow = { ...jobRow, status: "running", startedAt: new Date("2026-10-11T12:05:00Z") };
    const result = await handleUpgradeSite(makeContext(), { fetchImpl: registryWith(1) });

    expect(result).toMatchObject({ success: true, data: { pullRequest: { action: "opened" } } });
    // commitUpgrade finished on the first run and isn't repeated.
    expect(repo.commits.size).toBe(commitsBefore);
  });
});
