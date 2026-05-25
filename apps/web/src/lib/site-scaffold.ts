/**
 * Files the platform injects into every generated artist-site repo, on top
 * of the template copy. A site is a one-time copy of the template (see
 * create-site.ts / migrate-site.ts) and never tracks it again, so without
 * these its dependencies would drift forever and never receive security
 * patches. We inject:
 *   - `.github/dependabot.yml` — ongoing npm updates (7-day cooldown)
 *   - `.stagecraft-template.json` — source template + version at creation,
 *     so the platform can later detect drift.
 *   - (pushed separately) `.github/workflows/dependabot-auto-merge.yml` —
 *     builds the site and auto-merges Dependabot's passing patch/minor PRs.
 *
 * The dependabot config + stamp ship in the main scaffold push
 * (`buildSiteScaffoldFiles`). The auto-merge workflow
 * (`buildDependabotAutoMergeWorkflow`) is pushed on its own because writing
 * under `.github/workflows/*` needs the `workflow` OAuth scope (auth.ts);
 * the caller pushes it best-effort, so a token issued before we requested
 * that scope still creates the site — just without the workflow.
 */
import type { TemplateFile } from "@/lib/template-reader";

/** Which on-disk template a generated site was scaffolded from. */
export type ArtistTemplate = "musician-site";

/**
 * Days a newly published release must age before Dependabot proposes it on
 * a generated site. Mirrors the monorepo's Renovate `minimumReleaseAge`
 * (renovate.json) so platform and artist repos share one cooldown window.
 * Dependabot *security* updates run independently and are not delayed.
 */
export const SITE_DEPENDENCY_COOLDOWN_DAYS = 7;

export const SITE_DEPENDABOT_PATH = ".github/dependabot.yml";
export const SITE_AUTOMERGE_WORKFLOW_PATH = ".github/workflows/dependabot-auto-merge.yml";
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

/**
 * A self-gating auto-merge workflow for the site's Dependabot PRs, pushed
 * separately from the main scaffold (it lives under `.github/workflows/`,
 * which needs the `workflow` OAuth scope). The build step is the gate: if
 * `npm run build` fails the job fails and the merge step never runs, so a
 * broken update can't land — no branch protection needed on the artist's
 * repo. Only patch/minor auto-merge; majors stay open. Generated repos ship
 * no lockfile, so the gate installs rather than `npm ci`. (The Actions
 * `${{ ... }}` expressions are backslash-escaped so the `$` survives the
 * template literal.)
 */
export function buildDependabotAutoMergeWorkflow(): string {
  return `# Managed by Stagecraft — auto-merges Dependabot's patch & minor updates
# once the site still builds. The build step below is the gate, so no
# branch protection is needed; major updates are left open for review.
name: Dependabot auto-merge

on: pull_request

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    if: github.event.pull_request.user.login == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      # Build gate. Generated sites ship no lockfile, so install (not ci).
      - run: npm install
      - run: npm run build

      - name: Dependabot metadata
        id: meta
        uses: dependabot/fetch-metadata@v2
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}

      - name: Merge patch & minor
        if: steps.meta.outputs.update-type == 'version-update:semver-patch' || steps.meta.outputs.update-type == 'version-update:semver-minor'
        env:
          PR_URL: \${{ github.event.pull_request.html_url }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gh pr merge --squash --delete-branch "\$PR_URL"
`;
}
