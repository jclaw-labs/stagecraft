import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JobContext } from "@stagecraft/queue";

const mockSiteUpdate = vi.fn();
const mockSiteDelete = vi.fn();
const mockSiteFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockIntegrationFindUnique = vi.fn();
const mockIntegrationFindMany = vi.fn();
const mockJobFindUnique = vi.fn();
const mockJobUpdateMany = vi.fn();

vi.mock("@stagecraft/db", () => ({
  prisma: {
    siteJob: { findUnique: mockJobFindUnique, updateMany: mockJobUpdateMany },
    site: { update: mockSiteUpdate, delete: mockSiteDelete, findUnique: mockSiteFindUnique },
    user: { findUnique: mockUserFindUnique },
    integrationAccount: {
      findUnique: mockIntegrationFindUnique,
      findMany: mockIntegrationFindMany,
    },
  },
}));

const mockCreateRepo = vi.fn();
const mockPushFiles = vi.fn();
const mockFindGithubAppInstallation = vi.fn();
const mockGetOwnRepo = vi.fn();
vi.mock("@/lib/integrations/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/github")>();
  return {
    GitHubApiError: actual.GitHubApiError,
    createRepo: mockCreateRepo,
    getOwnRepo: mockGetOwnRepo,
    pushFiles: mockPushFiles,
    findGithubAppInstallation: mockFindGithubAppInstallation,
  };
});

const mockCreateNetlifySite = vi.fn();
const mockFindNetlifySite = vi.fn();
const mockSetNetlifyEnvVars = vi.fn();
vi.mock("@/lib/integrations/netlify", () => ({
  createSite: mockCreateNetlifySite,
  findSite: mockFindNetlifySite,
  setEnvVars: mockSetNetlifyEnvVars,
}));

const mockCreateVercelProject = vi.fn();
const mockFindVercelProject = vi.fn();
const mockSetVercelEnvVars = vi.fn();
const mockTriggerVercelDeployment = vi.fn();
vi.mock("@/lib/integrations/vercel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/vercel")>();
  return {
    ...actual,
    createProject: mockCreateVercelProject,
    findProject: mockFindVercelProject,
    setEnvVars: mockSetVercelEnvVars,
    triggerDeployment: mockTriggerVercelDeployment,
  };
});

const mockGetResendCredentials = vi.fn();
vi.mock("@/lib/integrations/resend", () => ({
  getResendCredentials: mockGetResendCredentials,
  RESEND_SANDBOX_FROM: "onboarding@resend.dev",
}));

const mockReadTemplateFiles = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/template-reader", () => ({
  readTemplateFiles: mockReadTemplateFiles,
}));

const { handleCreateSite, CREATE_SITE_STEPS } = await import("../jobs/create-site");
const { LeaseLostError, MAX_RETRY_ATTEMPTS } = await import("@stagecraft/queue");
const { GitHubApiError } = await import("@/lib/integrations/github");

/**
 * The job row the step runner reads and writes. Persists across
 * handleCreateSite calls within a test, the way the database does across
 * runs of the same job.
 */
let jobRow: { status: string; startedAt: Date | null; resultPayload: unknown };

type StepRecords = Record<string, { state: string; attempts: number; startedAt?: string; result?: unknown }>;

function storedSteps(): StepRecords {
  return ((jobRow.resultPayload as { steps?: StepRecords } | null)?.steps ?? {}) as StepRecords;
}

/** Seed progress an earlier run left behind. */
function seedSteps(steps: StepRecords) {
  jobRow.resultPayload = { steps };
}

/** When a seeded step's first attempt started, for the adopt-by-creation-time checks. */
const STEP_STARTED_AT = "2026-10-09T11:00:00.000Z";

const ORIGINAL_ENV = { ...process.env };

function makeContext(overrides = {}): JobContext {
  return {
    job: {
      id: "job-1",
      siteId: "site-1",
      userId: "user-1",
      type: "create_site",
      status: "running",
      requestPayload: { name: "Sarah Chen Music", slug: "sarah-chen-music", blueprintType: "solo-artist" },
      resultPayload: null,
      errorMessage: null,
      failureCategory: null,
      repairAttempts: 0,
      retryAttempts: 0,
      runAt: null,
      lockedUntil: null,
      startedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
      ...overrides,
    },
  };
}

const REPO_RESULT = {
  owner: "jclaw",
  name: "sarah-chen-music",
  fullName: "jclaw/sarah-chen-music",
  htmlUrl: "https://github.com/jclaw/sarah-chen-music",
  cloneUrl: "https://github.com/jclaw/sarah-chen-music.git",
  defaultBranch: "main",
};

const NETLIFY_SITE_RESULT = {
  siteId: "netlify-123",
  siteName: "stagecraft-site-sarah-chen-music",
  url: "https://stagecraft-site-sarah-chen-music.netlify.app",
  adminUrl: "https://app.netlify.com/sites/stagecraft-site-sarah-chen-music",
  sslUrl: "https://stagecraft-site-sarah-chen-music.netlify.app",
};

