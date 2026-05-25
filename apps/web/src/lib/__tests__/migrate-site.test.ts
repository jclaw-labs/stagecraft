import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobContext } from "@stagecraft/queue";

const mockSiteUpdate = vi.fn();
const mockUserFindUnique = vi.fn();
vi.mock("@stagecraft/db", () => ({
  prisma: { site: { update: mockSiteUpdate }, user: { findUnique: mockUserFindUnique } },
}));

const mockGenerateBrokerSecret = vi.fn();
vi.mock("@/lib/broker-secret", () => ({ generateBrokerSecret: mockGenerateBrokerSecret }));

const mockCreateRepo = vi.fn();
const mockPushFiles = vi.fn();
const mockFindGithubAppInstallation = vi.fn();
vi.mock("@/lib/integrations/github", () => ({
  createRepo: mockCreateRepo,
  pushFiles: mockPushFiles,
  findGithubAppInstallation: mockFindGithubAppInstallation,
}));

const mockFindAppInstallationForOwner = vi.fn();
vi.mock("@/lib/github-app-token", () => ({ findAppInstallationForOwner: mockFindAppInstallationForOwner }));

const mockGetResendCredentials = vi.fn();
vi.mock("@/lib/integrations/resend", () => ({ getResendCredentials: mockGetResendCredentials }));

const mockCrawlSite = vi.fn();
vi.mock("@/lib/migration/crawler", () => ({ crawlSite: mockCrawlSite }));

const mockReadTemplateFiles = vi.fn();
vi.mock("@/lib/template-reader", () => ({ readTemplateFiles: mockReadTemplateFiles }));

const mockPickDeployTarget = vi.fn();
const mockDeployToNetlify = vi.fn();
const mockDeployToVercel = vi.fn();
vi.mock("@/lib/jobs/create-site", () => ({
  pickDeployTarget: mockPickDeployTarget,
  deployToNetlify: mockDeployToNetlify,
  deployToVercel: mockDeployToVercel,
}));

// musician-site-mapper + report run for real (pure functions) so the test
// exercises the actual generated content shapes.
const { handleMigrateSite } = await import("../jobs/migrate-site");

