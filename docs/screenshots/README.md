# PR screenshots

PRs that change rendered UI — public site, admin, or both — must embed
screenshots in the body so reviewers can see what changed without
pulling the branch.

This is stagecraft's screenshot convention. The vendored `create-pr` and
`capture-pr-screenshots` skills (synced from local-config into
`.claude/skills/`) handle the PR mechanics; this file holds the
repo-specific parts they defer to: where captures go, how they reach the
`pr-assets` branch, and how to verify they render.

## When screenshots apply

- **UI changes** (site or admin): embed the relevant views.
- **Refactor / backend / types / tooling** with no visible UI delta:
  note it explicitly in the PR body — e.g. _"No screenshots — pure
  refactor, no visible UI change."_
- **Admin-only tweaks** (derived select options, schema-driven UI):
  still capture one admin view to confirm rendering.

## Why the `pr-assets` branch

Screenshots live on `pr-assets`, an orphan branch that holds nothing but
`pr-<N>/` folders of captures, never on a PR's own branch. Cloud
sessions can `git push` but can't reach gists or GitHub's attachment
upload, so this is the one host every session can write to. The repo is
public, so a commit-pinned `blob/<sha>/...?raw=true` link renders for
everyone, and keeping captures off PR branches keeps per-PR binaries out
of `main`.

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

Capture, then commit the captures to `pr-assets` (below). The gist paths
A and B further down are legacy: the relay's `GIST_TOKEN` no longer
authenticates, so use them only if that is fixed.

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
lands directly in the repo-root `.pr-screenshots/`.
Override the dir with `PR_SCREENSHOTS_DIR=...`.

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

**`apps/web` public pages — no database needed.** The public marketing
routes (`/`, `/examples`, `/migrate`, `/privacy`, `/terms`) query no DB
and call no `auth()`, so they skip the Postgres harness above entirely.
Capture them in any cloud session, docker daemon or not:

```bash
cd apps/web
npm run capture:screenshots:public   # writes .pr-screenshots/site-*.jpg
```

It builds the app and serves it with `next start` under dummy env
(`playwright.public-capture.config.ts`), using the pre-installed Chromium
at `/opt/pw-browsers`. A missing database is never a reason to skip
screenshots of public UI.

### Commit to `pr-assets` (default)

Follow the vendored `capture-pr-screenshots` skill's cloud-session
section (it also covers creating `pr-assets` if the branch is ever
missing):

```bash
WT="$(mktemp -d)/pr-assets"
git fetch origin pr-assets && git worktree add --detach "$WT" origin/pr-assets
mkdir -p "$WT/pr-<N>" && cp .pr-screenshots/* "$WT/pr-<N>/"
git -C "$WT" add "pr-<N>" && git -C "$WT" commit -m "Screenshots for PR #<N>, <what they show>"
git -C "$WT" push origin HEAD:pr-assets \
  && SHA=$(git -C "$WT" rev-parse HEAD) && git worktree remove "$WT" \
  && rm -rf .pr-screenshots
```

If the push is rejected (another session pushed first), nothing after it
runs: `git -C "$WT" pull --rebase origin pr-assets`, then re-run the
whole chained command so `SHA` names the rebased commit.
Clear `.pr-screenshots/` only once the push lands. It isn't gitignored, and a
commit that adds it to a PR branch puts binaries there and triggers the
legacy gist relay below, which can't authenticate (#434).

Embed each image by that commit SHA, not the branch name, so later
pushes don't move it:

```markdown
## Screenshots

![Releases admin](https://github.com/<owner>/<repo>/blob/<SHA>/pr-<N>/admin-releases.png?raw=true)
```

Never rewrite, force-push or delete `pr-assets`; being in its history is
what keeps the linked commits alive. Verify every image before calling
the PR done. Read the URLs back from the saved PR body, not from what
you meant to write, and check each through the contents API:

```bash
gh api "repos/<owner>/<repo>/pulls/<N>" --jq .body \
  | grep -o 'blob/[0-9a-f]*/pr-[^?"]*' | sort -u \
  | while read -r p; do
      sha=${p#blob/}; sha=${sha%%/*}; path=${p#blob/*/}
      gh api "repos/<owner>/<repo>/contents/$path?ref=$sha" -i | head -1
    done
# one 200 status line per image (HTTP/1.1 or HTTP/2.0)
gh api "repos/<owner>/<repo>/pulls/<N>" --jq .body | grep -o 'blob/pr-assets/[^?"]*'
# no output: no image uses the branch-name `blob/pr-assets/` form
# (§5 allows only `blob/<sha>/` URLs, so also check the rendered PR)
```

PR-body writes from cloud sessions have been seen to wrap image URLs
whose filename contains `-sidebar` in backticks, which breaks the image
(PR #433). The `grep` above won't catch that, so look at the rendered
PR too, and avoid `-sidebar` in capture filenames.

### Path A: Automated gist relay (legacy)

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

### Path B: Manual gist upload (legacy)

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
