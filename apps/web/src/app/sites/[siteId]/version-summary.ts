import type { SiteVersionInfo } from "@stagecraft/shared";

/**
 * How the version line reads: an upgrade is available, the site is on the
 * release Stagecraft upgrades to, or neither can be said (nothing to upgrade
 * to yet, a newer release on its way, or a site that needs upgrading by
 * hand).
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

/** What the artist is told when the upgrade would stop over package.json (`customized`, by hand). */
const HAND_UPGRADE_SENTENCE =
  " Stagecraft can only upgrade a site whose package.json names a release of its package, so this site needs upgrading by hand.";

/**
 * Whether the open pull request isn't the update on offer: a Dependabot
 * bump in the site's old major or older than the platform's release, or an
 * upgrade pull request opened for an older one. It's mentioned, but
 * "Upgrade site" is still the update.
 */
function isBesideUpdate(info: SiteVersionInfo): boolean {
  return info.updateAvailable && info.pullRequest !== null && !info.pullRequest.reachesTarget;
}

/** How a newer release on npm reaches the site (ADR-016 §3). */
function newerSentence(info: SiteVersionInfo): string {
  switch (info.newerRelease) {
    case "dependabot":
      // An open Dependabot pull request is the one bringing it, said already,
      // unless it's a bump beside the update on offer or one the site is past.
      if (info.pullRequest?.kind === "dependabot" && info.pullRequest.updatesSite && !isBesideUpdate(info)) return "";
      return info.updateAvailable
        ? ` After this update, Dependabot will update the site to ${info.latest}.`
        : ` Dependabot will update this site to ${info.latest}.`;
    case "platform":
      return ` Stagecraft will be able to upgrade this site to ${info.latest} once the platform is updated.`;
    default:
      return "";
  }
}

/**
 * The site page's version line, "on 1.2.0, latest 1.4.1" (ADR-016
 * Consequences). It offers an update only when "Upgrade site" would make
 * one, says when the site needs upgrading by hand instead, and says how a
 * release newer than the platform's reaches the site: Dependabot within the
 * site's major, the platform for a new one.
 */
export function versionSummary(info: SiteVersionInfo): VersionSummary {
  let update = "";
  if (info.needsHandUpgrade) {
    update = HAND_UPGRADE_SENTENCE;
  } else if (info.updateAvailable) {
    update = info.pullRequest?.reachesTarget
      ? " An update is waiting for you to merge it."
      : ` An update to ${info.target} is available.`;
  }
  const pull = info.pullRequest;
  if (pull && isBesideUpdate(info)) {
    // The job rewrites its own pull request onto the new release when it runs again.
    update +=
      pull.kind === "dependabot"
        ? " Dependabot also has a pull request open."
        : " An older upgrade pull request is open; upgrading the site updates it.";
  } else if (!info.updateAvailable && pull) {
    if (pull.kind === "dependabot") {
      update += pull.updatesSite
        ? " Dependabot has a pull request open that updates it."
        : " Dependabot has a pull request open for an older release.";
    } else {
      // A site that needs upgrading by hand can't take the platform's
      // upgrade, and one already on its release doesn't need it.
      update +=
        info.needsHandUpgrade || !pull.updatesSite
          ? " An upgrade pull request from before is still open."
          : " A pull request that updates it is open.";
    }
  }
  const tone: VersionSummaryTone = info.updateAvailable
    ? "behind"
    : !info.needsHandUpgrade && info.newerRelease === null && info.target !== null
      ? "current"
      : "unknown";

  const summary: VersionSummary = { tone, text: onSentence(info) + latestSentence(info) + update + newerSentence(info) };
  if (info.pullRequest) {
    summary.pullRequest = {
      url: info.pullRequest.url,
      label: info.pullRequest.kind === "upgrade" ? "Review the upgrade pull request" : "Review Dependabot's pull request",
    };
  }
  return summary;
}