const VERCEL_PROJECT_RESULT = {
  projectId: "prj_abc123",
  projectName: "stagecraft-site-sarah-chen-music",
  teamId: null,
  productionUrl: "https://stagecraft-site-sarah-chen-music.vercel.app",
  adminUrl: "https://vercel.com/stagecraft-site-sarah-chen-music",
};

beforeEach(() => {
  vi.clearAllMocks();
  jobRow = { status: "running", startedAt: new Date("2026-10-09T12:00:00Z"), resultPayload: null };
  mockJobFindUnique.mockImplementation(async () => ({ ...jobRow }));
  mockJobUpdateMany.mockImplementation(async ({ where, data }) => {
    if (where.status !== jobRow.status || where.startedAt !== jobRow.startedAt) return { count: 0 };
    jobRow = { ...jobRow, ...data };
    return { count: 1 };
  });
  mockFindNetlifySite.mockResolvedValue(null);
  mockFindVercelProject.mockResolvedValue(null);
  mockGetOwnRepo.mockResolvedValue(null);
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_URL: "https://stagecraft.test",
    // Override the artist-site broker URL away from the prod default
    // so these tests don't depend on (or coincide with) the hardcoded
    // production URL in platform-url.ts.
    STAGECRAFT_PUBLIC_URL: "https://stagecraft.test",
  };
  mockSiteUpdate.mockResolvedValue({});
  mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "artist@example.com" });
  mockIntegrationFindUnique.mockResolvedValue({ accessToken: "token" });
  // Default: only Netlify connected → Netlify path
  mockIntegrationFindMany.mockResolvedValue([{ provider: "netlify", metadata: null }]);
  mockSetNetlifyEnvVars.mockResolvedValue(undefined);
  mockSetVercelEnvVars.mockResolvedValue(undefined);
  mockTriggerVercelDeployment.mockResolvedValue({ deploymentId: "dpl_test" });
  mockGetResendCredentials.mockResolvedValue({ apiKey: "re_test" });
  mockCreateRepo.mockResolvedValue(REPO_RESULT);
  mockPushFiles.mockResolvedValue({ commitSha: "abc123", changed: true });
  // Default: Netlify's GitHub App is installed on the artist's account
  // (15980838); the Stagecraft bot App is not (null) so existing tests
  // continue to exercise the post-/create install-callback path.
  mockFindGithubAppInstallation.mockImplementation(async (_userId, appSlug) =>
    appSlug === "netlify" ? 15980838 : null,
  );
  mockCreateNetlifySite.mockResolvedValue(NETLIFY_SITE_RESULT);
  mockCreateVercelProject.mockResolvedValue(VERCEL_PROJECT_RESULT);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("handleCreateSite — common preconditions", () => {
  it("returns failure for missing payload", async () => {
    const result = await handleCreateSite(makeContext({ requestPayload: {} }));
    expect(result.success).toBe(false);
    expect(result.message).toContain("Missing required payload");
    expect(mockSiteUpdate).toHaveBeenCalledWith({ where: { id: "site-1" }, data: { status: "error" } });
  });

  it("marks site as error when no deploy-target integration is connected", async () => {
    mockIntegrationFindMany.mockResolvedValueOnce([]); // neither netlify nor vercel
    const result = await handleCreateSite(makeContext());
    expect(result.success).toBe(false);
    expect(result.message).toContain("No deploy-target integration");
    expect(mockCreateRepo).not.toHaveBeenCalled();
  });

  it("fails without retrying when the repo name is already taken on a first attempt", async () => {
    mockCreateRepo.mockRejectedValueOnce(new GitHubApiError(422, '{"message":"name already exists"}'));
    const result = await handleCreateSite(makeContext());
    expect(result.success).toBe(false);
    expect(result.message).toContain("name already exists");
    // Not an earlier run's repo, so it isn't adopted.
    expect(mockGetOwnRepo).not.toHaveBeenCalled();
    expect(mockSiteUpdate).toHaveBeenCalledWith({ where: { id: "site-1" }, data: { status: "error" } });
  });
});

