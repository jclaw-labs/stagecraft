---
name: create-pr
description: Use when opening or revising a pull request in the stagecraft monorepo. Enforces the screenshots convention — PRs that change rendered UI (public site or Keystatic admin) must embed screenshots from a public gist, since this repo is private and in-tree / raw.githubusercontent URLs don't render anonymously. Cloud Claude Code sessions commit captures to .pr-screenshots/ and a CI workflow relays them to a gist; local sessions can also run the gist push manually. Trigger phrases include "create a PR", "open a pull request", "update my PR description", or any task where a branch is ready for review.
---

# Create PR

Open or revise a pull request. PRs that change rendered UI — public
site, Keystatic admin, or both — must embed screenshots in the body so
reviewers can see what changed without pulling the branch.

The system prompt's standard "Creating pull requests" workflow handles
the `gh pr create` mechanics; this skill covers the screenshots
convention that wraps around it.

## When screenshots apply

- **UI changes** (site or admin): embed the relevant views.
- **Refactor / backend / types / tooling** with no visible UI delta:
  note it explicitly in the PR body — e.g. _"No screenshots — pure
  refactor, no visible UI change."_
- **Admin-only tweaks** (derived select options, schema-driven UI):
  still capture one admin view to confirm rendering.

## Why a public gist

This repo is private. `raw.githubusercontent.com` URLs 404 for anyone
not authenticated with repo access, so in-tree images don't render in
the PR body for most viewers. `gist.githubusercontent.com` content is
anonymously reachable even when the author's repos are private — that
is exactly what a PR-body image embed needs. Not committing
screenshots also keeps the repo free of per-PR binary bloat.

## Naming

| Prefix   | Meaning                                         | Example              |
| -------- | ----------------------------------------------- | -------------------- |
| `site-`  | Public page rendered at the dev URL             | `site-home.jpg`      |
| `admin-` | Keystatic admin view (`/keystatic/...`)         | `admin-releases.png` |

Second token is the page slug or collection name. For nested admin
views, append the item slug: `admin-releases-item-first-album.png`.

## Format + size

- **PNG** for admin UI (text, crisp edges, transparency).
- **JPEG** (`.jpg`) for site views.
- **< 500 KB** per image. If a raw capture is larger, re-shoot as
  JPEG (`quality: 80`) or post-process with `pngquant` / `jpegoptim`.
- Default viewport **1440×900** (matches the site crawler).

## Workflow

There are two paths. Cloud Claude Code sessions (sandboxed VMs without
`gh` CLI access) use the **automated relay**. Local sessions with a
working `gh` auth can use either, but the relay is shorter.

### Capture

**`templates/musician-site` (Next.js + Puck artist site).** One command
captures the standard set — the public home page plus the authenticated
admin surfaces (Pages, Site Settings, Header & Nav, Appearance,
Collections, and the Puck page editor):

```bash
cd templates/musician-site
npx playwright install chromium   # local only — cloud sessions auto-detect
npm run capture:screenshots       # writes .pr-screenshots/artist-*.{jpg,png}
```

It's a Playwright capture config (`playwright.capture.config.ts`) that
boots its own dev server against a seeded, completed site and signs in
via the dev-login escape hatch — so no manual server/auth setup. Output
lands directly in the repo-root `.pr-screenshots/` (the relay path).
Override the dir with `PR_SCREENSHOTS_DIR=...`.

**`templates/musician-site-legacy` (Astro + Keystatic).** Use its helper
script — it covers site home, each nav page, and the Keystatic admin
views:

```bash
# Terminal 1: dev server
cd templates/musician-site-legacy
npm run dev

# Terminal 2: capture
node scripts/capture-pr-screenshots.mjs http://localhost:4321 \
     <output-dir>
```

`<output-dir>` is `.pr-screenshots/` at the repo root for the relay path,
or `/tmp/pr-<N>-screenshots/` for the manual path. See the script header
for flags (`--only`, `--jpeg-quality`, `--site-format`).

**`apps/web` (platform dashboard).** One command captures the
authenticated platform surfaces (Dashboard, Settings, and a site-detail
page). Sign-in is GitHub-OAuth-only with no dev-login bypass, so the
capture seeds a NextAuth session directly in Postgres and hands
Playwright the matching cookie — which means it needs a running,
migrated database:

```bash
docker compose up -d              # Postgres (see docker-compose.yml)
npm run db:migrate                # apply migrations (first run only)
cd apps/web
npx playwright install chromium   # local only — cloud sessions auto-detect
npm run capture:screenshots       # writes .pr-screenshots/platform-*.png
```

It's a Playwright capture config (`playwright.capture.config.ts`) whose
global setup seeds a user + a Resend integration + an active site + a
session row, then boots its own dev server with a minimal env (real
`DATABASE_URL` + dummy auth secrets — no 1Password needed). The seeded
session works because the platform uses Auth.js's database session
strategy: the cookie value is the raw `Session.sessionToken`, looked up
verbatim. Output lands in the repo-root `.pr-screenshots/`; override
with `PR_SCREENSHOTS_DIR=...`.

### Path A: Automated relay (cloud sessions, default)

