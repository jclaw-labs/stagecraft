import { beforeEach, describe, expect, it, vi } from "vitest";

const { mintMock } = vi.hoisted(() => ({ mintMock: vi.fn() }));

vi.mock("../github-app-token", () => ({ mintInstallationToken: mintMock }));

import {
  SITE_TOKEN_REFRESH_MARGIN_MS,
  clearSiteTokenCache,
  getSiteInstallationToken,
} from "../site-installation-token";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const HOUR_LATER = new Date(NOW + 60 * 60 * 1000).toISOString();
const TARGET = { siteId: "site-1", installationId: 42, repoName: "artist-site" };

beforeEach(() => {
  mintMock.mockReset();
  clearSiteTokenCache();
});

describe("getSiteInstallationToken", () => {
  it("mints a token scoped to the site's repo with contents write and metadata read", async () => {
    mintMock.mockResolvedValue({ token: "ghs_1", expiresAt: HOUR_LATER });

    const token = await getSiteInstallationToken(TARGET, () => NOW);

    expect(token).toEqual({ token: "ghs_1", expiresAt: HOUR_LATER });
    expect(mintMock).toHaveBeenCalledWith(42, {
      repositoryNames: ["artist-site"],
      permissions: { contents: "write", metadata: "read" },
    });
  });

  it("reuses the cached token while it has more than the refresh margin left", async () => {
    mintMock.mockResolvedValue({ token: "ghs_1", expiresAt: HOUR_LATER });

    await getSiteInstallationToken(TARGET, () => NOW);
    const later = Date.parse(HOUR_LATER) - SITE_TOKEN_REFRESH_MARGIN_MS - 1;
    const token = await getSiteInstallationToken(TARGET, () => later);

    expect(token.token).toBe("ghs_1");
    expect(mintMock).toHaveBeenCalledTimes(1);
  });

  it("mints a fresh token once the cached one is within the refresh margin of expiry", async () => {
    mintMock
      .mockResolvedValueOnce({ token: "ghs_1", expiresAt: HOUR_LATER })
      .mockResolvedValueOnce({ token: "ghs_2", expiresAt: "2026-10-09T14:00:00.000Z" });

    await getSiteInstallationToken(TARGET, () => NOW);
    const atMargin = Date.parse(HOUR_LATER) - SITE_TOKEN_REFRESH_MARGIN_MS;
    const token = await getSiteInstallationToken(TARGET, () => atMargin);

    expect(token.token).toBe("ghs_2");
    expect(mintMock).toHaveBeenCalledTimes(2);
  });

  it("keeps each site's token separate", async () => {
    mintMock
      .mockResolvedValueOnce({ token: "ghs_a", expiresAt: HOUR_LATER })
      .mockResolvedValueOnce({ token: "ghs_b", expiresAt: HOUR_LATER });

    const a = await getSiteInstallationToken(TARGET, () => NOW);
    const b = await getSiteInstallationToken(
      { siteId: "site-2", installationId: 42, repoName: "other-site" },
      () => NOW,
    );

    expect(a.token).toBe("ghs_a");
    expect(b.token).toBe("ghs_b");
    expect(mintMock).toHaveBeenLastCalledWith(42, expect.objectContaining({
      repositoryNames: ["other-site"],
    }));
  });

  it("mints again when the site's repo or installation changes", async () => {
    mintMock
      .mockResolvedValueOnce({ token: "ghs_1", expiresAt: HOUR_LATER })
      .mockResolvedValueOnce({ token: "ghs_2", expiresAt: HOUR_LATER })
      .mockResolvedValueOnce({ token: "ghs_3", expiresAt: HOUR_LATER });

    await getSiteInstallationToken(TARGET, () => NOW);
    const renamed = await getSiteInstallationToken({ ...TARGET, repoName: "renamed" }, () => NOW);
    const reinstalled = await getSiteInstallationToken(
      { ...TARGET, repoName: "renamed", installationId: 7 },
      () => NOW,
    );

    expect(renamed.token).toBe("ghs_2");
    expect(reinstalled.token).toBe("ghs_3");
    expect(mintMock).toHaveBeenCalledTimes(3);
  });

  it("caches nothing when minting fails", async () => {
    mintMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ token: "ghs_1", expiresAt: HOUR_LATER });

    await expect(getSiteInstallationToken(TARGET, () => NOW)).rejects.toThrow("boom");
    const token = await getSiteInstallationToken(TARGET, () => NOW);

    expect(token.token).toBe("ghs_1");
    expect(mintMock).toHaveBeenCalledTimes(2);
  });
});
