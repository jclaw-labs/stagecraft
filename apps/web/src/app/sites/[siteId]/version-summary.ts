import type { SiteVersionInfo } from "@stagecraft/shared";

/** How the version line reads: behind the latest release, on it, or unknown. */
export type VersionSummaryTone = "behind" | "current" | "unknown";

export interface VersionSummary {
  tone: VersionSummaryTone;
  text: string;
  /** The link to an open pull request that updates the site, if any. */
  pullRequest?: { url: string; label: string };
}

/**
 * The site page's version line, "on 1.2.0, latest 1.4.1" (ADR-016
 * Consequences), flagging a site that hasn't merged an update.
 */
export function versionSummary(info: SiteVersionInfo): VersionSummary {
  const on =
    info.current === null
      ? "This site runs its own copy of the site code, not a release of Stagecraft's package."
      : `This site is on ${info.current}.`;
  const latest = info.latest === null ? " Stagecraft couldn't check the latest release." : ` The latest release is ${info.latest}.`;
  const update =
    info.updateAvailable === true
      ? info.pullRequest
        ? " An update is waiting for you to merge it."
        : " An update is available."
      : "";
  const tone: VersionSummaryTone =
    info.updateAvailable === true ? "behind" : info.updateAvailable === false ? "current" : "unknown";

  const summary: VersionSummary = { tone, text: on + latest + update };
  if (info.pullRequest) {
    summary.pullRequest = {
      url: info.pullRequest.url,
      label: info.pullRequest.kind === "upgrade" ? "Review the upgrade pull request" : "Review Dependabot's pull request",
    };
  }
  return summary;
}
