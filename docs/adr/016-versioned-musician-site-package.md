# ADR-016: Ship the Musician-Site Template as a Versioned Package

## Status
Proposed. The direction (versioning) was decided on #341 on 2026-10-10.
This ADR settles the details for #397 and splits the build into the
follow-up issues at the end.

## Context
Every artist site is a one-time copy of `templates/musician-site/`: the
public renderer, the `/admin` CMS, the API routes, the git plumbing, the
image pipeline and auth. Provisioning (`apps/web/src/lib/jobs/provision-site.ts`)
pushes the bundled template into a new repo and never touches it again.
The template's `package.json` version has always been `0.0.1`, and nothing
reads the `.stagecraft-template.json` stamp that `site-scaffold.ts` writes.
So no fix reaches a site after it's created, security fixes included. #314
(`next` stuck on a vulnerable version in existing site repos) is one
symptom.

What a site copy holds today, excluding tests:

| Path | Files | What it is |
| --- | --- | --- |
| `src/lib/` (incl. `collections/`) | ~90 | Content store, schemas, draft branches, publish, auth, image processing |
| `src/components/` (incl. `admin/`) | ~45 | Public blocks and CMS UI |
| `src/app/admin/` | 18 pages | The CMS |
| `src/app/api/` | 19 routes | Auth, save/publish, collections, uploads, contact, welcome |
| `src/app/(public)/`, `layout.tsx`, `global-not-found.tsx`, `src/middleware.ts` | 6 | Public catch-all, root layout, 404, `/admin` gate |
| `src/puck/` | 6 | Puck editor config |
| `src/content/` | 26 | The artist's content (JSON) |
| `next.config.ts`, `tsconfig.json`, `package.json`, `.env.example` | 4 | App config |

Only `src/content/` and `public/images/` are the artist's. Everything
else is ours, and is what needs to keep updating.

The owner's constraints (#341, #342, #398):

- The site stays a plain set of files in the artist's own git repo, with
  full history. No database for content.
- It stays free: no paid registry, no paid hosting tier. Netlify and
  Vercel free tiers must still build it.