describe("handleCreateSite — Netlify path (only Netlify connected)", () => {
  beforeEach(() => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "netlify", metadata: null }]);
  });

  it("happy path: creates linked Netlify site, persists deployTarget=netlify, marks active", async () => {
    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      deployTarget: "netlify",
      githubUrl: "https://github.com/jclaw/sarah-chen-music",
      netlifySiteId: "netlify-123",
      netlifyAdminUrl: NETLIFY_SITE_RESULT.adminUrl,
    });

    expect(mockCreateNetlifySite).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: expect.objectContaining({
          provider: "github",
          repo_path: "jclaw/sarah-chen-music",
          repo_branch: "main",
          cmd: "npm run build",
          dir: ".next",
        }),
      }),
    );
    expect(mockCreateVercelProject).not.toHaveBeenCalled();

    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: expect.objectContaining({
        githubRepoOwner: "jclaw",
        githubRepoName: "sarah-chen-music",
      }),
    });
    // Project ids land as soon as the project exists, so deleting the site
    // cleans it up even if a later step fails.
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: expect.objectContaining({
        deployTarget: "netlify",
        netlifySiteId: "netlify-123",
        netlifyAdminUrl: NETLIFY_SITE_RESULT.adminUrl,
      }),
    });
    expect(mockSiteUpdate).toHaveBeenLastCalledWith({
      where: { id: "site-1" },
      data: { productionUrl: NETLIFY_SITE_RESULT.sslUrl, status: "active" },
    });
  });

  it("provisions runtime env vars on Netlify (the four artist-site vars)", async () => {
    await handleCreateSite(makeContext());

    expect(mockSetNetlifyEnvVars).toHaveBeenCalledTimes(1);
    const [envUserId, envSiteId, envVars] = mockSetNetlifyEnvVars.mock.calls[0];
    expect(envUserId).toBe("user-1");
    expect(envSiteId).toBe("netlify-123");
    // The artist template defaults STAGECRAFT_PLATFORM_URL (prod URL),
    // derives MAGIC_LINK_SIGNING_SECRET from STAGECRAFT_BROKER_SECRET,
    // and defaults MAGIC_LINK_FROM to the Resend sandbox — none of
    // those land in the per-site env-var bundle anymore.
    expect(envVars).toEqual({
      ADMIN_EMAIL: "artist@example.com",
      STAGECRAFT_SITE_ID: "site-1",
      RESEND_API_KEY: "re_test",
    });
  });

  it("passes the GitHub-side Netlify App installation_id into createNetlifySite", async () => {
    mockFindGithubAppInstallation.mockResolvedValueOnce(15980838);

    await handleCreateSite(makeContext());

    expect(mockFindGithubAppInstallation).toHaveBeenCalledWith(
      "user-1",
      "netlify",
      "jclaw",
    );
    expect(mockCreateNetlifySite).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: expect.objectContaining({ installation_id: 15980838 }),
      }),
    );
  });

  it("omits installation_id when Netlify's GitHub App isn't installed (createSite still attempted)", async () => {
    mockFindGithubAppInstallation.mockResolvedValue(null);

    await handleCreateSite(makeContext());

    const createCall = mockCreateNetlifySite.mock.calls[0][0];
    expect(createCall.repo).not.toHaveProperty("installation_id");
  });

  it("falls back to plain Netlify site when repo linking fails", async () => {
    mockCreateNetlifySite
      .mockRejectedValueOnce(new Error("installation_id required"))
      .mockResolvedValueOnce(NETLIFY_SITE_RESULT);

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).netlifyLinkUrl).toBe(
      "https://app.netlify.com/projects/stagecraft-site-sarah-chen-music/link",
    );
    expect(mockCreateNetlifySite).toHaveBeenCalledTimes(2);
    expect(mockCreateNetlifySite).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ repo: expect.anything() }),
    );
  });

  it("surfaces envWarning when env-var provisioning fails (site still active)", async () => {
    mockSetNetlifyEnvVars.mockRejectedValueOnce(new Error("Netlify rate limit"));

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).envWarning).toBe("Netlify rate limit");
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: expect.objectContaining({ status: "active" }),
    });
  });

  it("marks site as error when Netlify project creation fails on the last attempt (no fallback recovery)", async () => {
    mockCreateNetlifySite.mockRejectedValue(new Error("Netlify quota exceeded"));

    const result = await handleCreateSite(makeContext({ retryAttempts: MAX_RETRY_ATTEMPTS }));

    expect(result.success).toBe(false);
    expect(result.message).toBe("Netlify quota exceeded");
  });
});

