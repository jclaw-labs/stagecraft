/**
 * Files the platform injects into every generated artist-site repo, on top
 * of the template copy. A site is a one-time copy of the template (see
 * create-site.ts / migrate-site.ts) and never tracks it again, so without
 * these its dependencies would drift forever and never receive security
 * patches. We inject:
 *   - `.github/dependabot.yml` — ongoing npm updates (7-day cooldown)
 *   - `.stagecraft-template.json` — source template + version at creation,
 *     so the platform can later detect drift.
 *
 * NOTE: auto-merging those Dependabot PRs would need an in-repo Actions
 * workflow, but the platform pushes site files with the user's OAuth token
 * (scope `repo`, no `workflow` — see auth.ts), and GitHub rejects pushing
 * `.github/workflows/*` without the `workflow` scope. So the cooldown PRs
 * land but auto-merge is out of scope here pending an auth decision.
 */
import type { TemplateFile } from "@/lib/template-reader";

/** Which on-disk template a generated site was scaffolded from. */
export type ArtistTemplate = "musician-site" | "musician-site-legacy";

/**
 * Days a newly published release must age before Dependabot proposes it on
 * a generated site. Mirrors the monorepo's Renovate `minimumReleaseAge`
 * (renovate.json) so platform and artist repos share one cooldown window.
 * Dependabot *security* updates run independently and are not delayed.
 */
export const SITE_DEPENDENCY_COOLDOWN_DAYS = 7;

export const SITE_DEPENDABOT_PATH = ".github/dependabot.yml";
export const TEMPLATE_STAMP_PATH = ".stagecraft-template.json";

interface TemplateStampInput {
  template: ArtistTemplate;
  templateVersion: string;
  createdAt?: Date;
}

function buildDependabotYml(): string {
  return `# Managed by Stagecraft — keeps this site's npm dependencies current.
# Version updates wait ${SITE_DEPENDENCY_COOLDOWN_DAYS} days after a release is published, so a
# freshly-published (and occasionally compromised) version ages before it
# is proposed here. Dependabot security updates are separate and are not
# delayed by this cooldown.
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    cooldown:
      default-days: ${SITE_DEPENDENCY_COOLDOWN_DAYS}
    open-pull-requests-limit: 5
`;
}

function buildTemplateStamp({
  template,
  templateVersion,
  createdAt = new Date(),
}: TemplateStampInput): string {
  return (
    JSON.stringify(
      { template, templateVersion, createdAt: createdAt.toISOString() },
      null,
      2,
    ) + "\n"
  );
}

/**
 * Pull `version` from the template's root package.json among the
 * already-read template files. Falls back to "unknown" when the file is
 * absent or unparseable (e.g. tests that stub the reader).
 */
export function templateVersionFromFiles(files: TemplateFile[]): string {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return "unknown";
  try {
    const parsed = JSON.parse(pkg.content) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The non-template files injected into a generated site repo:
 *  - `.github/dependabot.yml` — ongoing npm updates with the cooldown
 *  - `.stagecraft-template.json` — source template + version at creation,
 *    so the platform can later detect drift from the current template.
 */
export function buildSiteScaffoldFiles(input: TemplateStampInput): TemplateFile[] {
  return [
    { path: SITE_DEPENDABOT_PATH, content: buildDependabotYml() },
    { path: TEMPLATE_STAMP_PATH, content: buildTemplateStamp(input) },
  ];
}