- New artist repos are private (#398, PR #406). `jclaw-labs/stagecraft`
  is public.

Some facts that shape the decision:

- Generated repos ship **no lockfile** (`package-lock.json` is in
  `TEMPLATE_SKIP_FILES`, and the platform worker can't run `npm install`).
  Hosts resolve `^` ranges fresh on every build.
- Artist repos get Dependabot (weekly, 7-day cooldown) plus an auto-merge
  workflow that builds the site and merges passing patch and minor PRs.
  Majors stay open. The workflow push is best-effort, so some repos don't
  have it.
- Content is read from `process.cwd()/src/content` and images are written
  under `process.cwd()/public/images` (`fs-helpers.ts`, `image.ts`), so
  code that runs from `node_modules` still finds the site's files.
- Collection definitions carry `schemaVersion` (currently `1`), but the
  schema accepts only `z.literal(CURRENT_COLLECTION_SCHEMA_VERSION)`.
  Items and Puck page data carry no version.
- Drafts live on per-editor `draft/*` branches (ADR-010, ADR-011) and
  hold content only.

## Decision
Move all of our code into one npm package, **`@stagecraft/musician-site`**,
published publicly to npm. The artist repo keeps its content, its images
and a thin Next.js app shell that imports the package. Sites take patch
and minor releases through the Dependabot auto-merge they already have.
Majors, and the one-time move of existing sites, arrive as a pull request
the platform opens on the site repo.

### 1. Package boundary

The rule: **anything the artist edits through the CMS stays a file in
their repo; anything we'd want to fix later goes in the package.**

**In the package** (`@stagecraft/musician-site`):

- Public renderer: the `[[...slug]]` catch-all, root layout, global 404,
  the block components, the template walker, the Puck configs and
  `globals.css`.
- The `/admin` CMS: every admin page and admin component, behind a single
  admin router.
- The API routes, behind a single API router that dispatches on path and
  method.
- Middleware: session verification and the list of public admin paths.
- Git plumbing, auth and email: draft branches, publish, the broker client,
  the magic link and the session.
- Image pipeline: `sharp` processing, SVG sanitising and the variant
  scheme.
- Content schemas, starter seeds, theme presets and the content upgraders
  (§3).
- The `next.config` settings (SVG/ICO headers, `globalNotFound`), exported
  as a `withStagecraft()` wrapper.
- A small CLI, `stagecraft-site`, with `migrate-content` (§3) and
  `regenerate-images` (the out-of-band variant script from ADR-007 §6).

**In the artist repo**:

- `src/content/`, `public/images/` and anything else under `public/`.
- `package.json`, which depends on `next`, `react`, `react-dom` and
  `@stagecraft/musician-site` (pinned exact).
- The shell, about eight files that each re-export from the package:
  - `next.config.ts`: `export default withStagecraft({})`
  - `src/middleware.ts`: re-exports `middleware`, plus a literal
    `config.matcher` of `/admin/:path*` and `/api/:path*`
  - `src/app/layout.tsx` and `src/app/global-not-found.tsx`
  - `src/app/(public)/[[...slug]]/page.tsx`: `default`,
    `generateMetadata`, `generateStaticParams`, and a literal
    `dynamicParams = false`
  - `src/app/admin/[[...path]]/page.tsx`: the admin router, with a
    literal `dynamic = "force-dynamic"`
  - `src/app/api/[...path]/route.ts`: `GET`, `POST`, `PUT`, `PATCH` and
    `DELETE` from the API router
- `tsconfig.json`, `.gitignore`, `.env.example`, the platform-managed
  `.github/` files and `.stagecraft-template.json`.

Collapsing 18 admin pages and 19 API routes into two catch-alls is the
main refactor here, and it's what makes the shell stable. With a file per
route, every new admin page or endpoint would change the shell, and
anything that changes the shell is a major (§3). Route segment config
(`dynamic`, `dynamicParams`, the middleware `matcher`) has to be a literal
in the route file because Next.js reads it statically, which is why those
values sit in the shell. The middleware matcher widens to all of
`/admin` and `/api`, and the package decides which paths are public, so
a new protected endpoint doesn't need a shell change either. The Puck
editor stylesheet stays confined to the admin segment (#348).

Packaging mechanics:

- `@/…` path aliases become Node subpath imports (`#lib/…`,
  `#components/…`) declared in the package's `imports` field. A
  consumer's `@/` would otherwise resolve against the consumer's own
  `src/`.
- Compile with `tsc` to ESM in `dist/`, one output file per source file,
  with no bundler. That keeps each module's `"use client"` directive, and
  it ships `.d.ts` files so the site's typecheck never compiles our source.
- `next`, `react` and `react-dom` are peer dependencies (`next` at
  `>=15.5.27 <16`). Next.js needs `next` in the app's own `package.json`
  to build, and Netlify and Vercel detect the framework from it. All
  other runtime dependencies (Puck, Octokit, `sharp`, `jose`, `resend`,
  `zod`, DOMPurify) are regular dependencies of the package, pinned
  exact, so a security fix to any of them ships as a package patch
  release.

**In the monorepo**, `templates/musician-site/` stays the package source,
with its tests, e2e suite, design docs, lockfile and CI job. It becomes
the public, non-`private` `@stagecraft/musician-site`. A new
`templates/musician-site-shell/` holds what gets copied into artist repos:
the shell files plus the starter content that lives in `src/content/`
today. In the monorepo the shell depends on the package through
`file:../musician-site`, so local dev, e2e and screenshot capture run the
same shape an artist site runs. The template bundle generator
(`apps/web/scripts/generate-template-bundle.mjs`) reads the shell and
rewrites that `file:` dependency to the exact published version.

This leaves option A from #341 (a platform-hosted editor) open: the admin
and API routers are already separate entry points, so moving them off the
artist's host later wouldn't need another repo-layout change.

### 2. Publishing: public npm, with trusted publishing

Publish `@stagecraft/musician-site` as a **public npm package**. Public
packages on npm are free. Releases go out from a GitHub Actions workflow
in `jclaw-labs/stagecraft` using npm trusted publishing (OIDC), so there's
no long-lived npm token, with provenance attached while the repo is
public.

Installing from a git tag of `jclaw-labs/stagecraft` loses on every count
that matters:

- **npm can't install a subdirectory of a git repo.** The package lives
  at `templates/musician-site/` in a monorepo, so a git install would
  need a separate repo or a built-artifacts branch to tag, which is
  reinventing a registry.
- **Git dependencies run `prepare` on install.** The host has to install
  our dev dependencies and compile the package inside every site build.
  That makes builds slower, adds failure modes, and git dependencies cache
  poorly on Netlify and Vercel.
- **Dependabot gets no semver signal.** It can bump a git tag, but
  `dependabot/fetch-metadata` doesn't classify the change as patch or
  minor, so the auto-merge workflow would never merge it. A tarball URL
  from a GitHub Release has the same problem, and Dependabot doesn't
  update tarball URLs at all.
- **It ties every artist build to our repo's visibility.** If
  `jclaw-labs/stagecraft` ever went private, every site build would start
  failing on an unauthenticated fetch.

npm adds no new failure mode to a host build: Netlify and Vercel already
pull several hundred packages from the registry on every build.

**Repo visibility.** Artist repos being private (#398) doesn't matter: a
public package installs without a token. The stagecraft repo's visibility
doesn't matter for installs either. It only affects npm provenance, which
needs a public source repo, and would be lost (not broken) if the repo
went private. The package's source is already public, and secrets live in
host env vars, never in the package, so publishing it exposes nothing new.

**Name.** No packages exist under the `@stagecraft` scope on npm today,
but the org name has to be claimed before anything ships (follow-up 1). If
it's taken, publish as `@jclaw-labs/musician-site` instead. The name
appears only in the shell, the bundle generator and the Dependabot config.

**Release flow.** Bumping `version` in `templates/musician-site/package.json`
on `main` publishes the release. CI checks that any PR touching package
source adds a `CHANGELOG.md` entry marked patch, minor or major. Before
publishing, CI runs `npm pack`, installs the tarball into a fresh copy of
the shell **without a lockfile**, and runs `next build`, which is what
Netlify and Vercel will do. Release candidates go to the `next` dist-tag,
which Dependabot ignores, so a test site can opt in by hand.

### 3. Upgrades and semver

**Patch and minor** releases ride the Dependabot auto-merge that sites
already have. The `next build` step in that workflow is the gate. Two
changes to the generated `dependabot.yml`:

- Exclude `@stagecraft/musician-site` from the 7-day cooldown. The
  cooldown guards against freshly compromised third-party releases, and
  for our own package it would only hold back our security fixes by a
  week. Trusted publishing covers that risk for us.
- Ignore `semver-major` updates for `@stagecraft/musician-site`, `next`,
  `react` and `react-dom`. Those come as a platform PR (below), so the
  artist never sees a Dependabot PR that can't build.

The package is pinned exact in the shell. Since sites have no lockfile, a
`^` range would let every host build pick up a new minor and skip the
build gate.

**What counts as major.** A release is major when an artist repo needs a
change the package can't make by itself:

- the shell changes: a new or renamed shell file, a changed export, or a
  new literal route config or middleware matcher
- a new peer major (Next 16, React 20) or a higher Node `engines` floor
- a new **required** env var, or a renamed one
- dropping the reader for an old content `schemaVersion`
- a change to the on-disk layout of `src/content/` or `public/images/`
  that needs files moved

Everything else is minor or patch: new blocks, admin pages, endpoints,
optional env vars, lazy content upgrades (below), dependency bumps, and
raising the `next` peer floor within the same major. That last one is
safe because sites without a lockfile resolve `next` to the newest 15.x
on every build anyway.

To make "shell too old" a build failure rather than a runtime surprise,
the stamp records `shellVersion`. `withStagecraft()` fails `next build`
with a clear message when the shell is older than the package requires,
so a mismatched release fails the Dependabot gate instead of reaching the
site.

**Content format (`schemaVersion`) changes migrate lazily, on read.**
The package keeps an upgrader chain, `upgrade_1_to_2`, `upgrade_2_to_3`
and so on. These are pure, idempotent functions. The reader accepts every
version from the oldest supported up to the current one, upgrades in
memory, and the CMS writes the file back at the current version the next
time the artist saves it. Readers fail closed on a version newer than they
know, with an error naming the package version needed.

We pick lazy over an eager rewrite of every file because of the draft
branches. An eager migration commit on `main` would conflict with every
`draft/*` branch holding older-format edits. A lazy reader handles
`main` and the drafts the same way, so it never has to rebase or rewrite
them. Shipping a new upgrader is therefore a minor. Dropping an old one is
a major, and that major's upgrade PR first runs
`stagecraft-site migrate-content` to rewrite the files eagerly, in the
same PR.

`schemaVersion` lives on `_collection.json` only. Item files and Puck page
data stay unversioned, so changes to them must be read-compatible within
a major: additive props with defaults, or a normalizer that runs on read
(Puck's `migrate` / `resolveData` fit here). If a non-additive item change
is ever needed, add a per-item `schemaVersion` first, as its own minor.

Upgrades are forward-only. After the CMS has written version N content,
rolling the package back below the version that introduced N fails
closed. That's acceptable because Dependabot never downgrades.

### 4. Moving existing sites: an `upgrade_site` job that opens a PR

Add a reusable platform job, **`upgrade_site`**, that opens a pull request
on a site's repo to bring it onto the package. It's the same job that
later delivers major upgrades. `migrate_site` isn't the right tool: it
crawls an external site and provisions a **new** repo, and here we need to
change an existing one in place. A one-off script would be thrown away the
first time we ship a major.

What the PR does:

- deletes our code (`src/lib/`, `src/components/`, `src/puck/`, the old
  `src/app/` routes, `src/middleware.ts`) and writes the shell
- rewrites `package.json` and deletes any committed `package-lock.json`,
  so every site matches what generated sites look like and builds the
  same way
- leaves `src/content/` and `public/images/` untouched, then runs any
  content migration the target major needs
- writes `.stagecraft-template.json` with `shellVersion` and the package
  version, and rewrites the Dependabot config and auto-merge workflow
  (re-adding the workflow on repos whose best-effort push failed)

How it runs:

- **Credentials.** It uses the site owner's stored GitHub OAuth token,
  which has `repo workflow` scopes, as provisioning does. The GitHub App
  doesn't have `Pull requests` or `Workflows` permission (ADR-008), and
  this isn't a reason to widen it. If the token is stale, the job fails
  and asks the artist to sign in again.
- **Customized sites.** The artist owns their files and may have edited
  our code. Before writing anything, the job compares every non-content
  path at `HEAD` against the repo's first commit (the provisioning push).
  If any of our files changed, it opens no PR and records which files
  changed, so the site is handled by hand.
- **Idempotent.** It reuses one branch, `stagecraft/upgrade`, and one open
  PR, so re-running it updates the PR rather than opening a new one.
- **Review.** The host's deploy preview builds the PR. Nothing
  auto-merges. Draft branches hold content only, so they rebase cleanly
  after the merge.

Rollout: run it on the owner's test sites first (the
`stagecraft-site-jackson-clawson-*` repos from #314), then on every site
from a platform admin action.

### 5. What happens to #314

#314 closes when the existing sites' upgrade PRs merge. After that, `next`
is a direct dependency in the shell, and it's covered two ways:

- **Patches and minors** come from Dependabot. With no lockfile, any host
  rebuild also resolves the newest 15.x.
- **Security floors** are raised through the package's `next` peer range,
  shipped as a package minor. The upgrade PR itself sets `next` to the
  patched floor (`^15.5.27`) and removes the stale lockfiles that kept
  those test sites on the vulnerable version.

Don't write a separate `next`-bump script for #314. The `upgrade_site`
PR does that job and leaves the site on the update path. If a site needs
the fix before `upgrade_site` exists, merge its open Dependabot `next` PR
by hand.

## Rejected alternatives

- **Platform-hosted editor now (#341 option A).** It removes the most code
  from artist sites, but it's a much larger change (editor auth, broker
  and hosting all move), and the owner chose versioning. The package
  boundary in §1 keeps it open for later.
- **Install from a git tag of `jclaw-labs/stagecraft`.** See §2: npm
  can't install a monorepo subdirectory, builds would run `prepare`
  inside every site build, Dependabot gets no semver signal, and every
  artist build would depend on our repo staying public.
- **GitHub Packages registry.** It's free for public packages, but npm
  installs from it need an auth token even for public packages, which
  means a token in every artist host's env.
- **One shell file per route.** Fewer refactors, but every new admin page
  or endpoint would change the shell, and so become a major.
- **Bundling the package (tsup/rollup) into a few files.** Bundlers tend
  to drop or misplace `"use client"` boundaries in App Router code. A
  per-file `tsc` build has no such risk.
- **Eager content migrations on `main`.** They would conflict with every
  `draft/*` branch, see §3.
- **Commit a lockfile in artist repos.** It would make builds
  reproducible, but the platform worker can't generate one (no
  `npm install` in a Worker), and a stale lockfile is what left #314's
  test sites stuck. The exact package pin gives us reproducibility for
  our own code, which is what matters most here.

## Consequences

- **Fixes reach sites.** A package patch or minor lands on every site with
  the auto-merge workflow within about a week (Dependabot runs weekly) and
  without the cooldown. Sites without the workflow get an open PR.
- **Artist repos shrink to content plus about eight shell files.** The
  history of `src/content/` and `public/images/` is untouched.
- **We now run a release process.** That means a changelog, semver
  discipline and a pack-and-build CI check. The shell version check and
  the "what counts as major" list above are what keep auto-merged minors
  safe.
- **Two monorepo dirs instead of one.** `templates/musician-site/` (the
  package) and `templates/musician-site-shell/` (what gets copied).
  `CLAUDE.md`'s repo-structure block and ADR-003's tree update when the
  shell lands.
- **Content readers carry their history.** Every past `schemaVersion`
  keeps an upgrader and golden fixtures until a major drops it.
- **`upgrade_site` writes to artist repos** with the owner's OAuth token.
  It only ever opens a PR, and never pushes to the default branch.
- **The stamp becomes load-bearing.** `.stagecraft-template.json` gains
  `shellVersion` and `packageVersion`, and the platform can read it to
  show which version a site is on.

## Relates to / amends

- **ADR-007 (musician-site template).** Amends the "one-time copy"
  delivery model. The runtime decisions (Next.js, Puck, file content,
  magic-link auth, `sharp` variants in `public/images/`) all stand, and
  now ship from the package. The out-of-band variant migration script
  (§6) becomes the `stagecraft-site regenerate-images` command.
- **ADR-008 (GitHub App).** Unchanged. `upgrade_site` uses the owner's
  OAuth token, so `Pull requests: Read & write` stays deferred.
- **ADR-009 (unified collection model).** `schemaVersion` gains a meaning:
  readers accept a range and upgrade on read.
- **ADR-010 / ADR-011 (draft branches).** Their content-only invariant is
  what lets lazy content upgrades and shell-only upgrade PRs coexist with
  open drafts.
- **ADR-014 (retire the legacy template).** Amends its consequence that
  deployed sites "keep building from their own checked-in copy": after
  migration they build from the package.

## Follow-up issues

In build order. Each item is a draft issue title and body. Issues 2 and 3
can be built in parallel, and 6 can start any time after 2.

### 1. Claim the npm scope and set up trusted publishing for `@stagecraft/musician-site`

Owner action. Nothing else can ship to npm until the name is ours (ADR-016 §2).

- [ ] Create the free npm org `stagecraft`, or record the fallback
      `@jclaw-labs` if it's taken
- [ ] Enable 2FA on the org and add a second maintainer
- [ ] Configure a trusted publisher for `jclaw-labs/stagecraft`, workflow
      `release-musician-site.yml`
- [ ] Note the org, its owners and the publisher setup in `docs/runbook.md`

### 2. Make the musician-site template build as an npm package

Turn `templates/musician-site/` into `@stagecraft/musician-site` without
changing behavior (ADR-016 §1).

- [ ] Replace `@/…` aliases with subpath imports (`#lib/…`,
      `#components/…`) declared in `package.json` `imports`
- [ ] Add a `tsc` build to `dist/` (per-file ESM plus `.d.ts`), with
      `globals.css` copied over
- [ ] Set `name`, drop `private`, add `exports`, `files` and `bin`
      (`stagecraft-site`), and start the version at `1.0.0-rc.0`
- [ ] Move `next`, `react` and `react-dom` to `peerDependencies`
      (`next >=15.5.27 <16`) and pin the other runtime deps exact
- [ ] Test that every source file with `"use client"` keeps it in `dist/`
- [ ] Existing unit and e2e suites stay green

### 3. Route admin pages and API routes through package routers

Collapse the 18 admin pages and 19 API routes behind two routers so the
artist-repo shell never changes when we add a page or endpoint (ADR-016 §1).

- [ ] Admin router: maps path segments to the existing page modules,
      plus `generateMetadata`, and calls `notFound()` for unknown paths
- [ ] API router: dispatches on path and method to the existing handlers,
      returning 404 for unknown paths and 405 for unknown methods
- [ ] Middleware matches all of `/admin/:path*` and `/api/:path*`, and the
      public-path list moves into the package (login, auth, contact,
      public reads)
- [ ] `withStagecraft()` wraps `next.config` (headers, `globalNotFound`)
- [ ] Keep the editor-CSS boundary test (#348) passing
- [ ] Tests: each router's success, 404 and 405 paths, and the
      middleware's public versus gated paths

### 4. Add the artist-repo shell and scaffold new sites from it

Create `templates/musician-site-shell/` and point provisioning at it
(ADR-016 §1, §3).

- [ ] Shell files: `next.config.ts`, `src/middleware.ts`, the root
      layout, the global 404, the public catch-all, the admin catch-all,
      the API catch-all, `tsconfig.json`, `.gitignore`, `.env.example`
- [ ] Move the starter `src/content/` into the shell and depend on the
      package through `file:../musician-site`
- [ ] The bundle generator reads the shell and rewrites the `file:` dep to
      the exact published version
- [ ] The stamp records `shellVersion` and `packageVersion`.
      `withStagecraft()` fails the build when the shell is too old
- [ ] `dependabot.yml`: exclude the package from the cooldown, and ignore
      `semver-major` for the package, `next`, `react` and `react-dom`
- [ ] Run e2e and screenshot capture against the shell
- [ ] Update `CLAUDE.md`'s repo structure, ADR-003's tree and
      `templates/musician-site/CLAUDE.md`
- [ ] Tests for `site-scaffold.ts` and the bundle generator changes

### 5. Release workflow for `@stagecraft/musician-site`

Publish on a version bump, gated on a build that matches the hosts
(ADR-016 §2).

- [ ] `release-musician-site.yml`: on `main`, when the version isn't on
      npm yet, publish with provenance and tag `musician-site@x.y.z`
- [ ] Pre-publish check: `npm pack`, install the tarball into a clean copy
      of the shell with no lockfile, then run `next build`
- [ ] PR check: a change under `templates/musician-site/src` needs a
      `CHANGELOG.md` entry marked patch, minor or major
- [ ] Release candidates publish to the `next` dist-tag
- [ ] Document the semver rules from ADR-016 §3 in the package README

### 6. Versioned content reads and `stagecraft-site migrate-content`

Let the reader accept every supported `schemaVersion` and upgrade on read
(ADR-016 §3).

- [ ] Replace `z.literal(CURRENT_COLLECTION_SCHEMA_VERSION)` with a
      supported range plus an upgrader chain
- [ ] Fail closed on versions newer than the reader knows, with an error
      naming the package version needed
- [ ] Saves write at the current version
- [ ] `stagecraft-site migrate-content` rewrites all files eagerly, for
      use in major-upgrade PRs
- [ ] Golden fixtures per past version, plus tests for each upgrader,
      future-version rejection, and write-back

### 7. `upgrade_site` job: open a PR that moves a site onto the package

A reusable job for the one-time migration and for later majors (ADR-016 §4).

- [ ] Add `upgrade_site` to `JobType` in `packages/shared`
- [ ] Use the owner's OAuth token. On a stale token, fail with a sign-in
      prompt
- [ ] Compare non-content paths at `HEAD` against the repo's first commit,
      and on a customized site stop and report the changed files
- [ ] Build the PR on the `stagecraft/upgrade` branch: delete our code,
      write the shell and `package.json`, delete `package-lock.json`,
      rewrite the stamp, `dependabot.yml` and the auto-merge workflow, and
      run the content migration if the target needs one
- [ ] Re-running updates the existing PR instead of opening another
- [ ] Platform: an "Upgrade site" action on the site page, and a bulk run
      for platform admins
- [ ] Tests: clean site, customized site, re-run, stale token, a repo
      missing the workflow, and a repo with a lockfile

### 8. Roll the package out to existing sites and close #314

Run `upgrade_site` across existing sites (ADR-016 §4, §5).

- [ ] Run on the owner's test sites
      (`stagecraft-site-jackson-clawson-*`), and check the deploy
      previews on Netlify and Vercel
- [ ] Run on every remaining site, and list the customized sites for
      manual handling
- [ ] Confirm each merged site resolves `next >=15.5.27`, then close #314
- [ ] Confirm the first package patch release auto-merges on a migrated
      site

### 9. Show each site's package version on the platform

Read the stamp to show "on 1.2.0, latest 1.4.1" and flag sites that
haven't merged an update (ADR-016 Consequences).

- [ ] Read `.stagecraft-template.json` from the site repo and the latest
      version from the npm registry
- [ ] Show both on the site page, and link to an open upgrade or
      Dependabot PR when there is one
- [ ] Tests for the version comparison and for a missing or unreadable
      stamp
