import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockFetch = vi.fn();

vi.mock("@stagecraft/db", () => ({
  prisma: {
    integrationAccount: { findUnique: mockFindUnique },
  },
}));

vi.stubGlobal("fetch", mockFetch);

const { createSite, findSite, setEnvVars, triggerBuild } = await import("../integrations/netlify");

describe("Netlify integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ accessToken: "netlify-token-123" });
  });

  describe("createSite", () => {
    it("creates a bare site with build settings when no repo is provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "netlify-site-id",
          name: "my-site",
          url: "https://my-site.netlify.app",
          admin_url: "https://app.netlify.com/sites/my-site",
          ssl_url: "https://my-site.netlify.app",
        }),
      });

      const result = await createSite({ userId: "user-1", name: "my-site" });

      expect(result).toEqual({
        siteId: "netlify-site-id",
        siteName: "my-site",
        url: "https://my-site.netlify.app",
        adminUrl: "https://app.netlify.com/sites/my-site",
        sslUrl: "https://my-site.netlify.app",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.repo).toBeUndefined();
      expect(body.build_settings.cmd).toBe("npm run build");
      expect(body.build_settings.dir).toBe("dist");
    });

    it("creates a site with repo linking when repo is provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "netlify-site-id",
          name: "my-site",
          url: "https://my-site.netlify.app",
          admin_url: "https://app.netlify.com/sites/my-site",
          ssl_url: "https://my-site.netlify.app",
        }),
      });

      await createSite({
        userId: "user-1",
        name: "my-site",
        repo: {
          provider: "github",
          repo_path: "jclaw/my-site",
          repo_branch: "main",
          cmd: "npm run build",
          dir: "dist",
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.repo).toEqual({
        provider: "github",
        repo_path: "jclaw/my-site",
        repo_branch: "main",
        cmd: "npm run build",
        dir: "dist",
      });
      expect(body.build_settings).toBeUndefined();
    });

    it("throws when Netlify account is not connected", async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      await expect(
        createSite({ userId: "user-1", name: "test" })
      ).rejects.toThrow("Netlify account not connected");
    });
  });

  describe("findSite", () => {
    function siteResponse(buildSettings: unknown) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "netlify-site-id",
          name: "my-site",
          url: "http://my-site.netlify.app",
          admin_url: "https://app.netlify.com/sites/my-site",
          ssl_url: "https://my-site.netlify.app",
          build_settings: buildSettings,
          created_at: "2026-10-09T11:00:05.000Z",
        }),
      };
    }

    it("returns a linked site by domain", async () => {
      mockFetch.mockResolvedValueOnce(siteResponse({ repo_path: "jclaw/my-site" }));

      const site = await findSite("user-1", "my-site.netlify.app");

      expect(mockFetch.mock.calls[0][0]).toBe("https://api.netlify.com/api/v1/sites/my-site.netlify.app");
      expect(site).toEqual({
        siteId: "netlify-site-id",
        siteName: "my-site",
        url: "http://my-site.netlify.app",
        adminUrl: "https://app.netlify.com/sites/my-site",
        sslUrl: "https://my-site.netlify.app",
        linked: true,
        createdAt: "2026-10-09T11:00:05.000Z",
      });
    });

    it("reports an unlinked site (the manual-link fallback)", async () => {
      mockFetch.mockResolvedValueOnce(siteResponse({}));
      expect((await findSite("user-1", "my-site.netlify.app"))?.linked).toBe(false);
    });

    it("returns null when the site doesn't exist", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "Not Found" });
      expect(await findSite("user-1", "missing.netlify.app")).toBeNull();
    });

    it("throws on other errors", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
      await expect(findSite("user-1", "x.netlify.app")).rejects.toThrow("Netlify API error (500)");
    });
  });

  describe("setEnvVars", () => {
    it("posts environment variables for a site", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await setEnvVars("user-1", "site-id", {
        CONTACT_EMAIL: "test@example.com",
        RESEND_API_KEY: "re_123",
      });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain("/accounts/me/env?site_id=site-id");

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toHaveLength(2);
      expect(body[0].key).toBe("CONTACT_EMAIL");
    });

    it("with replace, deletes each key first (404 means unset) and then posts", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 204 })
        .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "Not Found" })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await setEnvVars("user-1", "site-id", { A: "1", B: "2" }, { replace: true });

      expect(mockFetch.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
        ["DELETE", "https://api.netlify.com/api/v1/accounts/me/env/A?site_id=site-id"],
        ["DELETE", "https://api.netlify.com/api/v1/accounts/me/env/B?site_id=site-id"],
        ["POST", "https://api.netlify.com/api/v1/accounts/me/env?site_id=site-id"],
      ]);
    });

    it("with replace, throws when a delete fails for another reason", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });

      await expect(setEnvVars("user-1", "site-id", { A: "1" }, { replace: true })).rejects.toThrow(
        "Netlify API error (500)",
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("triggerBuild", () => {
    it("POSTs to /sites/{id}/builds and returns the build id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "build-xyz" }),
      });

      const result = await triggerBuild("user-1", "netlify-site-id");

      expect(result).toEqual({ buildId: "build-xyz" });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/sites/netlify-site-id/builds");
      expect(init.method).toBe("POST");
    });

    it("throws when the Netlify API fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => "upstream error",
      });

      await expect(triggerBuild("user-1", "netlify-site-id")).rejects.toThrow(
        /Netlify API error \(502\)/,
      );
    });
  });
});
