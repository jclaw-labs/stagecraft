import { describe, expect, it } from "vitest";
import type { SiteVersionInfo } from "@stagecraft/shared";

import { versionSummary } from "./version-summary";

const info = (overrides: Partial<SiteVersionInfo>): SiteVersionInfo => ({
  current: "1.2.0",
  currentKind: "version",
  source: "package_json",
  target: "1.4.1",
  updateAvailable: true,
  latest: "1.4.1",
  latestStatus: "published",
  newerReleaseOut: false,
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
    const summary = versionSummary(info({ pullRequest: { number: 4, url: "https://github.com/x/y/pull/4", kind: "dependabot" } }));
    expect(summary.text).toContain("waiting for you to merge it");
    expect(summary.pullRequest).toEqual({ url: "https://github.com/x/y/pull/4", label: "Review Dependabot's pull request" });
    expect(
      versionSummary(info({ pullRequest: { number: 5, url: "u", kind: "upgrade" } })).pullRequest?.label,
    ).toBe("Review the upgrade pull request");
  });

  it("explains a pull request still open on a site with nothing to upgrade", () => {
    const summary = versionSummary(
      info({ current: "1.4.1", updateAvailable: false, pullRequest: { number: 5, url: "u", kind: "upgrade" } }),
    );
    expect(summary).toMatchObject({
      tone: "current",
      text: "This site is on 1.4.1. The latest release is 1.4.1. A pull request that updates it is open.",
    });
  });

  it("reads a site on the release Stagecraft upgrades to as current", () => {
    expect(versionSummary(info({ current: "1.4.1", updateAvailable: false }))).toEqual({
      tone: "current",
      text: "This site is on 1.4.1. The latest release is 1.4.1.",
    });
  });

  it("says a newer release than the platform's is out, without offering an update", () => {
    expect(
      versionSummary(info({ current: "1.4.1", target: "1.4.1", updateAvailable: false, latest: "1.5.0", newerReleaseOut: true })),
    ).toEqual({
      tone: "unknown",
      text: "This site is on 1.4.1. The latest release is 1.5.0. Stagecraft will be able to upgrade this site to 1.5.0 once the platform is updated.",
    });
    expect(versionSummary(info({ target: "1.4.1", latest: "1.5.0", newerReleaseOut: true }))).toEqual({
      tone: "behind",
      text: "This site is on 1.2.0. The latest release is 1.5.0. An update to 1.4.1 is available. Stagecraft will be able to upgrade this site to 1.5.0 once the platform is updated.",
    });
  });

  it("offers nothing when the platform has no release to upgrade to", () => {
    expect(versionSummary(info({ target: null, updateAvailable: false, latest: "2.0.0-rc.0" }))).toEqual({
      tone: "unknown",
      text: "This site is on 1.2.0. The latest release is 2.0.0-rc.0.",
    });
  });

  it("says when the site isn't on the package", () => {
    expect(versionSummary(info({ current: null, currentKind: null, source: null })).text).toBe(
      "This site runs its own copy of the site code, not a release of Stagecraft's package. The latest release is 1.4.1. An update to 1.4.1 is available.",
    );
  });

  it("words a stamp-only version as the release the site was created on", () => {
    expect(versionSummary(info({ current: "1.4.1", source: "stamp" }))).toEqual({
      tone: "behind",
      text: "This site was created on 1.4.1, but its package.json doesn't name Stagecraft's package. The latest release is 1.4.1. An update to 1.4.1 is available.",
    });
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
    expect(versionSummary(info({ target: null, updateAvailable: false, latest: null, latestStatus: "not_published" }))).toEqual({
      tone: "unknown",
      text: "This site is on 1.2.0. No release has been published yet.",
    });
  });
});
