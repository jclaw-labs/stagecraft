---
name: capture-pr-screenshots
description: Capture screenshots that actually depict a pull request's changes — from the PR's deploy preview by default — attach them to the PR with gh --attach (or, from a Claude Code cloud session, commit them to a pr-assets branch and link them), and embed them in the PR body. Use when the user asks to add, attach, capture, update, or fix screenshots for a PR or set of PRs. The skill's hard rule is: every screenshot must visibly contain the changed element — not a generic home page. Works across projects; respects per-project screenshot conventions when the repo documents them (e.g. in CLAUDE.md or docs/screenshots/README.md).
---

# Capture PR screenshots

## When to use

User asks to add / attach / capture / update / fix screenshots for a PR, a batch of PRs, or "all my PRs". Also when addressing a review comment that asks for a screenshot.

## The one hard rule

**Every screenshot must visibly contain the element(s) the PR changes or is directly related to.** A generic home-page or admin-dashboard screenshot that could have been captured on any branch is worthless to a reviewer — it's noise pretending to be evidence.

Everything else in this skill supports that rule.

## Pre-flight

### 1. Read the repo's screenshot convention, if any

Look for:

- `CLAUDE.md` (repo root or feature subdir) — search for "screenshot"
- `docs/screenshots/README.md`
- `.github/PULL_REQUEST_TEMPLATE.md` — may specify format / hosting

Follow that convention's naming, size budget, and hosting rules. If none exists, default to the conventions below.

### 2. For each PR, figure out what actually changed

```bash
gh pr view <N> --json headRefName,baseRefName,files,body,title
git fetch origin
git diff origin/<base>...origin/<head> --stat
```

Scan the file list. For each changed file, answer:

- **Does this file produce rendered output?** (`.astro`, `.tsx`, `.vue`, `.css`, template files)
- **Does this file change a CMS/admin surface?** (keystatic schema, Strapi config, Sanity schema)
- **Does this file change only types, tests, docs, or build tooling?** → likely no screenshot needed; see "When to skip" below.

For each rendered surface: identify the **exact URL** where the changed element renders. For admin surfaces: identify the **exact admin route** (e.g. Keystatic singleton path, collection item form) where the new/changed field appears.

> Critical failure mode: defaulting to `/` or `/keystatic` without verifying the element is there. The block you changed may only live on `/music/`, and might be part-way down the page; the field you added may only appear when editing a specific collection item. **Find where the element actually renders.**

### 3. When to skip screenshots entirely

Skip — and note it explicitly in the PR body — for:

- Pure refactors with no visible UI delta.
- Type system / build tooling only.
- Backend-only changes (API handlers, schemas with no admin surface, DB migrations).
- Test-only PRs.

Noted in the PR body: `No screenshots — pure refactor, no visible UI change.` (Or whatever applies.)

## Where to capture from

**The PR's deploy preview, by default.** It is the build a reviewer can click and the artifact CI produced, so a shot taken from it also proves the branch deploys and renders. A localhost shot proves your machine renders it.

Find the preview URL from the PR rather than guessing at a URL pattern:

```bash
gh pr view <N> --json statusCheckRollup \
  --jq '.statusCheckRollup[] | select(.targetUrl != null) | "\(.name)\t\(.targetUrl)"'

gh api "repos/<owner>/<repo>/deployments?ref=<head-branch>" --jq '.[0].id' \
  | xargs -I{} gh api "repos/<owner>/<repo>/deployments/{}/statuses" --jq '.[0].environment_url'
```

Most preview hosts also leave a bot comment or a check named after themselves — Vercel, Netlify, Cloudflare Pages, Render. If the preview is still building, wait for it. A shot of a half-built page is worse than no shot, and a stale preview from an earlier push is worse still: check the deployment points at the head commit you're documenting.

**If the repo has no previews, say so before capturing anything.** Tell the user this repo has no per-PR preview deployment and roughly what adding one would take for its stack, then carry on — don't block on it. Capture from a local **production** build (`npm run build && npm run start`, or the stack's equivalent) rather than the dev server, since dev overlays, unminified fonts and hot-reload artifacts all end up in the frame. Label the block in the PR body so nobody misreads it:

> Captured from a local production build — this repo has no deploy previews.