describe("handleCreateSite — Vercel path (Vercel connected)", () => {
  beforeEach(() => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
  });

  it("happy path: creates Vercel project with the GitHub repo + nextjs framework", async () => {
    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      deployTarget: "vercel",
      githubUrl: "https://github.com/jclaw/sarah-chen-music",
      vercelProjectId: "prj_abc123",
      vercelProjectName: "stagecraft-site-sarah-chen-music",
      productionUrl: VERCEL_PROJECT_RESULT.productionUrl,
    });
    expect(mockCreateVercelProject).toHaveBeenCalledWith({
      userId: "user-1",
      name: "stagecraft-site-sarah-chen-music",
      teamId: undefined,
      repo: { repo: "jclaw/sarah-chen-music" },
      framework: "nextjs",
    });
    expect(mockCreateNetlifySite).not.toHaveBeenCalled();

    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: expect.objectContaining({
        deployTarget: "vercel",
        vercelProjectId: "prj_abc123",
        vercelProjectName: "stagecraft-site-sarah-chen-music",
        vercelTeamId: null,
      }),
    });
    expect(mockSiteUpdate).toHaveBeenLastCalledWith({
      where: { id: "site-1" },
      data: { productionUrl: VERCEL_PROJECT_RESULT.productionUrl, status: "active" },
    });
  });

  it("provisions runtime env vars on Vercel using the project id", async () => {
    await handleCreateSite(makeContext());

    expect(mockSetVercelEnvVars).toHaveBeenCalledTimes(1);
    const [args] = mockSetVercelEnvVars.mock.calls[0];
    expect(args.userId).toBe("user-1");
    expect(args.projectId).toBe("prj_abc123");
    expect(args.vars).toEqual({
      ADMIN_EMAIL: "artist@example.com",
      STAGECRAFT_SITE_ID: "site-1",
      RESEND_API_KEY: "re_test",
    });
  });

  it("forwards teamId from IntegrationAccount.metadata into both create + setEnvVars", async () => {
    mockIntegrationFindMany.mockResolvedValue([
      { provider: "vercel", metadata: { teamId: "team_xyz" } },
    ]);
    mockIntegrationFindUnique.mockResolvedValue({
      metadata: { teamId: "team_xyz" },
    });
    mockCreateVercelProject.mockResolvedValue({
      ...VERCEL_PROJECT_RESULT,
      teamId: "team_xyz",
    });

    await handleCreateSite(makeContext());

    expect(mockCreateVercelProject).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team_xyz" }),
    );
    const [args] = mockSetVercelEnvVars.mock.calls[0];
    expect(args.teamId).toBe("team_xyz");
  });

  it("surfaces envWarning when Vercel env-var provisioning fails (site still active)", async () => {
    mockSetVercelEnvVars.mockRejectedValueOnce(new Error("Vercel rate limit"));

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).envWarning).toBe("Vercel rate limit");
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: expect.objectContaining({ status: "active" }),
    });
  });

  it("marks site as error when Vercel project creation fails on the last attempt", async () => {
    mockCreateVercelProject.mockRejectedValue(new Error("Vercel name conflict"));

    const result = await handleCreateSite(makeContext({ retryAttempts: MAX_RETRY_ATTEMPTS }));

    expect(result.success).toBe(false);
    expect(result.message).toBe("Vercel name conflict");
  });

  it("triggers a Vercel deployment after env vars are set", async () => {
    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect(mockTriggerVercelDeployment).toHaveBeenCalledTimes(1);
    expect(mockTriggerVercelDeployment).toHaveBeenCalledWith(
      "user-1",
      "prj_abc123",
      undefined,
    );
  });

  it("surfaces envWarning when deploy trigger fails (site still active)", async () => {
    mockTriggerVercelDeployment.mockRejectedValueOnce(new Error("Vercel deploy hook 500"));

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).envWarning).toBe("Vercel deploy hook 500");
  });
});

describe("handleCreateSite — Vercel GitHub App not installed", () => {
  beforeEach(() => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
  });

  it("fails with vercel_github_app_missing + installUrl, marks the site error and keeps the repo", async () => {
    const { VercelGitHubAppNotInstalledError } = await import("@/lib/integrations/vercel");
    mockCreateVercelProject.mockRejectedValueOnce(new VercelGitHubAppNotInstalledError());

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.failureCategory).toBe("vercel_github_app_missing");
    expect(result.data).toMatchObject({
      installUrl: "https://github.com/apps/vercel/installations/new",
      steps: {
        createRepo: { state: "completed" },
        pushTemplate: { state: "completed" },
        createHostProject: { state: "started" },
      },
    });
    expect(mockSiteUpdate).toHaveBeenCalledWith({ where: { id: "site-1" }, data: { status: "error" } });
    // The site and its repo stay so a retry can pick up at createHostProject.
    expect(mockSiteDelete).not.toHaveBeenCalled();
  });

  it("a retry after installing the App resumes at createHostProject", async () => {
    const { VercelGitHubAppNotInstalledError } = await import("@/lib/integrations/vercel");
    mockCreateVercelProject.mockRejectedValueOnce(new VercelGitHubAppNotInstalledError());
    const failed = await handleCreateSite(makeContext());
    // The worker stores the failure's data as the job's resultPayload.
    jobRow.resultPayload = failed.data;

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect(mockCreateRepo).toHaveBeenCalledTimes(1);
    expect(mockPushFiles).toHaveBeenCalledTimes(2); // main + workflow, first run only
    expect(mockFindVercelProject).toHaveBeenCalledWith("user-1", "stagecraft-site-sarah-chen-music", undefined);
    expect(mockCreateVercelProject).toHaveBeenCalledTimes(2);
  });

  it("other Vercel failures on the last attempt mark the site error without the install hint", async () => {
    mockCreateVercelProject.mockRejectedValueOnce(new Error("Vercel quota exceeded"));

    const result = await handleCreateSite(makeContext({ retryAttempts: MAX_RETRY_ATTEMPTS }));

    expect(result.success).toBe(false);
    expect(result.failureCategory).toBeUndefined();
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: { status: "error" },
    });
  });
});

