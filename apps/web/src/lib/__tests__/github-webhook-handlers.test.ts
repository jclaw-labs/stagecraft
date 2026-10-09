import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    site: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@stagecraft/db", () => ({ prisma: prismaMock }));

import {
  handleInstallationEvent,
  handleRepositoriesEvent,
  type WebhookDb,
} from "../github-webhook-handlers";

/** A client standing in for the transaction the webhook route passes. */
function makeTx() {
  return { site: { findFirst: vi.fn(), update: vi.fn() } };
}

beforeEach(() => {
  prismaMock.site.findFirst.mockReset();
  prismaMock.site.update.mockReset();
});

function makeSite(overrides = {}) {
  return {
    id: "site-1",
    name: "x",
    githubInstallationId: 100,
    githubRepoOwner: "artist",
    githubRepoName: "site",
    githubAppSuspended: false,
    brokerSecretHash: "existing-hash",
    ...overrides,
  };
}

describe("handleInstallationEvent", () => {
  it("no-ops when no site matches the installation id", async () => {
    prismaMock.site.findFirst.mockResolvedValue(null);
    const result = await handleInstallationEvent("suspend", 999);
    expect(result.applied).toBe(false);
    expect(prismaMock.site.update).not.toHaveBeenCalled();
  });

  it("suspend → sets githubAppSuspended=true", async () => {
    prismaMock.site.findFirst.mockResolvedValue(makeSite());
    const result = await handleInstallationEvent("suspend", 100);
    expect(result.applied).toBe(true);
    expect(prismaMock.site.update).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: { githubAppSuspended: true },
    });
  });

  it("unsuspend → sets githubAppSuspended=false", async () => {
    prismaMock.site.findFirst.mockResolvedValue(makeSite({ githubAppSuspended: true }));
    const result = await handleInstallationEvent("unsuspend", 100);
    expect(result.applied).toBe(true);
    expect(prismaMock.site.update).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: { githubAppSuspended: false },
    });
  });

  it("deleted → clears installation + repo fields, retains brokerSecretHash", async () => {
    prismaMock.site.findFirst.mockResolvedValue(makeSite());
    const result = await handleInstallationEvent("deleted", 100);
    expect(result.applied).toBe(true);
    const data = prismaMock.site.update.mock.calls[0][0].data;
    expect(data).toEqual({
      githubInstallationId: null,
      githubRepoOwner: null,
      githubRepoName: null,
      githubAppSuspended: false,
    });
    // Critically: brokerSecretHash is NOT touched here
    expect(data).not.toHaveProperty("brokerSecretHash");
  });

  it("created → acknowledges without writing", async () => {
    prismaMock.site.findFirst.mockResolvedValue(makeSite());
    const result = await handleInstallationEvent("created", 100);
    expect(result.applied).toBe(false);
    expect(prismaMock.site.update).not.toHaveBeenCalled();
  });

  it("reads and writes through the client it is given", async () => {
    const tx = makeTx();
    tx.site.findFirst.mockResolvedValue(makeSite());
    const result = await handleInstallationEvent("suspend", 100, tx as unknown as WebhookDb);
    expect(result.applied).toBe(true);
    expect(tx.site.update).toHaveBeenCalledWith({
      where: { id: "site-1" },
      data: { githubAppSuspended: true },
    });
    expect(prismaMock.site.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.site.update).not.toHaveBeenCalled();
  });

  it("new_permissions_accepted → acknowledges without writing", async () => {
    prismaMock.site.findFirst.mockResolvedValue(makeSite());
    const result = await handleInstallationEvent("new_permissions_accepted", 100);
    expect(result.applied).toBe(false);
    expect(prismaMock.site.update).not.toHaveBeenCalled();
  });
});

describe("handleRepositoriesEvent", () => {
  it("added → no-op", async () => {
    const result = await handleRepositoriesEvent("added", 100, [{ name: "anything" }]);
    expect(result.applied).toBe(false);
    expect(prismaMock.site.findFirst).not.toHaveBeenCalled();
  });

  it("removed but no matching site → no-op", async () => {
    prismaMock.site.findFirst.mockResolvedValue(null);
    const result = await handleRepositoriesEvent("removed", 100, [{ name: "x" }]);
    expect(result.applied).toBe(false);
  });

  it("removed but the site has no configured repo → no-op", async () => {
    prismaMock.site.findFirst.mockResolvedValue(makeSite({ githubRepoName: null }));
    const result = await handleRepositoriesEvent("removed", 100, [{ name: "site" }]);
    expect(result.applied).toBe(false);
    expect(prismaMock.site.update).not.toHaveBeenCalled();
  });

  it("removed but the removed repo is not the site's repo → no-op", async () => {
    prismaMock.site.findFirst.mockResolvedValue(makeSite());
    const result = await handleRepositoriesEvent("removed", 100, [{ name: "blog" }]);
    expect(result.applied).toBe(false);
    expect(prismaMock.site.update).not.toHaveBeenCalled();
  });

  it("removed and matches → clears repo fields, retains broker secret + suspend state", async () => {
    prismaMock.site.findFirst.mockResolvedValue(makeSite());
    const result = await handleRepositoriesEvent("removed", 100, [
      { name: "other" },
      { name: "site" },
    ]);
    expect(result.applied).toBe(true);
    const data = prismaMock.site.update.mock.calls[0][0].data;
    expect(data).toEqual({
      githubInstallationId: null,
      githubRepoOwner: null,
      githubRepoName: null,
    });
    expect(data).not.toHaveProperty("brokerSecretHash");
    expect(data).not.toHaveProperty("githubAppSuspended");
  });

  it("reads and writes through the client it is given", async () => {
    const tx = makeTx();
    tx.site.findFirst.mockResolvedValue(makeSite());
    const result = await handleRepositoriesEvent(
      "removed",
      100,
      [{ name: "site" }],
      tx as unknown as WebhookDb,
    );
    expect(result.applied).toBe(true);
    expect(tx.site.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.site.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.site.update).not.toHaveBeenCalled();
  });
});
