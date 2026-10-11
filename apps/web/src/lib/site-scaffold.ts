/**
 * Files the platform injects into every generated artist-site repo, on top
 * of the bundled site files (see create-site.ts / migrate-site.ts). A site
 * is either the artist-repo shell on an exact `@jclaw-labs/musician-site`
 * release, or (until a release is on npm's `latest`) a one-time copy of the
 * template that never tracks it again (ADR-016). Either way, without these
 * its dependencies would drift and never receive security patches. We
 * inject:
 *   - `.github/dependabot.yml` — ongoing npm updates (7-day cooldown, which
 *     our own package skips; majors of the package and the framework are
 *     left to a platform upgrade PR)
 *   - `.stagecraft-template.json` — source template, the package version
 *     and a manifest of our code paths at creation (ADR-016 §4), so the
 *     platform can later tell which version a site runs and whether the
 *     artist changed our files.
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
import { createHash } from "node:crypto";

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

/**
 * The npm package a site on the shell depends on (ADR-016 §2). It must
 * match `name` in `templates/musician-site/package.json`, which the bundle
 * generator reads; a test keeps the two equal.
 */
export const MUSICIAN_SITE_PACKAGE = "@jclaw-labs/musician-site";

/**
 * Dependencies whose major updates Dependabot never proposes on a site. A
 * major of the package or the framework needs shell or code changes, so it
 * arrives as a platform upgrade PR instead (ADR-016 §3), and the artist
 * never sees a Dependabot PR that can't build.
 */
export const SITE_MAJOR_UPDATES_IGNORED = [MUSICIAN_SITE_PACKAGE, "next", "react", "react-dom"] as const;

/**
 * Paths that are the artist's, not ours: the content the CMS writes and
 * the images it uploads. Everything else the bundle pushes is our code and
 * goes in the stamp's manifest.
 */
const ARTIST_PATH_PREFIXES = ["src/content/", "public/"] as const;

/** Path → git blob SHA of each of our files a site was created with. */
export type CodePathManifest = Record<string, string>;

/** The `.stagecraft-template.json` stamp. */
export interface TemplateStamp {
  template: ArtistTemplate;
  /** `version` in the site's package.json when it was created. */
  templateVersion: string;
  /**
   * The exact `@jclaw-labs/musician-site` version a shell site was created
   * on, or null for a full copy of the template.
   */
  packageVersion: string | null;
  /**
   * Our files at creation (every pushed file outside `ARTIST_PATH_PREFIXES`),
   * with their git blob SHAs: the baseline `upgrade_site` compares a site
   * against to find files the artist changed (ADR-016 §4).
   */
  manifest: CodePathManifest;
  createdAt: string;
}

interface TemplateStampInput {
  template: ArtistTemplate;
  /** The site's files as pushed (bundle plus any content overlay), without the scaffold. */
  files: TemplateFile[];
  createdAt?: Date;
}

function buildDependabotYml(): string {
  const ignored = SITE_MAJOR_UPDATES_IGNORED.map(
    (name) => `      - dependency-name: "${name}"
        update-types: ["version-update:semver-major"]`,
  ).join("\n");
  return `# Managed by Stagecraft — keeps this site's npm dependencies current.
# Version updates wait ${SITE_DEPENDENCY_COOLDOWN_DAYS} days after a release is published, so a
# freshly-published (and occasionally compromised) version ages before it
# is proposed here. Dependabot security updates are separate and are not
# delayed by this cooldown. ${MUSICIAN_SITE_PACKAGE} skips the cooldown:
# it's Stagecraft's own package, and a cooldown would only hold back its
# fixes. Major updates of it and of Next.js and React come as a Stagecraft
# upgrade pull request instead, since they can need changes to this repo.
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    cooldown:
      default-days: ${SITE_DEPENDENCY_COOLDOWN_DAYS}
      exclude:
        - "${MUSICIAN_SITE_PACKAGE}"
    ignore:
${ignored}
    open-pull-requests-limit: 5
`;
}

/** The git blob SHA of `content` (UTF-8), as GitHub reports it for the file. */
export function gitBlobSha(content: string): string {
  const body = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

/** Our files among `files` (`ARTIST_PATH_PREFIXES` left out), by path, with their blob SHAs. */
export function codePathManifest(files: TemplateFile[]): CodePathManifest {
  const ours = files
    .filter((f) => !ARTIST_PATH_PREFIXES.some((prefix) => f.path.startsWith(prefix)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return Object.fromEntries(ours.map((f) => [f.path, gitBlobSha(f.content)]));
}

/** An exact release or prerelease version, as the bundle pins the package. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The exact `@jclaw-labs/musician-site` version the site's package.json
 * depends on, or null when it doesn't depend on the package at an exact
 * version (a full copy of the template), or the file is absent or
 * unparseable.
 */
export function packageVersionFromFiles(files: TemplateFile[]): string | null {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return null;
  try {
    const parsed = JSON.parse(pkg.content) as { dependencies?: Record<string, unknown> };
    const spec = parsed.dependencies?.[MUSICIAN_SITE_PACKAGE];
    return typeof spec === "string" && EXACT_VERSION.test(spec) ? spec : null;
  } catch {
    return null;
  }
}

export function buildTemplateStamp({ template, files, createdAt = new Date() }: TemplateStampInput): TemplateStamp {
  return {
    template,
    templateVersion: templateVersionFromFiles(files),
    packageVersion: packageVersionFromFiles(files),
    manifest: codePathManifest(files),
    createdAt: createdAt.toISOString(),
  };
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
 *  - `.stagecraft-template.json` — the stamp (`TemplateStamp`), recorded
 *    from `input.files`, the site's files as pushed.
 */
export function buildSiteScaffoldFiles(input: TemplateStampInput): TemplateFile[] {
  return [
    { path: SITE_DEPENDABOT_PATH, content: buildDependabotYml() },
    { path: TEMPLATE_STAMP_PATH, content: JSON.stringify(buildTemplateStamp(input), null, 2) + "\n" },
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