1. Capture screenshots into `.pr-screenshots/` at the repo root.
2. **Get the captures onto the PR branch with a commit made via the
   GitHub API** (`mcp__github__push_files`) — this is load-bearing, see
   the trigger gotcha below. `push_files` sends file content as a UTF-8
   string, so it's reliable for text but corrupts binary PNG/JPG. Two
   robust options:
   - **(a, default)** Commit the binary captures with `git` (binary-safe:
     `git add .pr-screenshots && git commit && git push`), then make one
     small **API** commit via `push_files` that also touches
     `.pr-screenshots/` (e.g. a `.pr-screenshots/README.md`). Its only
     job is to fire the workflow, which then relays the images already on
     the branch.
   - **(b)** If your `push_files` build handles base64/binary, push the
     images directly via the API in one step.
3. In the PR body, reference each screenshot by basename-without-ext via
   a placeholder comment:

   ```markdown
   ## Screenshots

   ### Site
   <!-- screenshot:site-home -->

   ### Admin
   <!-- screenshot:admin-releases -->
   ```

   Placeholders are optional. Any uploaded file without a matching
   placeholder gets appended under a `## Screenshots` section
   automatically.
4. The `.github/workflows/pr-screenshots.yml` workflow — triggered by
   the API commit on `pull_request: synchronize` (paths
   `.pr-screenshots/**`) — then:
   - Pushes the images to a per-PR public gist (created on first run,
     reused after via a `<!-- screenshot-gist: ID -->` body marker).
   - Replaces each placeholder with rendered image markdown, or appends
     unmatched files under a `## Screenshots` section.
   - Commits a `[skip ci]` cleanup that removes `.pr-screenshots/` from
     the branch so binary blobs don't pile up.

   The workflow only runs on PRs from this repo (not forks) and needs a
   `GIST_TOKEN` secret — a PAT with the `gist` scope. One-time repo
   admin setup.

> **⚠️ Trigger gotcha (cloud sessions) — read this.** A `git push` from a
> cloud session is authored by a credential whose pushes do **not** spawn
> GitHub Actions runs, so a screenshots-only `git push` **silently never
> fires this workflow**: you'll see zero checks on that commit and an
> unchanged PR body, with `.pr-screenshots/` still on the branch. The
> commit that adds or touches `.pr-screenshots/**` must be made via the
> GitHub API (`mcp__github__push_files`), whose commit *does* trigger
> `synchronize`. (This is also why CI seems to run when the PR is
> *opened* — that `opened` event fires from the API `create_pull_request`
> call — but not on a subsequent `git push`.)

5. **Verify the images render — don't assume.** Once the workflow
   finishes (the branch head advances by the `[skip ci]` cleanup commit),
   re-read the PR body (`mcp__github__pull_request_read`) and confirm it
   now shows `![name](https://gist.githubusercontent.com/<user>/<ID>/raw/<sha>/name.png)`
   for every capture. From the network-restricted cloud sandbox you
   usually **cannot** `curl` the raw asset — egress blocks
   `gist.githubusercontent.com` (`Host not in allowlist`); GitHub renders
   it server-side regardless, so a sandbox 403 is **not** a failure
   signal. Instead confirm the gist actually holds the files by fetching
   the gist *page* (`WebFetch https://gist.github.com/<user>/<ID>`).

### Path B: Manual gist upload (fallback)

For local sessions when you'd rather skip the CI round-trip:

```bash
# Seed the gist (needs at least one file to create it)
echo "stagecraft PR #<N> screenshots" > /tmp/pr-<N>-readme.md
gh gist create --public --desc "stagecraft PR #<N> screenshots" \
  /tmp/pr-<N>-readme.md
# → https://gist.github.com/<user>/<GIST_ID>

# Clone, copy images in, commit
git clone https://gist.github.com/<GIST_ID>.git /tmp/pr-<N>-gist
cp /tmp/pr-<N>-screenshots/*.{png,jpg} /tmp/pr-<N>-gist/
cd /tmp/pr-<N>-gist
git add -A && git commit -m "Add PR #<N> screenshots"

# Push — the gist's default clone URL can't auth from CLI, so embed
# a token in the remote URL:
git remote set-url origin \
  "https://<github-user>:$(gh auth token)@gist.github.com/<GIST_ID>.git"
git push
```

Then embed in the PR body:

```markdown
## Screenshots

### Site
![Home](https://gist.githubusercontent.com/<user>/<GIST_ID>/raw/site-home.jpg)

### Admin
![Releases admin](https://gist.githubusercontent.com/<user>/<GIST_ID>/raw/admin-releases.png)
```

Verify each URL returns HTTP 200 anonymously before submitting:

```bash
curl -sI "https://gist.githubusercontent.com/<user>/<GIST_ID>/raw/site-home.jpg" | head -1
# HTTP/2 200
```

## Keystatic admin auth

The template's dev Keystatic runs in `local` storage mode without
sign-in, so the capture script reaches the admin dashboard headlessly.
If your setup uses `PUBLIC_KEYSTATIC_STORAGE=github`, the admin
requires OAuth — the script will hit the sign-in page instead.
Capture admin frames manually from a signed-in browser in that case
and drop them into `/tmp/pr-<N>-screenshots/` with the standard
naming before uploading.