describe("handleCreateSite — resumable steps", () => {
  it("records every step, in order, on the job and in the result", async () => {
    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect(Object.keys(storedSteps())).toEqual([...CREATE_SITE_STEPS]);
    for (const step of CREATE_SITE_STEPS) {
      expect(storedSteps()[step]).toMatchObject({ state: "completed", attempts: 1 });
    }
    expect(storedSteps().createRepo.result).toEqual({
      owner: "jclaw",
      name: "sarah-chen-music",
      defaultBranch: "main",
    });
    expect((result.data as { steps: StepRecords }).steps).toEqual(storedSteps());
  });

  it("creates the artist's repo as private", async () => {
    await handleCreateSite(makeContext());

    expect(mockCreateRepo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(String), isPrivate: true }),
    );
  });

  it("never stores the broker secret's plaintext", async () => {
    mockFindGithubAppInstallation.mockImplementation(async (_uid, slug) =>
      slug === "stagecraft-bot" ? 129023518 : null,
    );

    await handleCreateSite(makeContext());

    const plaintext = mockSetNetlifyEnvVars.mock.calls[0][2].STAGECRAFT_BROKER_SECRET as string;
    expect(plaintext).toMatch(/^scbs_/);
    expect(JSON.stringify(jobRow.resultPayload)).not.toContain(plaintext);
    expect(JSON.stringify(jobRow.resultPayload)).not.toContain("re_test");
  });

  it("skips steps an earlier run completed", async () => {
    seedSteps({
      createRepo: {
        state: "completed",
        attempts: 1,
        result: { owner: "jclaw", name: "sarah-chen-music", defaultBranch: "main" },
      },
      pushTemplate: { state: "completed", attempts: 1, result: { commitSha: "abc", workflowPushed: true } },
      findInstallation: { state: "completed", attempts: 1, result: null },
    });

    const result = await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(result.success).toBe(true);
    expect(mockCreateRepo).not.toHaveBeenCalled();
    expect(mockPushFiles).not.toHaveBeenCalled();
    expect(mockFindGithubAppInstallation).not.toHaveBeenCalledWith("user-1", "stagecraft-bot", "jclaw");
    expect(mockCreateNetlifySite).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: expect.objectContaining({ repo_path: "jclaw/sarah-chen-music" }),
      }),
    );
  });

  it("a mid-flow failure is thrown for a retry, and the next run resumes from the failed step", async () => {
    mockCreateNetlifySite
      .mockRejectedValueOnce(new Error("Netlify 503")) // linked create
      .mockRejectedValueOnce(new Error("Netlify 503")); // unlinked fallback

    await expect(handleCreateSite(makeContext())).rejects.toThrow("Netlify 503");
    // Still `creating` while the worker retries.
    expect(mockSiteUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "error" } }));
    expect(storedSteps().createHostProject).toMatchObject({ state: "started", attempts: 1 });

    const result = await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(result.success).toBe(true);
    expect(mockCreateRepo).toHaveBeenCalledTimes(1);
    expect(mockPushFiles).toHaveBeenCalledTimes(2);
    // The interrupted step first looks for a site the failed run may have made.
    expect(mockFindNetlifySite).toHaveBeenCalledWith("user-1", "stagecraft-site-sarah-chen-music.netlify.app");
    expect(storedSteps().createHostProject).toMatchObject({ state: "completed", attempts: 2 });
  });

  it("marks the site error and keeps progress when the last attempt fails", async () => {
    mockSetNetlifyEnvVars.mockResolvedValue(undefined);
    mockPushFiles.mockRejectedValueOnce(new Error("GitHub API error (502)"));

    const result = await handleCreateSite(makeContext({ retryAttempts: MAX_RETRY_ATTEMPTS }));

    expect(result.success).toBe(false);
    expect(result.message).toBe("GitHub API error (502)");
    expect(result.data).toMatchObject({
      steps: { createRepo: { state: "completed" }, pushTemplate: { state: "started" } },
    });
    expect(mockSiteUpdate).toHaveBeenCalledWith({ where: { id: "site-1" }, data: { status: "error" } });
  });

  it("adopts the repo an interrupted createRepo already made", async () => {
    seedSteps({ createRepo: { state: "started", attempts: 1, startedAt: STEP_STARTED_AT } });
    mockCreateRepo.mockRejectedValueOnce(new GitHubApiError(422, '{"message":"name already exists"}'));
    mockGetOwnRepo.mockResolvedValueOnce({ ...REPO_RESULT, createdAt: "2026-10-09T11:00:05Z" });

    const result = await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(result.success).toBe(true);
    expect(mockGetOwnRepo).toHaveBeenCalledWith("user-1", "stagecraft-site-sarah-chen-music");
    expect(storedSteps().createRepo).toMatchObject({ state: "completed", attempts: 2 });
  });

  it("doesn't adopt a same-named repo that predates the step (retry after a first-attempt 422)", async () => {
    // The first attempt failed on "name already exists" for a repo that was
    // never this job's; the retry sees the step as interrupted.
    seedSteps({ createRepo: { state: "started", attempts: 1, startedAt: STEP_STARTED_AT } });
    mockCreateRepo.mockRejectedValueOnce(new GitHubApiError(422, '{"message":"name already exists"}'));
    mockGetOwnRepo.mockResolvedValueOnce({ ...REPO_RESULT, createdAt: "2025-01-01T00:00:00Z" });

    const result = await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(result.success).toBe(false);
    expect(result.message).toContain("name already exists");
    expect(mockPushFiles).not.toHaveBeenCalled();
  });

  it("adopts the Vercel project an interrupted createHostProject already made", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
    seedSteps({
      createRepo: {
        state: "completed",
        attempts: 1,
        result: { owner: "jclaw", name: "sarah-chen-music", defaultBranch: "main" },
      },
      pushTemplate: { state: "completed", attempts: 1, result: { commitSha: "abc", workflowPushed: true } },
      findInstallation: { state: "completed", attempts: 1, result: null },
      mintBrokerSecret: { state: "completed", attempts: 1, result: { minted: false } },
      createHostProject: { state: "started", attempts: 1, startedAt: STEP_STARTED_AT },
    });
    mockFindVercelProject.mockResolvedValueOnce({ ...VERCEL_PROJECT_RESULT, createdAt: Date.parse("2026-10-09T11:00:05Z") });

    const result = await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(result.success).toBe(true);
    expect(mockCreateVercelProject).not.toHaveBeenCalled();
    expect(mockSetVercelEnvVars).toHaveBeenCalledWith(expect.objectContaining({ projectId: "prj_abc123" }));
  });

  it("creates a new Vercel project rather than adopting a same-named one that predates the step", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
    seedSteps({
      createRepo: {
        state: "completed",
        attempts: 1,
        result: { owner: "jclaw", name: "sarah-chen-music", defaultBranch: "main" },
      },
      pushTemplate: { state: "completed", attempts: 1, result: { commitSha: "abc", workflowPushed: true } },
      findInstallation: { state: "completed", attempts: 1, result: null },
      mintBrokerSecret: { state: "completed", attempts: 1, result: { minted: false } },
      createHostProject: { state: "started", attempts: 1, startedAt: STEP_STARTED_AT },
    });
    mockFindVercelProject.mockResolvedValueOnce({ ...VERCEL_PROJECT_RESULT, projectId: "prj_old", createdAt: Date.parse("2025-01-01T00:00:00Z") });

    await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(mockCreateVercelProject).toHaveBeenCalled();
    expect(mockSetVercelEnvVars).not.toHaveBeenCalledWith(expect.objectContaining({ projectId: "prj_old" }));
  });

  it("adopts the Netlify site an interrupted createHostProject already made", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "netlify", metadata: null }]);
    seedSteps({
      createRepo: {
        state: "completed",
        attempts: 1,
        result: { owner: "jclaw", name: "sarah-chen-music", defaultBranch: "main" },
      },
      pushTemplate: { state: "completed", attempts: 1, result: { commitSha: "abc", workflowPushed: true } },
      findInstallation: { state: "completed", attempts: 1, result: null },
      mintBrokerSecret: { state: "completed", attempts: 1, result: { minted: false } },
      createHostProject: { state: "started", attempts: 1, startedAt: STEP_STARTED_AT },
    });
    mockFindNetlifySite.mockResolvedValueOnce({ ...NETLIFY_SITE_RESULT, linked: true, createdAt: "2026-10-09T11:00:05Z" });

    const result = await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(result.success).toBe(true);
    expect(mockCreateNetlifySite).not.toHaveBeenCalled();
  });

  it("creates a new Netlify site rather than adopting a same-named one that predates the step", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "netlify", metadata: null }]);
    seedSteps({
      createRepo: {
        state: "completed",
        attempts: 1,
        result: { owner: "jclaw", name: "sarah-chen-music", defaultBranch: "main" },
      },
      pushTemplate: { state: "completed", attempts: 1, result: { commitSha: "abc", workflowPushed: true } },
      findInstallation: { state: "completed", attempts: 1, result: null },
      mintBrokerSecret: { state: "completed", attempts: 1, result: { minted: false } },
      createHostProject: { state: "started", attempts: 1, startedAt: STEP_STARTED_AT },
    });
    mockFindNetlifySite.mockResolvedValueOnce({ ...NETLIFY_SITE_RESULT, linked: true, createdAt: "2025-01-01T00:00:00Z" });

    await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(mockCreateNetlifySite).toHaveBeenCalled();
  });

  it("overwrites the Netlify env vars when resuming an interrupted setEnv", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "netlify", metadata: null }]);
    seedSteps({
      createRepo: {
        state: "completed",
        attempts: 1,
        result: { owner: "jclaw", name: "sarah-chen-music", defaultBranch: "main" },
      },
      pushTemplate: { state: "completed", attempts: 1, result: { commitSha: "abc", workflowPushed: true } },
      findInstallation: { state: "completed", attempts: 1, result: 129023518 },
      mintBrokerSecret: { state: "completed", attempts: 1, result: { minted: true } },
      createHostProject: {
        state: "completed",
        attempts: 1,
        result: {
          deployTarget: "netlify",
          productionUrl: NETLIFY_SITE_RESULT.sslUrl,
          adminUrl: NETLIFY_SITE_RESULT.adminUrl,
          netlifySiteId: "netlify-123",
        },
      },
      setEnv: { state: "started", attempts: 1, startedAt: STEP_STARTED_AT },
    });

    const result = await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(result.success).toBe(true);
    expect(mockSetNetlifyEnvVars).toHaveBeenCalledWith(
      "user-1",
      "netlify-123",
      expect.objectContaining({ STAGECRAFT_BROKER_SECRET: expect.any(String) }),
      { replace: true },
    );
  });

  it("mints a fresh broker secret when resuming after the mint step but before setEnv", async () => {
    seedSteps({
      createRepo: {
        state: "completed",
        attempts: 1,
        result: { owner: "jclaw", name: "sarah-chen-music", defaultBranch: "main" },
      },
      pushTemplate: { state: "completed", attempts: 1, result: { commitSha: "abc", workflowPushed: true } },
      findInstallation: { state: "completed", attempts: 1, result: 129023518 },
      mintBrokerSecret: { state: "completed", attempts: 1, result: { minted: true } },
      createHostProject: {
        state: "completed",
        attempts: 1,
        result: {
          deployTarget: "netlify",
          productionUrl: NETLIFY_SITE_RESULT.sslUrl,
          adminUrl: NETLIFY_SITE_RESULT.adminUrl,
          netlifySiteId: "netlify-123",
        },
      },
    });

    const result = await handleCreateSite(makeContext({ retryAttempts: 1 }));

    expect(result.success).toBe(true);
    expect(mockCreateNetlifySite).not.toHaveBeenCalled();
    const envVars = mockSetNetlifyEnvVars.mock.calls[0][2];
    expect(envVars.STAGECRAFT_BROKER_SECRET).toMatch(/^scbs_[0-9a-f]{64}$/);
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: { githubInstallationId: 129023518, brokerSecretHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
  });

  it("stops without touching the site when the run no longer owns the job", async () => {
    jobRow.status = "canceled";

    await expect(handleCreateSite(makeContext())).rejects.toBeInstanceOf(LeaseLostError);
    expect(mockCreateRepo).not.toHaveBeenCalled();
    expect(mockSiteUpdate).not.toHaveBeenCalled();
  });

  it("stops at the next step boundary when the lease is lost mid-run", async () => {
    mockCreateRepo.mockImplementationOnce(async () => {
      jobRow.startedAt = new Date("2026-10-09T12:10:00Z"); // reaped and re-claimed elsewhere
      return REPO_RESULT;
    });

    await expect(handleCreateSite(makeContext())).rejects.toBeInstanceOf(LeaseLostError);
    expect(mockPushFiles).not.toHaveBeenCalled();
    expect(mockSiteUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "error" } }));
  });
});

