import { describe, it, expect, vi, beforeEach, onTestFinished } from "vitest";
import type { JobContext } from "@stagecraft/queue";

const mockSiteUpdate = vi.fn();
const mockUserFindUnique = vi.fn();
const mockIntegrationFindUnique = vi.fn();
const mockIntegrationFindMany = vi.fn();
const mockJobFindUnique = vi.fn();
const mockJobUpdateMany = vi.fn();
vi.mock("@stagecraft/db", () => ({
  prisma: {
    siteJob: { findUnique: mockJobFindUnique, updateMany: mockJobUpdateMany },
    site: { update: mockSiteUpdate },
    user: { findUnique: mockUserFindUnique },
    integrationAccount: { findUnique: mockIntegrationFindUnique, findMany: mockIntegrationFindMany },
  },
}));

const mockCreateRepo = vi.fn();
const mockGetOwnRepo = vi.fn();
const mockPushFiles = vi.fn();
const mockFindGithubAppInstallation = vi.fn();
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

const mockFindAppInstallationForOwner = vi.fn();
vi.mock("@/lib/github-app-token", () => ({ findAppInstallationForOwner: mockFindAppInstallationForOwner }));

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
vi.mock("@/lib/integrations/resend", () => ({ getResendCredentials: mockGetResendCredentials }));

const mockCrawlSite = vi.fn();
vi.mock("@/lib/migration/crawler", () => ({ crawlSite: mockCrawlSite }));

const mockReadTemplateFiles = vi.fn();
vi.mock("@/lib/template-reader", () => ({ readTemplateFiles: mockReadTemplateFiles }));

// musician-site-mapper + report run for real (pure functions) so the test
// exercises the actual generated content shapes.
const { handleMigrateSite, MIGRATE_SITE_STEPS } = await import("../jobs/migrate-site");
const { handleCreateSite, CREATE_SITE_STEPS } = await import("../jobs/create-site");
const { MAX_RETRY_ATTEMPTS } = await import("@stagecraft/queue");

/** The job row the step runner reads and writes; persists across runs within a test. */
let jobRow: { status: string; startedAt: Date | null; resultPayload: unknown };

type StepRecords = Record<string, { state: string; attempts: number; result?: unknown }>;

function storedSteps(): StepRecords {
  return ((jobRow.resultPayload as { steps?: StepRecords } | null)?.steps ?? {}) as StepRecords;
}

const MIGRATE_PAYLOAD = {
  url: "https://old-band-site.example.com",
  name: "Old Band",
  slug: "old-band",
  blueprintType: "solo-artist",
};

