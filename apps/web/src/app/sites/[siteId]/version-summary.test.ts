import { describe, expect, it } from "vitest";
import type { SiteVersionInfo } from "@stagecraft/shared";

import { versionSummary } from "./version-summary";

const info = (overrides: Partial<SiteVersionInfo>): SiteVersionInfo => ({
  current: "1.2.0",
  currentKind: "version",
  source: "package_json",
  target: "1.4.1",
  needsHandUpgrade: false,
  updateAvailable: true,
  latest: "1.4.1",
  latestStatus: "published",
  newerRelease: null,
  pullRequest: null,
  ...overrides,
});

describe("versionSummary", () => {
  it("flags a site behind the release Stagecraft upgrades to", () => {
    expect(versionSummary(info({}))).toEqual({
      tone: "behind",
      text: "This site is on 1.2.0. The latest release is 1.4.1. An update to 1.4.1 is available.",
    });
  });

  it("links an open update and says it's waiting to be merged", () => {
    const summary = versionSummary(
      info({ pullRequest: { number: 4, url: "https://github.com/x/y/pull/4", kind: "dependabot", reachesTarget: true, updatesSite: true } }),
    );
    expect(summary.text).toBe("This site is on 1.2.0. The latest release is 1.4.1. An update is waiting for you to merge it.");
    expect(summary.pullRequest).toEqual({ url: "https://github.com/x/y/pull/4", label: "Review Dependabot's pull request" });
    expect(
      versionSummary(info({ pullRequest: { number: 5, url: "u", kind: "upgrade", reachesTarget: true, updatesSite: true } })).pullRequest?.label,
    ).toBe("Review the upgrade pull request");
  });

  it("keeps offering the update when Dependabot's open bump doesn't reach it, and mentions the bump apart", () => {
    const bump = { number: 4, url: "u4", kind: "dependabot", reachesTarget: false, updatesSite: true } as const;
    // A major on offer, with Dependabot's minor bump in the old major open.
    expect(versionSummary(info({ current: "1.4.1", target: "2.0.0", latest: "2.0.0", pullRequest: bump }))).toEqual({
      tone: "behind",
      text: "This site is on 1.4.1. The latest release is 2.0.0. An update to 2.0.0 is available. Dependabot also has a pull request open.",
      pullRequest: { url: "u4", label: "Review Dependabot's pull request" },
    });
    // An older bump than the platform's release, left open.
    expect(versionSummary(info({ pullRequest: bump })).text).toBe(
      "This site is on 1.2.0. The latest release is 1.4.1. An update to 1.4.1 is available. Dependabot also has a pull request open.",
    );
    // A newer release in the major on offer still reaches the site through Dependabot after it.
    expect(
      versionSummary(info({ current: "1.4.1", target: "2.0.0", latest: "2.1.0", newerRelease: "dependabot", pullRequest: bump })).text,
    ).toBe(
      "This site is on 1.4.1. The latest release is 2.1.0. An update to 2.0.0 is available. Dependabot also has a pull request open. After this update, Dependabot will update the site to 2.1.0.",
    );
  });

  it("explains a pull request still open on a site with nothing to upgrade", () => {
    const summary = versionSummary(
      info({ current: "1.4.1", updateAvailable: false, pullRequest: { number: 5, url: "u", kind: "upgrade", reachesTarget: true, updatesSite: true } }),
    );
    expect(summary).toMatchObject({
      tone: "current",
      text: "This site is on 1.4.1. The latest release is 1.4.1. A pull request that updates it is open.",
    });
  });

  it("doesn't say an old upgrade pull request updates a site that needs upgrading by hand", () => {
    const summary = versionSummary(
      info({
        current: "latest",
        currentKind: "other",
        needsHandUpgrade: true,
        updateAvailable: false,
        pullRequest: { number: 5, url: "u5", kind: "upgrade", reachesTarget: true, updatesSite: true },
      }),
    );
    expect(summary.text).toBe(
      "This site names Stagecraft's package as latest, not a release number. The latest release is 1.4.1. Stagecraft can only upgrade a site whose package.json names a release of its package, so this site needs upgrading by hand. An upgrade pull request from before is still open.",
    );
    expect(summary.pullRequest).toEqual({ url: "u5", label: "Review the upgrade pull request" });
  });

  it("keeps offering the update beside an upgrade pull request opened for an older release", () => {
    const stale = { number: 5, url: "u5", kind: "upgrade", reachesTarget: false, updatesSite: true } as const;
    expect(versionSummary(info({ target: "2.0.0", latest: "2.0.0", pullRequest: stale }))).toEqual({
      tone: "behind",
      text: "This site is on 1.2.0. The latest release is 2.0.0. An update to 2.0.0 is available. An older upgrade pull request is open; upgrading the site updates it.",
      pullRequest: { url: "u5", label: "Review the upgrade pull request" },
    });
  });

  it("doesn't say a pull request at or below the site's release updates it", () => {
    // Dependabot moved the site onto the release the old upgrade pull request carries.
    const oldUpgrade = { number: 5, url: "u5", kind: "upgrade", reachesTarget: true, updatesSite: false } as const;
    expect(versionSummary(info({ current: "1.4.1", updateAvailable: false, pullRequest: oldUpgrade }))).toEqual({
      tone: "current",
      text: "This site is on 1.4.1. The latest release is 1.4.1. An upgrade pull request from before is still open.",
      pullRequest: { url: "u5", label: "Review the upgrade pull request" },
    });
    // A Dependabot bump older than the site isn't what brings the newer release.
    const oldBump = { number: 4, url: "u4", kind: "dependabot", reachesTarget: false, updatesSite: false } as const;
    expect(
      versionSummary(info({ current: "1.4.1", updateAvailable: false, latest: "1.5.0", newerRelease: "dependabot", pullRequest: oldBump })).text,
    ).toBe(
      "This site is on 1.4.1. The latest release is 1.5.0. Dependabot has a pull request open for an older release. Dependabot will update this site to 1.5.0.",
    );
  });

  it("reads a site on the release Stagecraft upgrades to as current", () => {
    expect(versionSummary(info({ current: "1.4.1", updateAvailable: false }))).toEqual({
      tone: "current",
      text: "This site is on 1.4.1. The latest release is 1.4.1.",
    });
  });

  it("says Dependabot brings a newer release in the site's major, without offering an update", () => {
    expect(
      versionSummary(info({ current: "1.4.1", updateAvailable: false, latest: "1.5.0", newerRelease: "dependabot" })),
    ).toEqual({
      tone: "unknown",
      text: "This site is on 1.4.1. The latest release is 1.5.0. Dependabot will update this site to 1.5.0.",
    });
    expect(versionSummary(info({ latest: "1.5.0", newerRelease: "dependabot" }))).toEqual({
      tone: "behind",
      text: "This site is on 1.2.0. The latest release is 1.5.0. An update to 1.4.1 is available. After this update, Dependabot will update the site to 1.5.0.",
    });
  });

  it("names Dependabot's open pull request as what brings the newer release", () => {
    const dependabot = { number: 4, url: "u4", kind: "dependabot", reachesTarget: false, updatesSite: true } as const;
    expect(
      versionSummary(info({ current: "1.4.1", updateAvailable: false, latest: "1.5.0", newerRelease: "dependabot", pullRequest: dependabot })),
    ).toEqual({
      tone: "unknown",
      text: "This site is on 1.4.1. The latest release is 1.5.0. Dependabot has a pull request open that updates it.",
      pullRequest: { url: "u4", label: "Review Dependabot's pull request" },
    });
  });

  it("says a new major waits for the platform", () => {
    expect(
      versionSummary(info({ current: "1.4.1", updateAvailable: false, latest: "2.0.0", newerRelease: "platform" })),
    ).toEqual({
      tone: "unknown",
      text: "This site is on 1.4.1. The latest release is 2.0.0. Stagecraft will be able to upgrade this site to 2.0.0 once the platform is updated.",
    });
  });

  it("says a site the upgrade would stop on over its package.json needs upgrading by hand, offering nothing", () => {
    const byHand = " Stagecraft can only upgrade a site whose package.json names a release of its package, so this site needs upgrading by hand.";
    expect(versionSummary(info({ current: "1.2.0", source: "stamp", needsHandUpgrade: true, updateAvailable: false }))).toEqual({
      tone: "unknown",
      text: `This site was created on 1.2.0, but its package.json doesn't name Stagecraft's package. The latest release is 1.4.1.${byHand}`,
    });
    expect(
      versionSummary(info({ current: "latest", currentKind: "other", needsHandUpgrade: true, updateAvailable: false })),
    ).toEqual({
      tone: "unknown",
      text: `This site names Stagecraft's package as latest, not a release number. The latest release is 1.4.1.${byHand}`,
    });
  });

  it("offers nothing when the platform has no release to upgrade to", () => {
    expect(versionSummary(info({ target: null, updateAvailable: false, latest: "2.0.0-rc.0" }))).toEqual({
      tone: "unknown",
      text: "This site is on 1.2.0. The latest release is 2.0.0-rc.0.",
    });
  });

  it("offers a full copy of the template the move onto the package", () => {
    expect(versionSummary(info({ current: null, currentKind: null, source: null })).text).toBe(
      "This site runs its own copy of the site code, not a release of Stagecraft's package. The latest release is 1.4.1. An update to 1.4.1 is available.",
    );
  });

  it("words ranges and specs that aren't versions as what package.json says, not as a release", () => {
    const on = (current: string, currentKind: SiteVersionInfo["currentKind"]) =>
      versionSummary(info({ current, currentKind, updateAvailable: false })).text.split(" The latest")[0];
    expect(on("^1.0.0", "range")).toBe("This site pins ^1.0.0.");
    expect(on("*", "any")).toBe("This site takes any release of Stagecraft's package (*).");
    expect(on("latest", "other")).toBe("This site names Stagecraft's package as latest, not a release number.");
    expect(on("git+https://github.com/x/y.git", "other")).toBe(
      "This site names Stagecraft's package as git+https://github.com/x/y.git, not a release number.",
    );
    expect(on("file:../musician-site", "other")).toBe(
      "This site names Stagecraft's package as file:../musician-site, not a release number.",
    );
  });

  it("says when the latest release couldn't be checked, apart from when there's none yet", () => {
    expect(versionSummary(info({ latest: null, latestStatus: "unreachable" }))).toEqual({
      tone: "behind",
      text: "This site is on 1.2.0. Stagecraft couldn't check the latest release. An update to 1.4.1 is available.",
    });
    // Shells pin only a published release, so with none published the site is a full copy.
    expect(
      versionSummary(
        info({ current: null, currentKind: null, source: null, target: null, updateAvailable: false, latest: null, latestStatus: "not_published" }),
      ),
    ).toEqual({
      tone: "unknown",
      text: "This site runs its own copy of the site code, not a release of Stagecraft's package. No release has been published yet.",
    });
  });
});
