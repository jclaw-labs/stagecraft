import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    integrationAccount: { findUnique: vi.fn() },
  },
}));

vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));

import { findGithubAppInstallation } from "../github";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

function mockFetch(handler: (url: string) => { status: number; body: unknown }) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  prismaMock.integrationAccount.findUnique.mockReset();
  prismaMock.integrationAccount.findUnique.mockResolvedValue({
    accessToken: "ghp_test_token",
  });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

describe("findGithubAppInstallation", () => {
  it("returns the matching installation id when app_slug + account.login both match", async () => {
    mockFetch((url) => {
      expect(url).toContain("/user/installations");
      return {
        status: 200,
        body: {
          installations: [
            { id: 111, app_slug: "netlify", account: { login: "jclaw" } },
            { id: 222, app_slug: "netlify", account: { login: "Stagecraft-Web" } },
            { id: 333, app_slug: "vercel", account: { login: "jclaw" } },
          ],
        },
      };
    });

    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBe(111);
  });

  it("returns the org-scoped installation when ownerLogin is the org", async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        installations: [
          { id: 111, app_slug: "netlify", account: { login: "jclaw" } },
          { id: 222, app_slug: "netlify", account: { login: "Stagecraft-Web" } },
        ],
      },
    }));

    const id = await findGithubAppInstallation("user-1", "netlify", "Stagecraft-Web");
    expect(id).toBe(222);
  });

  it("returns null when no installation matches the requested owner", async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        installations: [
          { id: 111, app_slug: "netlify", account: { login: "someone-else" } },
        ],
      },
    }));

    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBeNull();
  });

  it("returns null when no installation has the requested app_slug", async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        installations: [
          { id: 111, app_slug: "vercel", account: { login: "jclaw" } },
        ],
      },
    }));

    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBeNull();
  });

  it("returns null on an empty installations array", async () => {
    mockFetch(() => ({ status: 200, body: { installations: [] } }));
    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBeNull();
  });

  it("returns null on GitHub API errors so create_site falls back to manual link", async () => {
    // Real-world reproduction: production hits 403 here because
    // Stagecraft signs users in via a regular OAuth App, not a GitHub
    // App, and `/user/installations` only accepts GitHub App
    // user-to-server tokens. Killing the create_site job over a
    // discovery API failure was the wrong call — the caller in
    // create-site.ts already treats null as "no installation found"
    // and degrades to the manual-link Netlify path.
    mockFetch(() => ({ status: 403, body: { message: "You must authenticate with an access token authorized to a GitHub App" } }));
    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBeNull();
  });

  it("returns null on transient errors (network/rate-limit) too", async () => {
    mockFetch(() => ({ status: 500, body: { message: "Server error" } }));
    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBeNull();
  });

  it("falls back to GITHUB_APP_INSTALLATION_ID_<APPSLUG> env var when API returns 403", async () => {
    process.env.GITHUB_APP_INSTALLATION_ID_NETLIFY = "15980838";
    mockFetch(() => ({ status: 403, body: { message: "auth required" } }));
    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBe(15980838);
  });

  it("falls back to env var when API returns no matching installation", async () => {
    process.env.GITHUB_APP_INSTALLATION_ID_NETLIFY = "15980838";
    mockFetch(() => ({ status: 200, body: { installations: [] } }));
    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBe(15980838);
  });

  it("converts hyphens to underscores when looking up env var (e.g. stagecraft-bot)", async () => {
    process.env.GITHUB_APP_INSTALLATION_ID_STAGECRAFT_BOT = "129023518";
    mockFetch(() => ({ status: 403, body: { message: "auth required" } }));
    const id = await findGithubAppInstallation("user-1", "stagecraft-bot", "jclaw");
    expect(id).toBe(129023518);
  });

  it("ignores env var when the value is not a positive integer", async () => {
    process.env.GITHUB_APP_INSTALLATION_ID_NETLIFY = "not-a-number";
    mockFetch(() => ({ status: 403, body: { message: "auth required" } }));
    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBeNull();
  });

  it("prefers API match over env var when both are present", async () => {
    process.env.GITHUB_APP_INSTALLATION_ID_NETLIFY = "99999999";
    mockFetch(() => ({
      status: 200,
      body: {
        installations: [{ id: 111, app_slug: "netlify", account: { login: "jclaw" } }],
      },
    }));
    const id = await findGithubAppInstallation("user-1", "netlify", "jclaw");
    expect(id).toBe(111);
  });

  it("throws GitHub-not-connected when the user has no github IntegrationAccount", async () => {
    prismaMock.integrationAccount.findUnique.mockResolvedValueOnce(null);
    await expect(
      findGithubAppInstallation("user-1", "netlify", "jclaw"),
    ).rejects.toThrow(/GitHub account not connected/);
  });
});
