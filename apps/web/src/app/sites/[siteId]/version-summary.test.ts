import { describe, expect, it } from "vitest";
import type { SiteVersionInfo } from "@stagecraft/shared";

import { versionSummary } from "./version-summary";

const info = (overrides: Partial<SiteVersionInfo>): SiteVersionInfo => ({
  current: "1.2.0",
  source: "package_json",
  latest: "1.4.1",
  updateAvailable: true,
  pullRequest: null,
  ...overrides,
});

describe("versionSummary", () => {
  it("flags a site behind the latest release", () => {
    expect(versionSummary(info({}))).toEqual({
      tone: "behind",
      text: "This site is on 1.2.0. The latest release is 1.4.1. An update is available.",
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

  it("reads a site on the latest release as current", () => {
    expect(versionSummary(info({ current: "1.4.1", updateAvailable: false }))).toEqual({
      tone: "current",
      text: "This site is on 1.4.1. The latest release is 1.4.1.",
    });
  });

  it("says when the site isn't on the package", () => {
    expect(versionSummary(info({ current: null, source: null })).text).toBe(
      "This site runs its own copy of the site code, not a release of Stagecraft's package. The latest release is 1.4.1. An update is available.",
    );
  });

  it("says when the latest release couldn't be checked", () => {
    expect(versionSummary(info({ latest: null, updateAvailable: null }))).toEqual({
      tone: "unknown",
      text: "This site is on 1.2.0. Stagecraft couldn't check the latest release.",
    });
  });
});