function makeContext(overrides: Partial<JobContext["job"]> = {}): JobContext {
  return {
    job: {
      id: "job-1",
      siteId: "site-1",
      userId: "user-1",
      type: "migrate_site",
      status: "running",
      requestPayload: MIGRATE_PAYLOAD,
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

const EXTRACTED = {
  rootUrl: "https://old-band-site.example.com/",
  domain: "old-band-site.example.com",
  siteTitle: "Old Band",
  inferredName: "Old Band",
  socialLinks: [{ text: "Instagram", href: "https://instagram.com/oldband" }],
  pages: [
    {
      url: "https://old-band-site.example.com/",
      title: "Old Band",
      description: "We rock.",
      headings: ["Welcome"],
      paragraphs: ["We are a band.", "We play shows."],
      images: [],
      embeds: [],
      navLinks: [],
      rawText: "We are a band. We play shows.",
    },
    {
      url: "https://old-band-site.example.com/about",
      title: "About",
      description: "",
      headings: ["Our Story"],
      paragraphs: ["Formed in 2010."],
      images: [],
      embeds: [],
      navLinks: [],
      rawText: "Formed in 2010.",
    },
  ],
};

const HOME_ITEM = "src/content/collections/pages/items/home.json";

const NETLIFY_SITE = {
  siteId: "netlify-1",
  siteName: "stagecraft-site-old-band",
  adminUrl: "https://app.netlify.com/sites/stagecraft-site-old-band",
  sslUrl: "https://stagecraft-site-old-band.netlify.app",
};

const VERCEL_PROJECT = {
  projectId: "prj_1",
  projectName: "stagecraft-site-old-band",
  teamId: null,
  productionUrl: "https://stagecraft-site-old-band.vercel.app",
  adminUrl: "https://vercel.com/stagecraft-site-old-band",
};

function pushedPaths(call = 0): string[] {
  return (mockPushFiles.mock.calls[call][4] as Array<{ path: string }>).map((f) => f.path);
}

beforeEach(() => {
  vi.clearAllMocks();
  jobRow = { status: "running", startedAt: new Date("2026-10-09T12:00:00Z"), resultPayload: null };
  mockJobFindUnique.mockImplementation(async () => ({ ...jobRow }));
  mockJobUpdateMany.mockImplementation(async ({ where, data }) => {
    if (where.status !== jobRow.status || where.startedAt !== jobRow.startedAt) return { count: 0 };
    jobRow = { ...jobRow, ...data };
    return { count: 1 };
  });
  mockSiteUpdate.mockResolvedValue({});
  mockUserFindUnique.mockResolvedValue({ email: "artist@example.com" });
  mockIntegrationFindUnique.mockResolvedValue({ metadata: null });
  // Default: only Netlify connected → Netlify path.
  mockIntegrationFindMany.mockResolvedValue([{ provider: "netlify", metadata: null }]);
  mockCrawlSite.mockResolvedValue(EXTRACTED);
  mockCreateRepo.mockResolvedValue({ owner: "jclaw", name: "stagecraft-site-old-band", defaultBranch: "main" });
  mockGetOwnRepo.mockResolvedValue(null);
  mockReadTemplateFiles.mockResolvedValue([
    { path: "package.json", content: JSON.stringify({ name: "musician-site", version: "1.2.3" }) },
    { path: "src/app/(public)/page.tsx", content: "export default function Page() {}" },
    // A demo seed page item the crawled overlay must REPLACE (matching path).
    {
      path: HOME_ITEM,
      content: JSON.stringify({ id: "item_seed_home", values: { fld_pages_title: { type: "text", value: "Demo Home" } } }),
    },
  ]);
  mockPushFiles.mockResolvedValue({ commitSha: "abc123", changed: true });
  mockGetResendCredentials.mockResolvedValue({ apiKey: "re_test" });
  // No stagecraft-bot installation by default → no broker secret baked in.
  mockFindGithubAppInstallation.mockResolvedValue(null);
  mockFindAppInstallationForOwner.mockResolvedValue(null);
  mockFindNetlifySite.mockResolvedValue(null);
  mockCreateNetlifySite.mockResolvedValue(NETLIFY_SITE);
  mockSetNetlifyEnvVars.mockResolvedValue(undefined);
  mockFindVercelProject.mockResolvedValue(null);
  mockCreateVercelProject.mockResolvedValue(VERCEL_PROJECT);
  mockSetVercelEnvVars.mockResolvedValue(undefined);
  mockTriggerVercelDeployment.mockResolvedValue({ deploymentId: "dpl_1" });
});

describe("handleMigrateSite — content overlay", () => {
  it("pushes musician-site overlay content + scaffold, then deploys and marks the site active", async () => {
    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(true);

    // Two pushes: main scaffold/content, then the auto-merge workflow on its own.
    expect(mockPushFiles).toHaveBeenCalledTimes(2);
    const mainPaths = pushedPaths(0);
    // musician-site unified-collection overlay paths (not legacy Astro paths).
    expect(mainPaths).toContain("src/content/collections/site/items/_singleton.json");
    expect(mainPaths).toContain(HOME_ITEM);
    expect(mainPaths).toContain("src/content/collections/pages/items/_order.json");
    expect(mainPaths).toContain(".github/dependabot.yml");
    expect(mainPaths).toContain(".stagecraft-template.json");
    expect(mainPaths).toContain("package.json"); // template file preserved
    expect(mainPaths).not.toContain(".github/workflows/dependabot-auto-merge.yml");
    expect(mainPaths).not.toContain("src/content/pages/home.md"); // legacy path gone
    expect(mockPushFiles.mock.calls[0][5]).toBe("Migrate site from https://old-band-site.example.com");

    // The overlay REPLACES the demo seed home item (same path), not duplicates it.
    const homeItems = (mockPushFiles.mock.calls[0][4] as Array<{ path: string; content: string }>).filter(
      (f) => f.path === HOME_ITEM,
    );
    expect(homeItems).toHaveLength(1);
    expect(homeItems[0].content).toContain("Welcome"); // crawled heading, not the demo seed
    expect(homeItems[0].content).not.toContain("Demo Home");

    expect(pushedPaths(1)).toEqual([".github/workflows/dependabot-auto-merge.yml"]);

    // Netlify site created and given the runtime env vars.
    expect(mockCreateNetlifySite).toHaveBeenCalledTimes(1);
    expect(mockCreateVercelProject).not.toHaveBeenCalled();
    expect(mockSetNetlifyEnvVars.mock.calls[0][2]).toMatchObject({
      ADMIN_EMAIL: "artist@example.com",
      STAGECRAFT_SITE_ID: "site-1",
      RESEND_API_KEY: "re_test",
    });

    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: { status: "active", productionUrl: NETLIFY_SITE.sslUrl },
    });
    expect(result.data).toMatchObject({
      deployTarget: "netlify",
      sourceUrl: MIGRATE_PAYLOAD.url,
      githubUrl: "https://github.com/jclaw/stagecraft-site-old-band",
      productionUrl: NETLIFY_SITE.sslUrl,
      netlifySiteId: "netlify-1",
      pagesCrawled: 2,
      report: expect.objectContaining({ pagesCrawled: 2 }),
    });
  });

  it("deploys via Vercel when Vercel is connected, as create_site does", async () => {
    mockIntegrationFindMany.mockResolvedValue([
      { provider: "netlify", metadata: null },
      { provider: "vercel", metadata: null },
    ]);

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(true);
    expect(mockCreateVercelProject).toHaveBeenCalledTimes(1);
    expect(mockCreateNetlifySite).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ deployTarget: "vercel", vercelProjectId: "prj_1" });
  });

  it("still migrates when the auto-merge workflow push fails (missing `workflow` scope)", async () => {
    mockPushFiles
      .mockResolvedValueOnce({ commitSha: "main", changed: true })
      .mockRejectedValueOnce(new Error("refusing to allow an OAuth App ... without `workflow` scope"));

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(true);
    expect(mockPushFiles).toHaveBeenCalledTimes(2);
    expect(mockCreateNetlifySite).toHaveBeenCalledTimes(1);
  });
});

