import { beforeEach, describe, expect, it, vi } from "vitest";

const { netlifyDeleteMock, vercelDeleteMock } = vi.hoisted(() => ({
  netlifyDeleteMock: vi.fn(),
  vercelDeleteMock: vi.fn(),
}));

vi.mock("@/lib/integrations/netlify", () => ({ deleteSite: netlifyDeleteMock }));
vi.mock("@/lib/integrations/vercel", () => ({ deleteProject: vercelDeleteMock }));
// Any GitHub call during cleanup would go through this module. Mocked empty
// so a stray import of a repo-deleting helper fails loudly.
vi.mock("@/lib/integrations/github", () => ({}));

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
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteSiteResources", () => {
  it("keeps the GitHub repo: no GitHub call, no errors", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const errors = await deleteSiteResources("u1", BASE_SITE);

    expect(errors).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(netlifyDeleteMock).not.toHaveBeenCalled();
    expect(vercelDeleteMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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

  it("collects provider errors instead of throwing", async () => {
    netlifyDeleteMock.mockRejectedValueOnce(new Error("boom"));
    vercelDeleteMock.mockRejectedValueOnce("not an error");

    const errors = await deleteSiteResources("u1", {
      ...BASE_SITE,
      netlifySiteId: "ntl_1",
      vercelProjectId: "prj_1",
    });

    expect(errors).toEqual(["Netlify: boom", "Vercel: unknown error"]);
  });
});
