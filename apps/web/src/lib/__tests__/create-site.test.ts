import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JobContext } from "@stagecraft/queue";

const mockSiteUpdate = vi.fn();
const mockSiteDelete = vi.fn();
const mockSiteFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockIntegrationFindUnique = vi.fn();
const mockIntegrationFindMany = vi.fn();

vi.mock("@stagecraft/db", () => ({
  prisma: {
    site: { update: mockSiteUpdate, delete: mockSiteDelete, findUnique: mockSiteFindUnique },
    user: { findUnique: mockUserFindUnique },
    integrationAccount: {
      findUnique: mockIntegrationFindUnique,
      findMany: mockIntegrationFindMany,
    },
  },
}));

const mockCreateRepo = vi.fn();
const mockDeleteRepo = vi.fn();
const mockPushFiles = vi.fn();
const mockFindGithubAppInstallation = vi.fn();
vi.mock("@/lib/integrations/github", () => ({
  createRepo: mockCreateRepo,
  deleteRepo: mockDeleteRepo,
  pushFiles: mockPushFiles,
  findGithubAppInstallation: mockFindGithubAppInstallation,
}));

const mockCreateNetlifySite = vi.fn();
const mockSetNetlifyEnvVars = vi.fn();
vi.mock("@/lib/integrations/netlify", () => ({
  createSite: mockCreateNetlifySite,
  setEnvVars: mockSetNetlifyEnvVars,
}));

const mockCreateVercelProject = vi.fn();
const mockSetVercelEnvVars = vi.fn();
const mockTriggerVercelDeployment = vi.fn();
vi.mock("@/lib/integrations/vercel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/vercel")>();
  return {
    ...actual,
    createProject: mockCreateVercelProject,
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
  BINARY_EXTENSIONS: new Set(),
  TEMPLATE_SKIP_DIRS: new Set(),
  TEMPLATE_SKIP_FILES: new Set(),
}));

const { handleCreateSite } = await import("../jobs/create-site");

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
  mockPushFiles.mockResolvedValue({ commitSha: "abc123" });
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
  });

  it("marks site as error when no deploy-target integration is connected", async () => {
    mockIntegrationFindMany.mockResolvedValueOnce([]); // neither netlify nor vercel
    const result = await handleCreateSite(makeContext());
    expect(result.success).toBe(false);
    expect(result.message).toContain("No deploy-target integration");
    expect(mockCreateRepo).not.toHaveBeenCalled();
  });

  it("marks site as error when GitHub repo creation fails", async () => {
    mockCreateRepo.mockRejectedValueOnce(new Error("name already exists"));
    const result = await handleCreateSite(makeContext());
    expect(result.success).toBe(false);
    expect(result.message).toBe("name already exists");
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
        deployTarget: "netlify",
      }),
    });
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: expect.objectContaining({
        netlifySiteId: "netlify-123",
        netlifyAdminUrl: NETLIFY_SITE_RESULT.adminUrl,
        productionUrl: NETLIFY_SITE_RESULT.sslUrl,
        status: "active",
      }),
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

  it("marks site as error when Netlify project creation fails (no fallback recovery)", async () => {
    mockCreateNetlifySite.mockRejectedValue(new Error("Netlify quota exceeded"));

    const result = await handleCreateSite(makeContext());

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
      }),
    });
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: expect.objectContaining({
        vercelProjectId: "prj_abc123",
        vercelProjectName: "stagecraft-site-sarah-chen-music",
        vercelTeamId: null,
        productionUrl: VERCEL_PROJECT_RESULT.productionUrl,
        status: "active",
      }),
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

  it("marks site as error when Vercel project creation fails", async () => {
    mockCreateVercelProject.mockRejectedValue(new Error("Vercel name conflict"));

    const result = await handleCreateSite(makeContext());

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

describe("handleCreateSite — Vercel GitHub App not installed (rollback)", () => {
  beforeEach(() => {
    mockIntegrationFindMany.mockResolvedValue([{ provider: "vercel", metadata: null }]);
    mockSiteFindUnique.mockResolvedValue({
      githubRepoOwner: "jclaw",
      githubRepoName: "sarah-chen-music",
    });
  });

  it("deletes the GitHub repo + Site row + returns vercel_github_app_missing with installUrl", async () => {
    const { VercelGitHubAppNotInstalledError } = await import("@/lib/integrations/vercel");
    mockCreateVercelProject.mockRejectedValueOnce(new VercelGitHubAppNotInstalledError());

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.failureCategory).toBe("vercel_github_app_missing");
    expect(result.data).toMatchObject({
      installUrl: "https://github.com/apps/vercel/installations/new",
    });
    expect(mockDeleteRepo).toHaveBeenCalledWith("user-1", "jclaw", "sarah-chen-music");
    expect(mockSiteDelete).toHaveBeenCalledWith({ where: { id: "site-1" } });
    // The repo+site got rolled back, so we should NOT have called the
    // generic "mark site as error" branch (which would leave a row).
    expect(mockSiteUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "error" } }),
    );
  });

  it("still deletes the Site row when deleteRepo throws (best-effort GH cleanup)", async () => {
    // Real-world: GitHub may rate-limit, OAuth scope may have been
    // revoked between createRepo and the rollback. The Stagecraft slug
    // must still free up so the artist can retry on the same name.
    const { VercelGitHubAppNotInstalledError } = await import("@/lib/integrations/vercel");
    mockCreateVercelProject.mockRejectedValueOnce(new VercelGitHubAppNotInstalledError());
    mockDeleteRepo.mockRejectedValueOnce(new Error("GitHub API error (403)"));

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.failureCategory).toBe("vercel_github_app_missing");
    expect(mockSiteDelete).toHaveBeenCalledWith({ where: { id: "site-1" } });
  });

  it("skips deleteRepo when no githubRepo is on file yet (Vercel failed before repo creation finished)", async () => {
    mockSiteFindUnique.mockResolvedValueOnce({
      githubRepoOwner: null,
      githubRepoName: null,
    });
    const { VercelGitHubAppNotInstalledError } = await import("@/lib/integrations/vercel");
    mockCreateVercelProject.mockRejectedValueOnce(new VercelGitHubAppNotInstalledError());

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(false);
    expect(mockDeleteRepo).not.toHaveBeenCalled();
    expect(mockSiteDelete).toHaveBeenCalledWith({ where: { id: "site-1" } });
  });

  it("falls through to generic 'error' status for non-Vercel-app failures", async () => {
    mockCreateVercelProject.mockRejectedValueOnce(new Error("Vercel quota exceeded"));

    const result = await handleCreateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.failureCategory).not.toBe("vercel_github_app_missing");
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: { status: "error" },
    });
    // No rollback for unknown errors — the row is preserved so the user
    // can see what failed and the platform retains the audit trail.
    expect(mockSiteDelete).not.toHaveBeenCalled();
    expect(mockDeleteRepo).not.toHaveBeenCalled();
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