describe("handleMigrateSite — shares create_site's provisioning", () => {
  it("runs the create_site steps after crawling", () => {
    expect(MIGRATE_SITE_STEPS).toEqual(["crawlSource", ...CREATE_SITE_STEPS]);
  });

  it("makes the same provisioning calls as create_site; only the pushed content differs", async () => {
    // The template stamp records when it was written; keep that the same for both runs.
    vi.useFakeTimers({ now: new Date("2026-10-09T12:00:00Z"), toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    await handleCreateSite(
      makeContext({ type: "create_site", requestPayload: { name: "Old Band", slug: "old-band", blueprintType: "solo-artist" } }),
    );
    const createPush = mockPushFiles.mock.calls[0][4] as Array<{ path: string; content: string }>;
    const createHostCall = mockCreateNetlifySite.mock.calls[0][0];
    const createEnv = mockSetNetlifyEnvVars.mock.calls[0][2];

    vi.clearAllMocks();
    jobRow = { status: "running", startedAt: new Date("2026-10-09T12:00:00Z"), resultPayload: null };
    await handleMigrateSite(makeContext());
    const migratePush = mockPushFiles.mock.calls[0][4] as Array<{ path: string; content: string }>;

    expect(Object.keys(storedSteps())).toEqual([...MIGRATE_SITE_STEPS]);
    expect(mockCreateNetlifySite.mock.calls[0][0]).toEqual(createHostCall);
    expect(mockSetNetlifyEnvVars.mock.calls[0][2]).toEqual(createEnv);

    // create_site pushes the template's demo home item; migrate_site replaces it.
    const home = (files: Array<{ path: string; content: string }>) => files.find((f) => f.path === HOME_ITEM)!.content;
    expect(home(createPush)).toContain("Demo Home");
    expect(home(migratePush)).not.toContain("Demo Home");
    // Everything outside the overlay is the same.
    const overlay = new Set(
      (storedSteps().crawlSource.result as { files: Array<{ path: string }> }).files.map((f) => f.path),
    );
    const outside = (files: Array<{ path: string; content: string }>) => files.filter((f) => !overlay.has(f.path));
    expect(outside(migratePush)).toEqual(outside(createPush));
  });
});

describe("handleMigrateSite — preconditions", () => {
  it("fails the job and marks the site error when required payload fields are missing", async () => {
    const result = await handleMigrateSite(makeContext({ requestPayload: { name: "Old Band" } }));

    expect(result).toEqual({ success: false, message: "Missing required payload fields: url, name, slug" });
    expect(mockSiteUpdate).toHaveBeenCalledWith({ where: { id: "site-1" }, data: { status: "error" } });
    expect(mockCrawlSite).not.toHaveBeenCalled();
  });

  it("fails before crawling when the user has no verified email", async () => {
    mockUserFindUnique.mockResolvedValue({ email: null });

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.message).toContain("verified email");
    expect(mockCrawlSite).not.toHaveBeenCalled();
    expect(mockSiteUpdate).toHaveBeenCalledWith({ where: { id: "site-1" }, data: { status: "error" } });
  });

  it("fails before crawling when Resend isn't connected", async () => {
    mockGetResendCredentials.mockResolvedValue(null);

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.message).toBe(
      "Resend account not connected — connect Resend at /settings before migrating a site",
    );
    expect(mockCrawlSite).not.toHaveBeenCalled();
    expect(mockCreateRepo).not.toHaveBeenCalled();
  });

  it("fails before crawling when no deploy target is connected", async () => {
    mockIntegrationFindMany.mockResolvedValue([]);

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Vercel or Netlify/);
    expect(mockCrawlSite).not.toHaveBeenCalled();
  });

  it("fails without retrying, and marks the site error, when the source site yields no pages", async () => {
    mockCrawlSite.mockResolvedValueOnce({ ...EXTRACTED, pages: [] });

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.message).toContain("Could not fetch any pages from https://old-band-site.example.com");
    expect(mockCreateRepo).not.toHaveBeenCalled();
    expect(mockSiteUpdate).toHaveBeenCalledWith({ where: { id: "site-1" }, data: { status: "error" } });
  });
});

