import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    integrationAccount: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));

import {
  validateVercelToken,
  createProject,
  setEnvVars,
  triggerDeployment,
  deleteProject,
  getLatestDeployment,
} from "../vercel";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { status, body } = handler(url, init);
    // 204/205/304 must have null body per the Response spec.
    const noBodyStatus = status === 204 || status === 205 || status === 304;
    const responseBody = noBodyStatus
      ? null
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
    return new Response(responseBody, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  prismaMock.integrationAccount.findUnique.mockReset();
  prismaMock.integrationAccount.findUnique.mockResolvedValue({
    accessToken: "vercel_test_token",
  });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("validateVercelToken", () => {
  it("returns userId + username on a valid token", async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { id: "vercel-user-1", username: "jclaw", email: "j@example.com" } },
    }));
    const result = await validateVercelToken("vercel_test_token");
    expect(result).toEqual({ userId: "vercel-user-1", username: "jclaw" });
  });

  it("falls back to email when username is missing", async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { id: "u1", email: "j@example.com" } },
    }));
    const result = await validateVercelToken("vercel_test_token");
    expect(result.username).toBe("j@example.com");
  });

  it("accepts `uid` field as user id (older payload shape)", async () => {
    mockFetch(() => ({
      status: 200,
      body: { user: { uid: "u-old", username: "legacy" } },
    }));
    const result = await validateVercelToken("vercel_test_token");
    expect(result.userId).toBe("u-old");
  });

  it("throws a reconnect-prompt error on 401 from Vercel (so the UI can route users back to /settings)", async () => {
    mockFetch(() => ({ status: 401, body: { error: { code: "forbidden" } } }));
    await expect(validateVercelToken("bad-token")).rejects.toThrow(/Vercel connection has expired/);
  });

  it("treats 403 the same as 401 (also a reconnect prompt)", async () => {
    mockFetch(() => ({ status: 403, body: { error: { code: "forbidden" } } }));
    await expect(validateVercelToken("bad-token")).rejects.toThrow(/Vercel connection has expired/);
  });

  it("throws when /v2/user returns no user id at all", async () => {
    mockFetch(() => ({ status: 200, body: { user: { username: "anon" } } }));
    await expect(validateVercelToken("vercel_test_token")).rejects.toThrow(/did not return a user id/);
  });
});