function makeContext(): JobContext {
  return {
    job: {
      id: "job-1",
      siteId: "site-1",
      userId: "user-1",
      type: "migrate_site",
      status: "running",
      requestPayload: {
        url: "https://old-band-site.example.com",
        name: "Old Band",
        slug: "old-band",
        blueprintType: "solo-artist",
      },
      resultPayload: null,
      errorMessage: null,
      failureCategory: null,
      repairAttempts: 0,
      startedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockSiteUpdate.mockResolvedValue({});
  mockUserFindUnique.mockResolvedValue({ email: "artist@example.com" });
  mockCrawlSite.mockResolvedValue(EXTRACTED);
  mockCreateRepo.mockResolvedValue({ owner: "jclaw", name: "stagecraft-site-old-band", defaultBranch: "main" });
  mockReadTemplateFiles.mockResolvedValue([
    { path: "package.json", content: JSON.stringify({ name: "musician-site", version: "1.2.3" }) },
    { path: "src/app/(public)/page.tsx", content: "export default function Page() {}" },
  ]);
  mockPushFiles.mockResolvedValue({ commitSha: "abc123" });
  mockGetResendCredentials.mockResolvedValue({ apiKey: "re_test" });
  // No stagecraft-bot installation by default → no broker secret baked in.
  mockFindGithubAppInstallation.mockResolvedValue(null);
  mockFindAppInstallationForOwner.mockResolvedValue(null);
  mockGenerateBrokerSecret.mockReturnValue({ hash: "hash", plaintext: "scbs_test" });
  mockPickDeployTarget.mockResolvedValue("netlify");
  mockDeployToNetlify.mockResolvedValue({
    productionUrl: "https://stagecraft-site-old-band.netlify.app",
    adminUrl: "https://app.netlify.com/sites/stagecraft-site-old-band",
    netlifySiteId: "netlify-1",
  });
  mockDeployToVercel.mockResolvedValue({
    productionUrl: "https://stagecraft-site-old-band.vercel.app",
    adminUrl: "https://vercel.com/stagecraft-site-old-band",
    vercelProjectId: "prj_1",
    vercelProjectName: "stagecraft-site-old-band",
    vercelTeamId: null,
  });
});

describe("handleMigrateSite — retarget to musician-site", () => {
  it("pushes musician-site overlay content + scaffold, then deploys via the chosen target", async () => {
    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(true);

    // Two pushes: main scaffold/content, then the auto-merge workflow on its own.
    expect(mockPushFiles).toHaveBeenCalledTimes(2);
    const mainPaths = (mockPushFiles.mock.calls[0][4] as Array<{ path: string }>).map((f) => f.path);
    // musician-site unified-collection overlay paths (not legacy Astro paths).
    expect(mainPaths).toContain("src/content/collections/site/items/_singleton.json");
    expect(mainPaths).toContain("src/content/collections/pages/items/home.json");
    expect(mainPaths).toContain("src/content/collections/pages/items/_order.json");
    expect(mainPaths).toContain(".github/dependabot.yml");
    expect(mainPaths).toContain(".stagecraft-template.json");
    expect(mainPaths).toContain("package.json"); // template file preserved
    expect(mainPaths).not.toContain(".github/workflows/dependabot-auto-merge.yml");
    expect(mainPaths).not.toContain("src/content/pages/home.md"); // legacy path gone

    const workflowPaths = (mockPushFiles.mock.calls[1][4] as Array<{ path: string }>).map((f) => f.path);
    expect(workflowPaths).toEqual([".github/workflows/dependabot-auto-merge.yml"]);

    // Stamp records the new template.
    const stamp = (mockPushFiles.mock.calls[0][4] as Array<{ path: string; content: string }>).find(
      (f) => f.path === ".stagecraft-template.json",
    );
    expect(JSON.parse(stamp!.content).template).toBe("musician-site");

    // Deployed via the create-site Netlify path with the runtime env vars.
    expect(mockDeployToNetlify).toHaveBeenCalledTimes(1);
    expect(mockDeployToVercel).not.toHaveBeenCalled();
    expect(mockDeployToNetlify.mock.calls[0][0].envVars).toMatchObject({
      ADMIN_EMAIL: "artist@example.com",
      STAGECRAFT_SITE_ID: "site-1",
      RESEND_API_KEY: "re_test",
    });

    // Site marked active.
    expect(mockSiteUpdate).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: expect.objectContaining({ status: "active", productionUrl: expect.any(String) }),
    });
  });

  it("deploys via Vercel when that's the chosen target", async () => {
    mockPickDeployTarget.mockResolvedValue("vercel");

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(true);
    expect(mockDeployToVercel).toHaveBeenCalledTimes(1);
    expect(mockDeployToNetlify).not.toHaveBeenCalled();
  });

  it("returns failure when the source site yields no pages", async () => {
    mockCrawlSite.mockResolvedValueOnce({ ...EXTRACTED, pages: [] });

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(false);
    expect(mockPushFiles).not.toHaveBeenCalled();
    expect(mockDeployToNetlify).not.toHaveBeenCalled();
  });

  it("fails when the user has no verified email", async () => {
    mockUserFindUnique.mockResolvedValue({ email: null });

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(false);
    expect(result.message).toContain("verified email");
    expect(mockCreateRepo).not.toHaveBeenCalled();
  });

  it("still migrates when the auto-merge workflow push fails (missing `workflow` scope)", async () => {
    mockPushFiles
      .mockResolvedValueOnce({ commitSha: "main" })
      .mockRejectedValueOnce(new Error("refusing to allow an OAuth App ... without `workflow` scope"));

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(true);
    expect(mockPushFiles).toHaveBeenCalledTimes(2);
    expect(mockDeployToNetlify).toHaveBeenCalledTimes(1);
  });
});