describe("handleMigrateSite — resumable steps", () => {
  it("a mid-flow failure is thrown for a retry, and the next run resumes from the failed step", async () => {
    mockCreateNetlifySite
      .mockRejectedValueOnce(new Error("Netlify 503")) // linked create
      .mockRejectedValueOnce(new Error("Netlify 503")); // unlinked fallback

    await expect(handleMigrateSite(makeContext())).rejects.toThrow("Netlify 503");
    // Still `creating` while the worker retries.
    expect(mockSiteUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "error" } }));
    expect(storedSteps().crawlSource).toMatchObject({ state: "completed" });
    expect(storedSteps().createHostProject).toMatchObject({ state: "started", attempts: 1 });

    const result = await handleMigrateSite(makeContext({ retryAttempts: 1 }));

    expect(result.success).toBe(true);
    // The finished steps aren't repeated: one crawl, one repo, one push pair.
    expect(mockCrawlSite).toHaveBeenCalledTimes(1);
    expect(mockCreateRepo).toHaveBeenCalledTimes(1);
    expect(mockPushFiles).toHaveBeenCalledTimes(2);
    expect(mockFindNetlifySite).toHaveBeenCalledWith("user-1", "stagecraft-site-old-band.netlify.app");
    expect(storedSteps().createHostProject).toMatchObject({ state: "completed", attempts: 2 });
    // The report comes from the stored crawl.
    expect(result.data).toMatchObject({ pagesCrawled: 2, report: expect.objectContaining({ pagesCrawled: 2 }) });
    // The finished job doesn't keep the crawled files.
    const steps = (result.data as { steps: StepRecords }).steps;
    expect(steps.crawlSource).toMatchObject({ state: "completed" });
    expect(steps.crawlSource).not.toHaveProperty("result");
  });

  it("marks the site error and keeps progress when the last attempt fails", async () => {
    mockPushFiles.mockRejectedValueOnce(new Error("GitHub API error (502)"));

    const result = await handleMigrateSite(makeContext({ retryAttempts: MAX_RETRY_ATTEMPTS }));

    expect(result.success).toBe(false);
    expect(result.message).toBe("GitHub API error (502)");
    expect(result.data).toMatchObject({
      steps: {
        crawlSource: { state: "completed" },
        createRepo: { state: "completed" },
        pushTemplate: { state: "started" },
      },
    });
    expect(mockSiteUpdate).toHaveBeenCalledWith({ where: { id: "site-1" }, data: { status: "error" } });
  });
});