describe("createProject", () => {
  it("POSTs /v9/projects with the GitHub repo info and nextjs framework default", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    mockFetch((url, init) => {
      capturedUrl = url;
      capturedBody = (init?.body as string) ?? "";
      return {
        status: 200,
        body: {
          id: "prj_abc",
          name: "stagecraft-site-test",
          targets: { production: { alias: ["stagecraft-site-test.vercel.app"] } },
        },
      };
    });

    const result = await createProject({
      userId: "user-1",
      name: "stagecraft-site-test",
      repo: { repo: "jclaw/stagecraft-site-test" },
    });

    expect(capturedUrl).toBe("https://api.vercel.com/v9/projects");
    const body = JSON.parse(capturedBody);
    expect(body).toMatchObject({
      name: "stagecraft-site-test",
      framework: "nextjs",
      gitRepository: { type: "github", repo: "jclaw/stagecraft-site-test" },
    });
    expect(result).toEqual({
      projectId: "prj_abc",
      projectName: "stagecraft-site-test",
      teamId: null,
      teamSlug: null,
      productionUrl: "https://stagecraft-site-test.vercel.app",
      adminUrl: "https://vercel.com/stagecraft-site-test",
    });
  });

  it("appends teamId to the URL when provided + fetches team slug for adminUrl", async () => {
    const requests: string[] = [];
    mockFetch((url) => {
      requests.push(url);
      if (url.includes("/v2/teams/")) {
        return { status: 200, body: { slug: "jclaw-8347s-projects" } };
      }
      return { status: 200, body: { id: "prj_x", name: "n", accountId: "team_xyz" } };
    });

    const result = await createProject({
      userId: "user-1",
      name: "n",
      teamId: "team_xyz",
      repo: { repo: "jclaw/n" },
    });
    expect(requests.some((u) => u.includes("teamId=team_xyz"))).toBe(true);
    expect(requests.some((u) => u.endsWith("/v2/teams/team_xyz"))).toBe(true);
    expect(result.teamSlug).toBe("jclaw-8347s-projects");
    expect(result.adminUrl).toBe("https://vercel.com/jclaw-8347s-projects/n");
  });

  it("uses accountId from project response to fetch team slug when teamId not passed (Northstar)", async () => {
    mockFetch((url) => {
      if (url.includes("/v2/teams/")) {
        return { status: 200, body: { slug: "northstar-default" } };
      }
      return { status: 200, body: { id: "prj_y", name: "p", accountId: "team_default" } };
    });
    const result = await createProject({
      userId: "user-1",
      name: "p",
      repo: { repo: "jclaw/p" },
    });
    expect(result.teamId).toBe("team_default");
    expect(result.teamSlug).toBe("northstar-default");
    expect(result.adminUrl).toBe("https://vercel.com/northstar-default/p");
  });

  it("falls back to bare vercel.com/<name> when team slug fetch fails", async () => {
    mockFetch((url) => {
      if (url.includes("/v2/teams/")) {
        return { status: 500, body: { error: "internal" } };
      }
      return { status: 200, body: { id: "prj_z", name: "p", accountId: "team_x" } };
    });
    const result = await createProject({
      userId: "user-1",
      name: "p",
      repo: { repo: "jclaw/p" },
    });
    expect(result.teamSlug).toBeNull();
    expect(result.adminUrl).toBe("https://vercel.com/p");
  });

  it("constructs a productionUrl when Vercel response lacks aliases (fresh project)", async () => {
    mockFetch(() => ({ status: 200, body: { id: "prj_x", name: "fresh-project" } }));
    const result = await createProject({
      userId: "user-1",
      name: "fresh-project",
      repo: { repo: "jclaw/fresh-project" },
    });
    expect(result.productionUrl).toBe("https://fresh-project.vercel.app");
  });

  it("propagates Vercel API errors with status + body", async () => {
    mockFetch(() => ({ status: 400, body: { error: { message: "name in use" } } }));
    await expect(
      createProject({
        userId: "user-1",
        name: "existing",
        repo: { repo: "jclaw/existing" },
      }),
    ).rejects.toThrow(/Vercel API error \(400\)/);
  });

  it("throws VercelGitHubAppNotInstalledError on the structured 400 with action='Install GitHub App'", async () => {
    // Real-world reproduction: Vercel returns this exact shape when the
    // user's GitHub account doesn't have Vercel's GitHub App installed
    // yet. The error gives us the install URL upfront — `/create` then
    // rolls back and surfaces a clickable CTA instead of a JSON dump.
    mockFetch(() => ({
      status: 400,
      body: {
        error: {
          code: "bad_request",
          message:
            "To link a GitHub repository, you need to install the GitHub integration first.",
          action: "Install GitHub App",
          link: "https://github.com/apps/vercel",
          repo: "jclaw/sarah-chen-music",
        },
      },
    }));

    const { VercelGitHubAppNotInstalledError } = await import("../vercel");
    let caught: unknown = null;
    try {
      await createProject({
        userId: "user-1",
        name: "sarah-chen-music",
        repo: { repo: "jclaw/sarah-chen-music" },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VercelGitHubAppNotInstalledError);
    expect((caught as InstanceType<typeof VercelGitHubAppNotInstalledError>).installUrl).toBe(
      "https://github.com/apps/vercel/installations/new",
    );
  });

  it("falls through to generic Vercel API error on a 400 without the install-app action", async () => {
    // Other 400s (e.g. duplicate project name) should NOT be coerced
    // into the install-app error — we'd lose the real failure cause and
    // the user would get a misleading CTA.
    mockFetch(() => ({
      status: 400,
      body: { error: { code: "name_taken", message: "Project name is already in use" } },
    }));
    const { VercelGitHubAppNotInstalledError } = await import("../vercel");
    let caught: unknown = null;
    try {
      await createProject({
        userId: "user-1",
        name: "existing",
        repo: { repo: "jclaw/existing" },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeInstanceOf(VercelGitHubAppNotInstalledError);
    expect((caught as Error).message).toMatch(/Vercel API error \(400\)/);
  });
});

describe("setEnvVars", () => {
  it("POSTs an upsert batch to /v10/projects/{id}/env with the right shape", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    mockFetch((url, init) => {
      capturedUrl = url;
      capturedBody = (init?.body as string) ?? "";
      return { status: 200, body: {} };
    });

    await setEnvVars({
      userId: "user-1",
      projectId: "prj_abc",
      vars: { FOO: "bar", BAZ: "qux" },
    });

    expect(capturedUrl).toContain("/v10/projects/prj_abc/env");
    expect(capturedUrl).toContain("upsert=true");
    const body = JSON.parse(capturedBody);
    expect(body).toEqual([
      { key: "FOO", value: "bar", type: "encrypted", target: ["production", "preview", "development"] },
      { key: "BAZ", value: "qux", type: "encrypted", target: ["production", "preview", "development"] },
    ]);
  });

  it("respects a custom target list", async () => {
    let capturedBody = "";
    mockFetch((_url, init) => {
      capturedBody = (init?.body as string) ?? "";
      return { status: 200, body: {} };
    });

    await setEnvVars({
      userId: "user-1",
      projectId: "prj_abc",
      vars: { FOO: "bar" },
      target: ["production"],
    });

    const body = JSON.parse(capturedBody);
    expect(body[0].target).toEqual(["production"]);
  });
});

describe("triggerDeployment", () => {
  it("looks up the project then POSTs /v13/deployments with gitSource", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    mockFetch((url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body as string | undefined,
      });
      // First call: GET /v9/projects/{id} → return project metadata.
      if (url.includes("/v9/projects/") && (init?.method ?? "GET") === "GET") {
        return {
          status: 200,
          body: {
            name: "stagecraft-site-test",
            link: {
              type: "github",
              org: "jclaw",
              repo: "stagecraft-site-test",
              repoId: 12345,
              productionBranch: "main",
            },
          },
        };
      }
      // Second call: POST /v13/deployments → deploy result.
      return { status: 200, body: { id: "dpl_abc" } };
    });

    const result = await triggerDeployment("user-1", "prj_abc");

    expect(result).toEqual({ deploymentId: "dpl_abc" });
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toBe("https://api.vercel.com/v13/deployments");
    expect(requests[1].method).toBe("POST");
    const body = JSON.parse(requests[1].body ?? "{}");
    expect(body).toMatchObject({
      name: "stagecraft-site-test",
      target: "production",
      gitSource: { type: "github", repoId: 12345, ref: "main" },
    });
  });

  it("defaults ref to 'main' when project has no productionBranch", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    mockFetch((url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body as string | undefined,
      });
      if (url.includes("/v9/projects/") && (init?.method ?? "GET") === "GET") {
        return {
          status: 200,
          body: { name: "n", link: { repoId: 99 } },
        };
      }
      return { status: 200, body: { id: "dpl_y" } };
    });

    await triggerDeployment("user-1", "prj_x");

    const body = JSON.parse(requests[1].body ?? "{}");
    expect(body.gitSource.ref).toBe("main");
  });

  it("throws when the project has no linked git repo", async () => {
    mockFetch((url, init) => {
      if (url.includes("/v9/projects/") && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { name: "n", link: {} } };
      }
      return { status: 200, body: {} };
    });

    await expect(triggerDeployment("user-1", "prj_x")).rejects.toThrow(
      /no linked git repo/,
    );
  });

  it("forwards teamId to both API calls when provided", async () => {
    const urls: string[] = [];
    mockFetch((url, init) => {
      urls.push(url);
      if (url.includes("/v9/projects/") && (init?.method ?? "GET") === "GET") {
        return {
          status: 200,
          body: { name: "n", link: { repoId: 1, productionBranch: "main" } },
        };
      }
      return { status: 200, body: { id: "dpl_z" } };
    });

    await triggerDeployment("user-1", "prj_x", "team_t");

    expect(urls[0]).toContain("teamId=team_t");
    expect(urls[1]).toContain("teamId=team_t");
  });
});