describe("handleCreateSite — broker secret upfront provisioning", () => {
  it("when stagecraft-bot installation is found, generates broker secret + bakes it into env vars + stores hash on Site", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
    mockFindGithubAppInstallation.mockImplementation(async (_uid, slug) =>
      slug === "stagecraft-bot" ? 129023518 : null,
    );

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    const envVarsCall = mockSetVercelEnvVars.mock.calls[0][0];
    expect(envVarsCall.vars.STAGECRAFT_BROKER_SECRET).toMatch(/^scbs_[0-9a-f]{64}$/);
    const updateCalls = mockSiteUpdate.mock.calls;
    const brokerUpdate = updateCalls.find(([arg]) => arg.data?.brokerSecretHash);
    expect(brokerUpdate).toBeDefined();
    expect(brokerUpdate![0].data.githubInstallationId).toBe(129023518);
    expect(brokerUpdate![0].data.brokerSecretHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("when stagecraft-bot installation is NOT found, omits broker secret env var (artist clicks install link later)", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
    mockFindGithubAppInstallation.mockResolvedValue(null);

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    const envVarsCall = mockSetVercelEnvVars.mock.calls[0][0];
    expect(envVarsCall.vars).not.toHaveProperty("STAGECRAFT_BROKER_SECRET");
    const updateCalls = mockSiteUpdate.mock.calls;
    const brokerUpdate = updateCalls.find(([arg]) => arg.data?.brokerSecretHash);
    expect(brokerUpdate).toBeUndefined();
  });
});

describe("handleCreateSite — per-artist Resend provisioning", () => {
  it("provisions RESEND_API_KEY from artist's Resend account (MAGIC_LINK_FROM defaults inside the template)", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
    mockGetResendCredentials.mockResolvedValue({ apiKey: "re_artist_specific" });

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    const envVarsCall = mockSetVercelEnvVars.mock.calls[0][0];
    expect(envVarsCall.vars.RESEND_API_KEY).toBe("re_artist_specific");
    // MAGIC_LINK_FROM is intentionally NOT provisioned — the template
    // defaults to the Resend sandbox sender, which works for every
    // artist without a verified domain. Only provisioned when the
    // artist sets a custom sender (future).
    expect(envVarsCall.vars.MAGIC_LINK_FROM).toBeUndefined();
  });

  it("ADMIN_EMAIL comes from User.email (set by Resend connect)", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: "verified-via-resend@artist.com" });

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    const envVarsCall = mockSetVercelEnvVars.mock.calls[0][0];
    expect(envVarsCall.vars.ADMIN_EMAIL).toBe("verified-via-resend@artist.com");
  });

  it("fails the job when User.email is missing (Resend never connected)", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
    mockUserFindUnique.mockResolvedValue({ id: "user-1", email: null });

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.message).toContain("verified email");
    expect(mockCreateRepo).not.toHaveBeenCalled();
  });

  it("fails the job when Resend isn't connected (the route gate is the primary check; this defends against a race)", async () => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
    mockGetResendCredentials.mockResolvedValue(null);

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.message).toContain("Resend");
    expect(mockSetVercelEnvVars).not.toHaveBeenCalled();
  });
});