Substack is the exception and needs no such note: there's no per-PR preview an agent can reach, so local captures on the Mac are the normal path there.

## Capturing

### Site views

1. **Point the browser at the preview.** Falling back to a local build, check out the PR branch — a worktree if the main checkout is dirty — and serve a production build. Either way, if the repo has a capture script (e.g. `scripts/capture-pr-screenshots.mjs`), prefer it over ad-hoc tooling: it'll handle viewport size, wait states, and naming.

2. **Navigate to the specific URL showing the change.** Not `/`. The actual URL.

3. **Verify the changed element is visible in the viewport before capturing.** Scroll it into view if needed. If the element is occluded (e.g. a page-background image hidden behind a fullscreen hero on `/`, or a footer below the fold), pick a different page where it's prominent, or scroll/resize until it's visible.

4. **Before/after is stronger than after-alone** for subtle visual changes (font-size nudge, color shift, spacing tweak). Capture the same URL on the base branch and the head branch; name them `site-<page>-before.jpg` / `site-<page>-after.jpg`. For additive changes (new block that didn't exist before), after-only is fine.

5. **One capture per distinct change surface.** If a PR touches both `/photos/` and `/press/`, capture both.

### Admin views

1. **Navigate to the exact admin route that surfaces the new/changed field.** For Keystatic, that's usually:
   - `/keystatic/singleton/<name>` for config singletons (siteConfig, appearance)
   - `/keystatic/collection/<name>` for collection index
   - `/keystatic/collection/<name>/item/<slug>` for a specific item where the new field lives

2. **If admin auth is required and the capture script can't reach it headlessly**, DO NOT substitute a public-site screenshot. Tell the user the admin view needs manual capture from a signed-in browser. Give them the exact URL(s) to visit and the filename(s) to save. Proceed with the other screenshots and note the gap in the PR body.

3. **Scroll so the new field is in the viewport.** Don't capture the top of a long form when the new field is at the bottom.

### Recordings

Record only what a still can't carry — a transition, a hover state, a drag, a flow that takes several steps. It's an addition to the screenshots, never a replacement, because a reviewer skimming on a phone sees the stills and not the video.

Keep it under about ten seconds, no narration, and start it on the screen the change is on rather than on a navigation. MP4 over GIF: GIF of a UI flow runs to tens of megabytes and looks worse.

GitHub plays video only from the `user-attachments` URLs that `gh --attach` mints, so attach the file the same way as a still — see [Attaching](#attaching).

### Quality check before attaching

Open each file in a preview app (or `open <file>` on macOS). If you can't find the changed element in the screenshot within 3 seconds, the screenshot isn't useful — re-capture.

Common miss: the element is technically rendered but too small to see, or hidden by another layer, or the capture ran before the page finished loading. Fix these before attaching.

## Attaching

Use `gh --attach`. It uploads the file to GitHub's own attachment store and writes the markdown into the body or comment it posts, so there is no third-party host, no credential to manage and no URL to verify.

```bash
gh pr edit <N> --attach 'shots/site-music-before.png#Music page before tour-dates grouping' \
               --attach 'shots/site-music-after.png#Music page with upcoming/past auto-grouping'
```

Repeatable, and available on `gh issue create|edit|comment` and `gh pr create|edit|comment`. Alt text follows the path after `#`, and is what a reviewer sees when the image fails to load — write it. Needs `gh` 2.99.0 or newer and push access. Size limits match the web uploader: 10 MB for images and GIFs, 10 MB for video on Free plans and 100 MB on paid.

**This is also the answer for video**, which nothing else solves: an attached video plays inline, while a video hosted anywhere else renders as a link nobody clicks. Attach it the same way — no alt text — and skip the old drag-drop handoff.

**Size budget**: aim for under 500 KB per image. JPEG for photographs and site views, PNG for admin UI and anything with text.

### An attachment outlives the thing that posted it

Measured, because a record in one of my repos had it marked untested for three review rounds: an asset stays served after the comment that minted it is deleted. Four assets were cited from a PR body, the comment that uploaded them was deleted, and the body's images still rendered with no comment left on the PR.

Two things follow. **A body can cite a URL that CI minted**, with no second upload — copy the markdown out of the comment. And **each posting mints fresh assets**: two runs over one unchanged commit produced two sets of URLs, so a body citing run *N* keeps rendering run *N*'s pictures after the code moves on. That looks right and is stale, which is worse than a broken image because nothing signals it — so name the run or the commit beside them.

### From a Claude Code cloud session

`--attach` posts to `https://uploads.github.com/user-attachments/assets`, and Anthropic-hosted cloud sessions cannot reach it. Their GitHub proxy scopes API access to the repositories attached to the session, and that endpoint is not repository-scoped:

```
This GitHub API path is not available: sessions are bound to their configured
repositories. Use repository-scoped endpoints (repos/{owner}/{repo}/...).
```

The host itself is reachable — a bare request gets GitHub's own 400 — so this is the proxy's scoping rule rather than the environment's network access level. Changing that level does not help, nor does supplying your own `GH_TOKEN`, nor installing `gh`, nor a newer one: a raw binary `POST` to the upload endpoint comes back `415` with "Request bodies must declare Content-Type: application/json", and `gh pr comment --attach` stops a step earlier, at a GraphQL lookup the proxy refuses. Reading an attachment back fails the same way: `user-attachments` answers a sandbox with a 403. Gists fail the same way.

**What does go through is `git push`**, so from a cloud session the pictures go into the PR's own repository instead — on an orphan branch named `pr-assets` that holds nothing but screenshots, never on the PR's branch. That branch is standing permission: any session may push to it without asking, whatever branch it was told to develop on. It is still GitHub, so it is not the third-party host this skill rules out.

```bash
WT="$(mktemp -d)/pr-assets"
if git ls-remote --exit-code origin pr-assets >/dev/null; then
  git fetch origin pr-assets && git worktree add --detach "$WT" origin/pr-assets
else
  git worktree add --orphan -b pr-assets "$WT"   # first time in this repo
fi
mkdir -p "$WT/pr-<N>" && cp <files> "$WT/pr-<N>/"
git -C "$WT" add "pr-<N>" && git -C "$WT" commit -m "Screenshots for PR #<N>, <what they show>"
git -C "$WT" push origin HEAD:pr-assets
git -C "$WT" rev-parse HEAD                      # the SHA the links name
git worktree remove "$WT"
```

One commit per posting, under `pr-<N>/`. A push rejected because another session got there first is fetched, rebased onto the new tip and pushed again — so **write the links only after the push lands**, because the SHA is final only then. Link each file by commit, not by branch:

```markdown
![<alt text>](https://github.com/<owner>/<repo>/blob/<sha>/pr-<N>/<file>.png?raw=true)
```

Measured in a private repository: a link naming a commit went on rendering after its branch was deleted, while one naming the branch moves when the next session pushes. What stops the commit being garbage-collected is being in `pr-assets`' history, so **that branch is never rewritten, force-pushed or deleted**. The images render for whoever can read the repository, so a private repo's stay private.

Two things to check rather than assume. A push to `pr-assets` starts any workflow listening for `push` without a branch filter, so read the repo's workflows before the first push there, and tell me if one would fire rather than spending its minutes. And a recording committed this way renders as a link rather than playing inline — GitHub plays video only from `user-attachments` — so it is the one thing still worth handing to me: name the file and say it isn't attached.

### Wiring it into CI

Where a project wants this unattended, the attach belongs in a GitHub Actions job — it runs inside GitHub and is not behind the proxy. One thing to know before you build it, and one design to copy.

**The token CI is handed will not do it.** `secrets.GITHUB_TOKEN` is an app installation token, and `uploads.github.com` answers it `unsupported authentication type`. It needs a user token in a secret of its own — a classic PAT with `repo`; a fine-grained one is unlikely to work, since the endpoint is not repository-scoped and fine-grained permissions are.

**A user token changes who posts.** Comments come from that user rather than `github-actions[bot]`, so a workflow that replaces its own previous comment must match on a marker in the body and never on the author. Matching the author is the version that looks fine until the secret is added and then leaves a comment per push.

**Three states, not two, and they want different answers.** Never configured should stay quiet — a fork cannot have the secret and a repo may not want the feature, so failing there makes a choice look like a defect. An expired token is already loud if the workflow gates on the secret being non-empty rather than valid: it attempts the attach, gets a 401, and the step fails. The gap is **configured, then removed**, which is indistinguishable from never configured. Close it with an opt-in repository *variable* — a variable, because a secret's absence is not legible in an expression — and go red when the variable says images are expected and the secret is empty.

**Warn before it expires rather than after.** GitHub returns the token's own expiry on any authenticated request:

```bash
curl -sI -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user \
  | grep -i github-authentication-token-expiration
# Github-Authentication-Token-Expiration: 2026-09-09 13:44:15 UTC
```

A `::warning::` inside a fortnight of that date turns a build that breaks on the day into notice with the repo and the secret named. GitHub emails the owner before a classic PAT expires, which is free and already happens — but it does not say which repo depended on it.

## Updating the PR body

Replace any existing `## Screenshots` section. Group by surface. Use clear alt text — the reviewer sees it if the image fails to load. `gh` writes the markdown when it uploads, so shaping the section means moving URLs it produced rather than typing them.

```markdown
## Screenshots

### Site

**Before** (`main`):
![Music page before tour-dates grouping](https://github.com/user-attachments/assets/<uuid>)

**After** (this PR):
![Music page with upcoming/past auto-grouping](https://github.com/user-attachments/assets/<uuid>)

### Admin

![Keystatic tour-date editor with new Category field](https://github.com/user-attachments/assets/<uuid>)
```

For additive/no-change-to-existing PRs, drop the before/after sub-headings.

Fetch the body immediately before the write and replace the `## Screenshots` section in that exact text — `--body` overwrites the whole thing, and the user edits bodies in the browser while you work. Follow [`pr-body-rules`](../pr-body-rules/SKILL.md), which has the full rule and the recovery query.

```bash
CREATE_PR_SKILL=1 gh pr edit <N> --body "$(cat <<'EOF'
<new body, preserving the rest>
EOF
)"
```

The `CREATE_PR_SKILL=1` prefix is required — a guard denies bare `gh pr edit`.

Preserve the rest of the body verbatim — summary, test plan, stacking notes, checklists. Only replace the `## Screenshots` section.

## Hard rules

- **Never attach a screenshot that doesn't visibly contain the change.** Pick a different page, scroll, or skip the section entirely — but don't ship noise.
- **Never re-use screenshots across unrelated PRs.** Each PR gets its own captures.
- **Never substitute a public-site screenshot for an admin screenshot you couldn't capture headlessly.** Tell the user the admin frame needs manual capture.
- **Open the PR and check the images render before you call it done.** `gh` writes the URLs itself, so there is nothing to hand-verify — but a body citing an earlier posting points at that posting's pictures.
- **Never commit screenshots to the repo unless the repo's convention explicitly allows it**, with one exception: the `pr-assets` branch a cloud session uses because it cannot attach. Never the PR's own branch; attachments are the default.
- **Never fabricate a screenshot** (e.g. manually editing a non-representative image, reusing a mock). If you can't produce a real screenshot of the actual change, skip and document why.

## Batch mode (multiple PRs)

When the user asks for "all my PRs" or a list:

1. Build the list of PR numbers up front. Confirm it with the user if the scope is ambiguous.
2. Process each PR end-to-end (scan → capture → attach → update body) before moving to the next. One PR at a time is cleaner than batching by stage and then flailing on edge cases at the end.
3. Report per-PR: the URL updated, any skips (with reason), any manual captures the user needs to do.
4. If multiple PRs touch the same surface (e.g. four PRs all change the musician-site home page), each still gets its own captures. The captures will differ branch-to-branch because each PR's changes layer onto the same page.

## Notes

- If the repo has `scripts/capture-pr-screenshots.mjs` or similar, read it before writing any ad-hoc capture code — it encodes project-specific knowledge (viewport, wait states, naming, handling of auth-gated routes).
- For projects using Claude Preview / Claude-in-Chrome MCP tools, use those instead of launching a headless browser by hand. They handle the dev-server lifecycle and can interact with auth flows.
- Don't leave temp files around. Clean up `/tmp/pr-<N>-*` once each PR's attachments are posted.

## Afterwards

Once the task's result is fully delivered, invoke the `refine-skill` skill to retrospect on this execution. It runs in the background, so it costs the task nothing.
