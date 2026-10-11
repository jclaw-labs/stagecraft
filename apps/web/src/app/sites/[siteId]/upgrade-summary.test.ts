import { describe, expect, it } from "vitest";
import { UPGRADE_SITE_BLOCKERS } from "@stagecraft/shared";

import { UPGRADE_BLOCKER_TEXT, upgradeJobSummary } from "./upgrade-summary";

describe("upgradeJobSummary", () => {
  it("is null for a site never upgraded, or a job with a retired status", () => {
    expect(upgradeJobSummary(null)).toBeNull();
    expect(upgradeJobSummary({ status: null })).toBeNull();
  });

  it.each(["queued", "running"] as const)("reports a %s job as in flight", (status) => {
    expect(upgradeJobSummary({ status })).toMatchObject({ tone: "progress", inFlight: true });
  });

  it("links an opened or updated pull request", () => {
    const pullRequest = { number: 4, url: "https://github.com/a/b/pull/4", action: "opened" as const };
    expect(upgradeJobSummary({ status: "completed", resultPayload: { packageVersion: "1.2.0", pullRequest } })).toEqual({
      tone: "ok",
      text: "Upgrade pull request #4 to 1.2.0 opened. Review it, then merge it to finish the upgrade.",
      pullRequestUrl: "https://github.com/a/b/pull/4",
      inFlight: false,
    });
    expect(
      upgradeJobSummary({ status: "completed", resultPayload: { pullRequest: { ...pullRequest, action: "updated" } } })?.text,
    ).toBe("Upgrade pull request #4 updated. Review it, then merge it to finish the upgrade.");
  });

  it("reports a site already on the release", () => {
    expect(upgradeJobSummary({ status: "completed", resultPayload: { packageVersion: "1.2.0", upToDate: true } })?.text).toBe(
      "Stagecraft has no newer release to upgrade this site to (it's on 1.2.0).",
    );
    expect(upgradeJobSummary({ status: "completed", resultPayload: null })?.text).toBe("The last upgrade finished.");
  });

  it("names the release a site ahead of the platform's runs", () => {
    expect(
      upgradeJobSummary({ status: "completed", resultPayload: { packageVersion: "1.2.0", upToDate: true, currentVersion: "1.3.1" } })?.text,
    ).toBe("Stagecraft has no newer release to upgrade this site to (it's on 1.3.1).");
  });

  it.each(UPGRADE_SITE_BLOCKERS)("explains a %s stop as a warning", (blocker) => {
    expect(upgradeJobSummary({ status: "failed", resultPayload: { blocker } })).toEqual({
      tone: "warn",
      text: UPGRADE_BLOCKER_TEXT[blocker],
      inFlight: false,
    });
  });

  it("shows the error for a failure with no blocker", () => {
    expect(upgradeJobSummary({ status: "failed", errorMessage: "Bad gateway" })).toMatchObject({
      tone: "error",
      text: "The last upgrade failed: Bad gateway",
    });
    expect(upgradeJobSummary({ status: "failed" })?.text).toBe("The last upgrade failed: unknown error");
  });
});