describe("deleteProject", () => {
  it("issues DELETE /v9/projects/{id}", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    mockFetch((url, init) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      return { status: 204, body: "" };
    });

    await deleteProject("user-1", "prj_abc");

    expect(capturedUrl).toContain("/v9/projects/prj_abc");
    expect(capturedMethod).toBe("DELETE");
  });

  it("treats 404 as success (idempotent delete)", async () => {
    mockFetch(() => ({ status: 404, body: { error: { code: "not_found" } } }));
    await expect(deleteProject("user-1", "missing")).resolves.toBeUndefined();
  });

  it("throws on non-404 errors", async () => {
    mockFetch(() => ({ status: 500, body: { error: { code: "internal" } } }));
    await expect(deleteProject("user-1", "prj_x")).rejects.toThrow(/500/);
  });

  it("appends teamId to the URL when provided", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return { status: 204, body: "" };
    });
    await deleteProject("user-1", "prj_x", "team_y");
    expect(capturedUrl).toContain("teamId=team_y");
  });
});

describe("getLatestDeployment", () => {
  it("returns the most recent deployment normalized to {state, url, id}", async () => {
    // Freshly-created deployment so the Vercel "finalizing" time
    // heuristic doesn't fire and shift BUILDING → "finalizing".
    const now = Date.now();
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return {
        status: 200,
        body: {
          deployments: [
            { uid: "dpl_1", readyState: "BUILDING", url: "site-x.vercel.app", created: now },
            { uid: "dpl_0", readyState: "READY", url: "site-x-old.vercel.app", created: now - 1_000 },
          ],
        },
      };
    });

    const d = await getLatestDeployment("user-1", "prj_abc");

    expect(capturedUrl).toContain("/v6/deployments");
    expect(capturedUrl).toContain("projectId=prj_abc");
    expect(capturedUrl).toContain("limit=1");
    expect(d.id).toBe("dpl_1");
    expect(d.state).toBe("building");
    expect(d.url).toBe("https://site-x.vercel.app");
    expect(d.createdAt).toBe(new Date(now).toISOString());
  });

  it("normalizes Vercel readyStates to the DeployState enum", async () => {
    // Use a freshly-created deployment so the Vercel `finalizing`
    // time-heuristic (BUILDING for >35s → "finalizing") doesn't fire
    // and confuse the BUILDING → "building" assertion. The heuristic
    // gets its own test below.
    const now = Date.now();
    const cases: Array<[string, string]> = [
      ["READY", "ready"],
      ["ERROR", "error"],
      ["CANCELED", "error"],
      ["QUEUED", "queued"],
      ["INITIALIZING", "initializing"],
      ["BUILDING", "building"],
      ["UPLOADING", "finalizing"],
      ["DEPLOYING", "finalizing"],
      ["WAT", "unknown"],
    ];
    for (const [raw, normalized] of cases) {
      mockFetch(() => ({
        status: 200,
        body: { deployments: [{ uid: "dpl_x", readyState: raw, url: "x.vercel.app", created: now }] },
      }));
      const d = await getLatestDeployment("user-1", "prj_abc");
      expect(d.state, `${raw} → ${normalized}`).toBe(normalized);
    }
  });

  it("upgrades long-running BUILDING to 'finalizing' (Vercel API doesn't expose the real finalize phase)", async () => {
    // Vercel's /v6/deployments only returns QUEUED|INITIALIZING|BUILDING|
    // READY|ERROR|CANCELED — UPLOADING and DEPLOYING are internal phases
    // we never see. Without this heuristic, Vercel users would sit on
    // "Building…" for the whole deploy then snap straight to "Live!".
    const oldEnough = Date.now() - 40_000; // 40s > 35s threshold
    mockFetch(() => ({
      status: 200,
      body: { deployments: [{ uid: "dpl_x", readyState: "BUILDING", url: "x.vercel.app", created: oldEnough }] },
    }));
    const d = await getLatestDeployment("user-1", "prj_abc");
    expect(d.state).toBe("finalizing");
  });

  it("doesn't fire the finalizing heuristic on fresh BUILDING deployments", async () => {
    const fresh = Date.now() - 5_000; // 5s < 35s threshold
    mockFetch(() => ({
      status: 200,
      body: { deployments: [{ uid: "dpl_x", readyState: "BUILDING", url: "x.vercel.app", created: fresh }] },
    }));
    const d = await getLatestDeployment("user-1", "prj_abc");
    expect(d.state).toBe("building");
  });

  it("doesn't fire the heuristic when `created` is missing (graceful fallback)", async () => {
    mockFetch(() => ({
      status: 200,
      body: { deployments: [{ uid: "dpl_x", readyState: "BUILDING", url: "x.vercel.app" }] },
    }));
    const d = await getLatestDeployment("user-1", "prj_abc");
    expect(d.state).toBe("building");
  });

  it("returns a queued/null deploy when the project has no deployments yet", async () => {
    mockFetch(() => ({ status: 200, body: { deployments: [] } }));
    const d = await getLatestDeployment("user-1", "prj_abc");
    expect(d.id).toBeNull();
    expect(d.state).toBe("queued");
    expect(d.url).toBeNull();
    expect(d.createdAt).toBeNull();
  });

  it("forwards teamId on the request", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return { status: 200, body: { deployments: [] } };
    });
    await getLatestDeployment("user-1", "prj_abc", "team_y");
    expect(capturedUrl).toContain("teamId=team_y");
  });
});
