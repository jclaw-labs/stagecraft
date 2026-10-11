import type { SiteVersionInfo } from "@stagecraft/shared";

/**
 * How the version line reads: an upgrade is available, the site is on the
 * release Stagecraft upgrades to, or neither can be said (nothing to upgrade
 * to yet, or a newer release the platform can't offer until it's updated).
 */
export type VersionSummaryTone = "behind" | "current" | "unknown";

export interface VersionSummary {
  tone: VersionSummaryTone;
  text: string;
  /** The link to an open pull request that updates the site, if any. */
  pullRequest?: { url: string; label: string };
}

function onSentence(info: SiteVersionInfo): string {
  const { current } = info;
  if (current === null) return "This site runs its own copy of the site code, not a release of Stagecraft's package.";
  if (info.source === "stamp") {
    return `This site was created on ${current}, but its package.json doesn't name Stagecraft's package.`;
  }
  switch (info.currentKind) {
    case "version":
      return `This site is on ${current}.`;
    case "range":
      return `This site pins ${current}.`;
    case "any":
      return `This site takes any release of Stagecraft's package (${current}).`;
    default:
      return `This site names Stagecraft's package as ${current}, not a release number.`;
  }
}

function latestSentence(info: SiteVersionInfo): string {
  if (info.latestStatus === "not_published") return " No release has been published yet.";
  if (info.latestStatus === "unreachable" || info.latest === null) return " Stagecraft couldn't check the latest release.";
  return ` The latest release is ${info.latest}.`;
}

/**
 * The site page's version line, "on 1.2.0, latest 1.4.1" (ADR-016
 * Consequences). It offers an update only when "Upgrade site" would make
 * one, and says so when npm has a newer release than the platform can
 * upgrade to yet.
 */
export function versionSummary(info: SiteVersionInfo): VersionSummary {
  let update = "";
  if (info.updateAvailable) {
    update = info.pullRequest ? " An update is waiting for you to merge it." : ` An update to ${info.target} is available.`;
  } else if (info.pullRequest) {
    update = " A pull request that updates it is open.";
  }
  const newer = info.newerReleaseOut
    ? ` Stagecraft will be able to upgrade this site to ${info.latest} once the platform is updated.`
    : "";
  const tone: VersionSummaryTone = info.updateAvailable
    ? "behind"
    : !info.newerReleaseOut && info.target !== null
      ? "current"
      : "unknown";

  const summary: VersionSummary = { tone, text: onSentence(info) + latestSentence(info) + update + newer };
  if (info.pullRequest) {
    summary.pullRequest = {
      url: info.pullRequest.url,
      label: info.pullRequest.kind === "upgrade" ? "Review the upgrade pull request" : "Review Dependabot's pull request",
    };
  }
  return summary;
}