describe("handleCreateSite — Vercel preferred when both connected", () => {
  it("picks vercel when both vercel and netlify integrations are connected", async () => {
    mockIntegrationFindMany.mockResolvedValue([
      { provider: "netlify", metadata: null },
      { provider: "vercel", metadata: null },
    ]);

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect(mockCreateVercelProject).toHaveBeenCalledTimes(1);
    expect(mockCreateNetlifySite).not.toHaveBeenCalled();
    expect((result.data as Record<string, unknown>).deployTarget).toBe("vercel");
  });
});

describe("handleCreateSite — site scaffold (dependency hygiene)", () => {
  it("ships the Dependabot config + stamp in the main push and the workflow separately", async () => {
    // Stub the template read so we can assert the stamped version flows
    // through from the template's package.json.
    mockReadTemplateFiles.mockResolvedValueOnce([
      { path: "package.json", content: JSON.stringify({ name: "musician-site", version: "9.9.9" }) },
    ]);

    const result = await handleCreateSite(makeContext());
    expect(result.success).toBe(true);

    // Two pushes: the main scaffold, then the auto-merge workflow on its own
    // (it lives under .github/workflows/ and needs the `workflow` OAuth scope,
    // so it can't ride the atomic main commit).
    expect(mockPushFiles).toHaveBeenCalledTimes(2);

    const mainPaths = (mockPushFiles.mock.calls[0][4] as Array<{ path: string }>).map((f) => f.path);
    expect(mainPaths).toContain(".github/dependabot.yml");
    expect(mainPaths).toContain(".stagecraft-template.json");
    expect(mainPaths).toContain("package.json");
    expect(mainPaths).not.toContain(".github/workflows/dependabot-auto-merge.yml");

    const mainFiles = mockPushFiles.mock.calls[0][4] as Array<{ path: string; content: string }>;
    const stamp = mainFiles.find((f) => f.path === ".stagecraft-template.json");
    expect(JSON.parse(stamp!.content)).toMatchObject({
      template: "musician-site",
      templateVersion: "9.9.9",
    });

    const workflowPaths = (mockPushFiles.mock.calls[1][4] as Array<{ path: string }>).map((f) => f.path);
    expect(workflowPaths).toEqual([".github/workflows/dependabot-auto-merge.yml"]);
  });

  it("still creates the site when the workflow push fails (e.g. missing `workflow` scope)", async () => {
    mockPushFiles
      .mockResolvedValueOnce({ commitSha: "main" }) // main scaffold push succeeds
      .mockRejectedValueOnce(new Error("refusing to allow an OAuth App ... without `workflow` scope"));

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(true);
    expect(mockPushFiles).toHaveBeenCalledTimes(2);
    // Site is still marked active despite the best-effort workflow push failing.
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: expect.objectContaining({ status: "active" }),
    });
  });
});
