import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { netlifyDeleteMock, vercelDeleteMock, setRepoArchivedMock, fetchMock } = vi.hoisted(() => ({
  netlifyDeleteMock: vi.fn(),
  vercelDeleteMock: vi.fn(),
  setRepoArchivedMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/integrations/netlify", () => ({ deleteSite: netlifyDeleteMock }));
vi.mock("@/lib/integrations/vercel", () => ({ deleteProject: vercelDeleteMock }));
// Only the archive helper (and the error class) are exposed, so a stray
// import of a repo-deleting helper fails loudly.
vi.mock("@/lib/integrations/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/github")>();
  return { GitHubApiError: actual.GitHubApiError, setRepoArchived: setRepoArchivedMock };
});

import { GitHubApiError } from "@/lib/integrations/github";
import { deleteSiteResources } from "../site-cleanup";

const BASE_SITE = {
  githubRepoOwner: "jclaw",
  githubRepoName: "my-site",
  netlifySiteId: null,
  vercelProjectId: null,
  vercelTeamId: null,
};

beforeEach(() => {
  netlifyDeleteMock.mockReset().mockResolvedValue(undefined);
  vercelDeleteMock.mockReset().mockResolvedValue(undefined);
  setRepoArchivedMock.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Every test runs with fetch stubbed, so a reintroduced raw-fetch repo
  // delete can't reach api.github.com and fails the test that triggers it.
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deleteSiteResources", () => {
  it("archives the GitHub repo instead of deleting it", async () => {
    const errors = await deleteSiteResources("u1", BASE_SITE);

    expect(errors).toEqual([]);
    expect(setRepoArchivedMock).toHaveBeenCalledWith("u1", "jclaw", "my-site", true);
    expect(netlifyDeleteMock).not.toHaveBeenCalled();
    expect(vercelDeleteMock).not.toHaveBeenCalled();
  });

  it("skips the archive when the site has no repo", async () => {
    const errors = await deleteSiteResources("u1", {
      ...BASE_SITE,
      githubRepoOwner: null,
      githubRepoName: null,
    });

    expect(errors).toEqual([]);
    expect(setRepoArchivedMock).not.toHaveBeenCalled();
  });

  it("skips the archive when only half the repo coordinates are set", async () => {
    await deleteSiteResources("u1", { ...BASE_SITE, githubRepoName: null });

    expect(setRepoArchivedMock).not.toHaveBeenCalled();
  });

  it("reports an archive failure instead of throwing", async () => {
    setRepoArchivedMock.mockRejectedValueOnce(new GitHubApiError(403, '{"message":"Must have admin rights"}'));

    const errors = await deleteSiteResources("u1", BASE_SITE);

    expect(errors).toEqual([
      'GitHub: could not archive jclaw/my-site: GitHub API error (403): {"message":"Must have admin rights"}',
    ]);
    expect(console.error).toHaveBeenCalledWith(`[delete-site] ${errors[0]}`);
  });

  it("reports a non-Error archive failure as unknown", async () => {
    setRepoArchivedMock.mockRejectedValueOnce("not an error");

    const errors = await deleteSiteResources("u1", BASE_SITE);

    expect(errors).toEqual(["GitHub: could not archive jclaw/my-site: unknown error"]);
  });

  it("treats a repo the artist already deleted (404) as nothing to archive", async () => {
    setRepoArchivedMock.mockRejectedValueOnce(new GitHubApiError(404, '{"message":"Not Found"}'));

    const errors = await deleteSiteResources("u1", BASE_SITE);

    expect(errors).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("deletes the Netlify site when one is linked", async () => {
    const errors = await deleteSiteResources("u1", { ...BASE_SITE, netlifySiteId: "ntl_1" });

    expect(errors).toEqual([]);
    expect(netlifyDeleteMock).toHaveBeenCalledWith("u1", "ntl_1");
  });

  it("deletes the Vercel project, passing the team id when set", async () => {
    const errors = await deleteSiteResources("u1", {
      ...BASE_SITE,
      vercelProjectId: "prj_1",
      vercelTeamId: "team_1",
    });

    expect(errors).toEqual([]);
    expect(vercelDeleteMock).toHaveBeenCalledWith("u1", "prj_1", "team_1");
  });

  it("passes undefined for a missing Vercel team id", async () => {
    await deleteSiteResources("u1", { ...BASE_SITE, vercelProjectId: "prj_1" });

    expect(vercelDeleteMock).toHaveBeenCalledWith("u1", "prj_1", undefined);
  });

  it("collects every provider error and still attempts each cleanup", async () => {
    netlifyDeleteMock.mockRejectedValueOnce(new Error("boom"));
    vercelDeleteMock.mockRejectedValueOnce("not an error");
    setRepoArchivedMock.mockRejectedValueOnce(new Error("bad credentials"));

    const errors = await deleteSiteResources("u1", {
      ...BASE_SITE,
      netlifySiteId: "ntl_1",
      vercelProjectId: "prj_1",
    });

    expect(errors).toEqual([
      "Netlify: boom",
      "Vercel: unknown error",
      "GitHub: could not archive jclaw/my-site: bad credentials",
    ]);
    expect(setRepoArchivedMock).toHaveBeenCalledTimes(1);
  });
});
