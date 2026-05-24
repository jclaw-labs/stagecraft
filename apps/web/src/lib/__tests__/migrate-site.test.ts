import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobContext } from "@stagecraft/queue";

const mockSiteUpdate = vi.fn();
vi.mock("@stagecraft/db", () => ({
  prisma: { site: { update: mockSiteUpdate } },
}));

const mockCreateRepo = vi.fn();
const mockPushFiles = vi.fn();
vi.mock("@/lib/integrations/github", () => ({
  createRepo: mockCreateRepo,
  pushFiles: mockPushFiles,
}));

const mockCreateNetlifySite = vi.fn();
vi.mock("@/lib/integrations/netlify", () => ({
  createSite: mockCreateNetlifySite,
}));

const mockCrawlSite = vi.fn();
vi.mock("@/lib/migration/crawler", () => ({ crawlSite: mockCrawlSite }));

const mockMapExtractedContent = vi.fn();
vi.mock("@/lib/migration/mapper", () => ({ mapExtractedContent: mockMapExtractedContent }));

const mockBuildMigrationReport = vi.fn();
vi.mock("@/lib/migration/report", () => ({ buildMigrationReport: mockBuildMigrationReport }));

const mockReadTemplateFiles = vi.fn();
vi.mock("@/lib/template-reader", () => ({ readTemplateFiles: mockReadTemplateFiles }));

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

beforeEach(() => {
  vi.clearAllMocks();
  mockSiteUpdate.mockResolvedValue({});
  mockCrawlSite.mockResolvedValue({ pages: [{ url: "https://old-band-site.example.com" }] });
  mockMapExtractedContent.mockReturnValue({
    files: [{ path: "src/content/pages/home.md", content: "# home" }],
  });
  mockBuildMigrationReport.mockReturnValue({ pagesMapped: 1, overallConfidence: 0.9 });
  mockCreateRepo.mockResolvedValue({
    owner: "jclaw",
    name: "stagecraft-site-old-band",
    defaultBranch: "main",
  });
  mockReadTemplateFiles.mockResolvedValue([
    { path: "package.json", content: JSON.stringify({ name: "musician-site", version: "1.2.3" }) },
    { path: "src/pages/index.astro", content: "---\n---\n" },
  ]);
  mockPushFiles.mockResolvedValue({ commitSha: "abc123" });
  mockCreateNetlifySite.mockResolvedValue({
    siteId: "netlify-1",
    adminUrl: "https://app.netlify.com/sites/stagecraft-site-old-band",
    sslUrl: "https://stagecraft-site-old-band.netlify.app",
  });
});

describe("handleMigrateSite — site scaffold (dependency hygiene)", () => {
  it("injects the legacy-template Dependabot config + stamp alongside the migrated content", async () => {
    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(true);
    // Main push (template base + mapped content + scaffold), then the
    // auto-merge workflow on its own.
    expect(mockPushFiles).toHaveBeenCalledTimes(2);

    const pushedFiles = mockPushFiles.mock.calls[0][4] as Array<{ path: string; content: string }>;
    const paths = pushedFiles.map((f) => f.path);
    expect(paths).toContain("src/content/pages/home.md");
    expect(paths).toContain(".github/dependabot.yml");
    expect(paths).toContain(".stagecraft-template.json");
    expect(paths).not.toContain(".github/workflows/dependabot-auto-merge.yml");

    const stamp = pushedFiles.find((f) => f.path === ".stagecraft-template.json");
    expect(JSON.parse(stamp!.content)).toMatchObject({
      template: "musician-site-legacy",
      templateVersion: "1.2.3",
    });

    const workflowPaths = (mockPushFiles.mock.calls[1][4] as Array<{ path: string }>).map((f) => f.path);
    expect(workflowPaths).toEqual([".github/workflows/dependabot-auto-merge.yml"]);
  });

  it("returns failure when the source site yields no pages", async () => {
    mockCrawlSite.mockResolvedValueOnce({ pages: [] });

    const result = await handleMigrateSite(makeContext());

    expect(result.success).toBe(false);
    expect(mockPushFiles).not.toHaveBeenCalled();
  });
});
