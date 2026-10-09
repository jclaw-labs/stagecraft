---
name: tidy-commits
description: Reorganize the commit history on an open draft PR — squashing fixup noise, splitting mixed commits, and reordering for readability — before opening it for outside review. Use when the user has finished their own review pass on a PR and wants a clean reviewer-facing history, or asks to tidy / clean up / squash / polish PR commits.
---

# Tidy Commits

Rewrite a PR's commit history so reviewers see a clean, story-shaped sequence — not the back-and-forth of agent collaboration. Runs *after* the user's own review pass; does not look at correctness, only at history hygiene. The diff vs. base must be byte-identical before and after.

**First thought: one commit.** Before reading further, before walking any heuristics, before opening `git log` — the default plan for any branch entering this skill is "squash everything into a single commit, applied as a patch on top of the PR's current base". That's the cheapest plan to execute, the cheapest plan for a reviewer to read, and the cheapest plan to verify byte-equivalent. Only depart from it when something on the branch genuinely earns a split (a separable concern that could have shipped as its own PR, or another human's commits — see Step 3). Most agent-driven PRs do not earn a split; the iteration was the journey, and the journey belongs in the chat, not in git history.

**The base is the PR's merge-base, not the moving `master` tip.** Everything here rebuilds on `git merge-base origin/<base> HEAD` — the exact commit the PR is already diffed against. You never need to merge or rebase `master` in just to tidy: the PR's base and diff stay byte-identical to what reviewers see right now, and the captured patch can't conflict because it's applied onto the same base it came from. Updating the branch to the latest `master` is a *separate* operation; don't fold it into a tidy unless the user asks.

## Arguments

`/tidy-commits` — tidy the current branch's commits (vs. the base branch).

`/tidy-commits 136` — tidy PR #136 (will check out its branch).

## Hard rules

- **Plan first, execute on approval.** Always show the proposed grouping and proposed messages, get an explicit "go", then rewrite. Never silently rewrite history.
- **Bail if the PR isn't safe to rewrite.** Stop and surface the reason if any of these hold:
  - The PR is **not a draft** AND has reviews, approvals, or inline review comments from a human (non-bot) account other than the author. Drafts are always fair game — agent collaborators see drafts as work-in-progress and expect history to move. Bot comments (`author.is_bot`, or a login ending in `[bot]`) never count.
  - The branch is the repo's default branch.
  - The working tree has uncommitted changes (staged or unstaged). Step 6.2 does `git reset --hard origin/<base>`, which would drop them. Ask the user to commit or stash first; don't auto-stash.
- **The diff vs. base must not change.** Because the rewrite rebuilds on the branch's existing merge-base, the new tip must have an *identical tree* to the old one — verify it (Step 6.4). Any drift = bug; restore from the backup ref and stop.
- **Save a backup ref before rewriting.** Create a branch at the pre-rewrite SHA under `refs/heads/backup/<branch>-tidy-<ts>` so the user can recover with one command.
- **Force-push only with `--force-with-lease`.** Never plain `--force`. If the lease fails, stop — don't escalate.
- **Bots are not a separate author.** A commit authored by a bot or coding agent — login/name ending in `[bot]`, or a known agent identity like `Cursor Agent` / `cursoragent@cursor.com` — belongs to the PR author for every purpose in this skill: it does not count toward "multiple authors", it does not trigger a split, and it is squashed under the PR author's identity. A branch of your commits interleaved with agent commits is **single-author** — squash freely; don't deliberate. "Another author" below always means another *human*.
- **Preserve human authorship.** Don't rewrite another human's authored commits, and don't blend commits from multiple humans into a single squash. Operationally: `git cherry-pick <sha>` (no `--no-commit`) preserves both author and message; `git commit --author=...` keeps the original author when squashing or rewording. If you'd otherwise squash across humans, keep them separate (or stop and ask).
- **Commit messages follow the user's rule** (`~/.agents/AGENTS.md`): one to two lines. Subject is the headline; an optional second line carries the one piece of context that wouldn't fit. No bulleted bodies, no diff narration. Anything more goes in the PR body.
- **Don't review correctness.** This skill operates on history, not code. The user has already reviewed.

## Step 1: Pre-flight

1. **Resolve the target.**
   - With a PR number: `gh pr view <N> --json headRefName,baseRefName,isDraft,author,reviewDecision,reviews,comments`. Check out the head branch (use a worktree if the active checkout is dirty).
   - Without: use the current branch. Detect the base via `gh pr view --json baseRefName` if a PR is associated, else `git symbolic-ref refs/remotes/origin/HEAD`.

   **Operate in the worktree via explicit paths; never relocate the agent root.** When the head branch needs a worktree (or already has one), run every command with `git -C <worktree>` or `cd <worktree>`. Do **not** call `move_agent_to_root` / switch the IDE workspace root, even if a global worktree rule normally asks for it before code changes — that rule exists to keep edits out of the root checkout, and tidy never edits files (the diff vs. base is byte-identical by design). The move adds nothing here and is a blocking, permission-gated MCP op that can hang for minutes while the chat still renders as in-progress.

2. **Fetch the head branch and verify it's up to date with remote.** Stale tracking refs are the silent failure mode of this skill — `git status` will cheerfully report "up to date with origin/<branch>" when the local `origin/<branch>` ref hasn't been refreshed in hours and the user has been pushing from another clone or worktree. The `--force-with-lease` check at the end of the rewrite would catch this, but only after you've already proposed a plan against an incomplete commit list and done the work to rebuild. Fetch first.

   ```bash
   head_branch=<head branch from PR or current branch>
   git fetch origin "$head_branch"
   local_sha=$(git rev-parse HEAD)
   remote_sha=$(git rev-parse "origin/$head_branch")
   if [ "$local_sha" != "$remote_sha" ]; then
     # Bail. Either the remote has commits we don't have (user pushed
     # from elsewhere), or local has unpushed commits. Either way, the
     # plan we'd build would be based on the wrong set of commits.
     # Surface ahead/behind status and ask the user to reconcile.
     git rev-list --left-right --count "origin/$head_branch"...HEAD
     exit
   fi
   ```

   This is part of pre-flight, not Step 2, on purpose: the plan must be built against the actual remote state, not a stale local one.

3. **Capture the merge-base. Currency with base is NOT required.** This is the rebuild target — the commit the PR is already diffed against — and the whole reason you don't have to update the branch from `master` to tidy it.

   ```bash
   git fetch origin "$base"
   mergebase=$(git merge-base "origin/$base" HEAD)   # rebuild target
   ```

   A branch that's behind `master` is fine: rebuilding on `$mergebase` reproduces the PR's existing base and diff exactly, so reviewers see identical content with fewer commits, and the captured patch can't fail to apply (it's the exact diff from that base). Do **not** bail, and do **not** merge/rebase `master` in first — that changes the PR and is a separate operation. The only thing that legitimately needs a base update before tidying is an *actual* request to incorporate `master`; if the user wants that, have them update the branch (`Update branch` on the PR, or `git merge origin/$base` for a master-based PR; `git rebase --onto origin/$base <old-base-sha>` for a stacked PR) and re-run.

4. **Check for downstream stacked PRs.** If any open PRs have this branch as their base, rewriting will invalidate their bases and re-render their diffs for reviewers. Surface them and confirm explicitly before proceeding.

   ```bash
   # gh pr list --base is the reliable form; `gh search prs --search "base:..."`
   # rejects --search on some gh versions.
   downstream=$(gh pr list --base "$head_branch" --state open \
     --json url,headRefName,title)
   n=$(echo "$downstream" | jq 'length')
   if [ "$n" -gt 0 ]; then
     echo "WARNING: $n open PR(s) stack on this branch:"
     echo "$downstream" | jq -r '.[] | "  \(.url)  \(.title)  (head: \(.headRefName))"'
     echo
     echo "After the force-push, each downstream branch needs:"
     echo "  git fetch origin && git rebase --onto origin/$head_branch <orig_sha>"
     echo "(<orig_sha> = the pre-rewrite tip, captured in Step 6.1)"
     echo
     echo "Tidy bottom-up if you plan to tidy multiple PRs in the stack."
     # Soft bail: require explicit user confirmation before continuing.
   fi
   ```

   Not a hard bail — sometimes tidying the bottom of a stack is intentional — but it must be a loud confirmation, not a silent rewrite. The final report (Step 6.6) re-emits the rebase command for each downstream PR using `$orig_sha`.

5. **Verify safety.** Confirm:
   - Working tree clean (no staged or unstaged changes).
   - Branch is not the repo's default.
   - If a PR is associated, its author login matches yours (`gh api user --jq .login`). This skill is for tidying your own PRs; rewriting someone else's draft is out of scope even if it's technically "fair game" by the draft rule.
   - If the PR is not a draft, no reviews/approvals/inline comments from a human account other than the author. Filter bots via `author.is_bot` on each review/comment, plus `[bot]` login-suffix as a fallback for older API responses.

   If anything fails, stop with a clear message — don't try to work around it.

   Merge commits in the branch's history are fine. Step 2 lists source commits with `--no-merges`, so the rebuild flattens them; surface what's being flattened in the plan so the user knows what happens to:
   - Mid-stream `main` merges (their commits are already in `origin/<base>` and won't be replayed).
   - Merges of other in-flight branches (those commits get replayed as regular commits in the new linear history, with new SHAs — note this if the other branch has its own open PR, since the flattened-in commits will diverge from that branch's SHAs).

6. **Confirm the host clone.** Same convention as `create-pr`: if `basename(toplevel) == origin repo name` this might be the user's primary checkout. Ask once before rewriting; skip if a host-clone choice was already made earlier in the session.

## Step 2: Gather context

```bash
base=<base from PR or detected default>
git fetch origin "$base"
git log --reverse --no-merges --pretty='format:%H%x09%an%x09%ae%x09%at%x09%s%n%b%n--' origin/"$base"..HEAD
git log --reverse --no-merges --stat origin/"$base"..HEAD
git log --reverse --no-merges -p origin/"$base"..HEAD   # full patches for grouping decisions
git log --merges --oneline origin/"$base"..HEAD          # merge commits that will be flattened
git diff --stat "$mergebase" HEAD                        # the PR's TRUE net footprint
gh pr view <N> --json title,body                          # if a PR exists
```

**For the net footprint, diff against `$mergebase` — never two-dot `git diff origin/$base..HEAD`.** In `git diff`, `A..B` compares the two *tips* directly, so when the branch is behind `master` (common, and explicitly fine here) it renders every commit master gained since the fork as a reversed deletion — you'll see hundreds of unrelated files and conclude the PR is enormous when it touches three. `git diff "$mergebase" HEAD` (equivalently three-dot `git diff origin/$base...HEAD`) is the real diff GitHub shows. The `git log` lines above are unaffected: in *log* context `A..B` correctly means "commits in B not A".

For each non-merge commit record: SHA, author, timestamp, subject, body, files touched, +/- lines, full patch. Read enough to understand what each commit *actually does*, not just its subject — agent-authored subjects often lie.

If the merge-commits query returns anything, list them in the plan under "Flattening" so the user can confirm.

## Step 3: Decide the new shape

**Step 3.0: Can this be one commit?** Ask this first, before anything else. It is the only question that matters for most PRs entering this skill, and a "yes" answer ends the planning phase — go to Step 4 with a one-commit plan and stop reading heuristics.

The plan is one commit *unless* one of these is true:

- **Multiple _human_ authors on the branch.** Hard rule — never squash across humans. List the distinct author emails and discard bot/agent identities before counting:

  ```bash
  git log --no-merges origin/"$base"..HEAD --format='%ae' \
    | grep -viE '\[bot\]|^cursoragent@cursor\.com$' | sort -u
  ```

  `Co-authored-by:` trailers never count either. So a branch whose commits are all yours plus `Cursor Agent` is **single-author** — one commit, no deliberation. Only if more than one *human* remains is a one-commit plan off the table, and then only the other human's commit(s) stay separate (replayed via plain `git cherry-pick` to preserve attribution); bot commits still fold into the PR author.
- **A genuinely separable concern** is interleaved with the main work — something that could plausibly have shipped as its own PR against `master` (a real refactor of pre-existing code, a codemod, a schema migration, a vendored dependency bump, a distinct subsystem). Apply the standalone-PR sanity check honestly: a refactor that only reshapes helpers this PR introduced earlier in its own history doesn't qualify; that's iteration, fold it.

If neither applies, the plan is one commit. Don't construct multi-commit plans out of habit, out of "telling the story", or out of preserving the order in which the agent did the work. A reviewer reads the final diff; the journey to it is noise.

If a split *is* warranted, walk the heuristics below to decide the shape. Otherwise skip to Step 4.

**Prefer the simple plan over the perfect one.** Don't construct elaborate reorder + non-contiguous-squash + manual-split sequences to land a perfectly grouped history. More resulting commits is fine when you've already decided splits are warranted — a reviewer would rather read 8 contiguous commits with sane messages than 4 "ideal" ones produced by aggressive reshuffling. Whenever a candidate move requires reordering past unrelated commits, squashing non-contiguous commits, or splitting via `git add -p`, first ask whether the simpler alternative — leave the commit in place, keep it as its own commit — is good enough. Usually it is. Reach for the fancier moves only when the gain is clear and the execution is risk-free. The same principle applies mid-execution: if a maneuver hits a conflict or needs hand-resolution, drop *that* maneuver from the plan and fall back to the contiguous-only version rather than fighting through it.

### Signals to keep separate (the only list that earns a split)

- **Commits authored by another _human_.** Hard rule — never squash across humans (bots/agents excepted; they fold into the PR author). If a teammate's commit is interleaved with your work, it stays on its own and is replayed via plain `git cherry-pick` (no `--no-commit`) to preserve attribution.
- Pure refactor (no behavior change) followed by a feature that uses it — **but only if the refactor operates on code that pre-existed this PR**. If the "refactor" is moving, renaming, or reshaping helpers that this very PR introduced in an earlier commit, that's not a reviewable refactor, it's the author's iterative process. Squash it. Sanity check: could this refactor commit have shipped as a standalone PR against `master`? If no, fold it.
- Codemod or mechanical change (rename, lint autofix, dependency bump) vs. hand-written logic. Mechanical changes are skim-able; logic needs attention. Don't blend them.
- Genuinely distinct subsystems where each commit is independently reviewable (e.g. server change + client change + migration).
- Schema migration, generated files, or vendored code — usually their own commit so reviewers can collapse them.

### Reorder signals

- A `fix typo in X` commit sitting several commits after the one that introduced X — pull it back as a fixup into the parent.
- A refactor commit landed *after* the feature change that motivated it — reorder so the refactor comes first, when conflict-free.

### Split signals

- One commit doing both a refactor and a feature change (subject often has "and"). Split into refactor first, feature second.
- One commit mixing truly unrelated concerns (e.g. `fix auth bug + bump dep`). Split.

If a reorder or split looks like it would create conflicts, drop it from the plan up front rather than carrying it forward and hoping. Contiguous-squash-only is the safe fallback for any segment with friction; the cost is one or two extra commits in the result, which is always preferable to fighting cherry-pick conflicts or hand-resolving hunks.

## Step 4: Compose new commit messages

For each final commit, draft a message following the user's rule:

- Subject: ≤ ~70 chars, imperative mood, no trailing period, no `feat:` / `fix:` prefix unless the repo's history already uses them.
- Optional second line: one piece of context the subject couldn't carry. No bullet lists, no "this commit" preamble.
- When a group has a clear best subject already in it, reuse it.
- When the group is iterations on the same idea, synthesize a subject that names the *outcome*, not the journey.
- When a single original commit is being kept unchanged, mark it "keep as-is" — don't propose a new message.

Match the repo's existing commit subject style (check `git log --oneline -30 origin/<base>`). If the repo uses Conventional Commits, match it. If not, don't impose it.

## Step 5: Show the plan

Output structure:

```
Tidying <branch> on PR #<N> — <X> commits → <Y> commits

Final 1: keep as-is
  abc123  refactor: extract OrderRow component

Final 2: squash 3 → 1
  def456  add OrderRow tests
  ghi789  fix lint in OrderRow tests
  jkl012  cover edge case in OrderRow tests
  → "test: cover OrderRow rendering and edge cases"

Final 3: split 1 → 2
  mno345  refactor pricing helper and switch OrderRow to use it
  → split A: "refactor: extract sharedPricing helper"
    split B: "OrderRow: use sharedPricing helper"

Final 4: reorder + squash
  pqr678  fix typo in OrderRow copy   (was at HEAD; folding back into Final 1)

Flattening (merge commits dropped from history):
  stu901  Merge branch 'main' into feature/orders   (already in base)
  vwx234  Merge branch 'order-discount-draft'        (commits replayed below as Final 5–6)

Net footprint (vs merge-base): 3 files, +198   # git diff --stat $mergebase HEAD

Risks:
  - Split of mno345 needs manual hunk selection (git add -p flow).
  - No conflicts expected.
  Backup ref: backup/<branch>-tidy-<ts>
```

Omit the "Flattening" section if the branch had no merge commits.

End with: `Proceed? (y / edit / cancel)`. On `edit`, accept inline tweaks (`merge Final 2 and Final 3`, `rename Final 1 to ...`, `keep mno345 as-is, don't split`) and re-print.

If the heuristics produce nothing worth changing (1–3 commits, all distinct and well-named), say so and exit. Don't invent work.

## Step 6: Execute

Rebuild the new history on the merge-base (Step 1.3's `$mergebase`). Single-commit plans use a patch capture + apply (one step, no merge logic, identical tree by construction); multi-commit plans use cherry-pick, which handles squash, split, reorder, and message changes uniformly. The verify step (6.4) catches any execution bug.

1. **Save the backup ref.**

   ```bash
   ts=$(date +%Y%m%d-%H%M%S)
   git update-ref refs/heads/backup/${branch}-tidy-${ts} HEAD
   orig_sha=$(git rev-parse HEAD)
   ```

2. **Reset to the merge-base** (captured in Step 1.3), not the moving `origin/$base` tip. This is what keeps the PR's base and diff byte-identical and lets verification collapse to a tree comparison.

   ```bash
   git reset --hard "$mergebase"
   ```

3. **Build each final commit in order.**

   By the authorship hard rules, every commit in a group is either the PR author's or another *human's* (bot commits fold into the PR author). Capture the group's author once so the rebuilt commit doesn't silently re-attribute to whoever is running this skill — and **read it off a human commit, never a bot commit**, so you get the real git name + email:

   ```bash
   # Author of the most recent NON-bot commit in the group (the common case:
   # your commits ± agent commits → this resolves to you):
   group_author=$(git log --no-merges --format='%an <%ae>' <group source SHAs> \
     | grep -viE '\[bot\]|cursoragent@cursor\.com' | head -1)
   # Fallback only if a group is entirely bot-authored (no human commit to read):
   #   group_author=$(gh pr view <N> --json author --jq '.author.login')  # then map to your git identity
   ```

   **Single-commit plan (the common case): capture and apply the branch's net diff as one commit.** This is the simplest mechanism available — no cherry-pick, no merge, no rebase. Take the patch the branch introduces, apply it on top of base, commit once.

   ```bash
   patch=$(mktemp -t tidy-XXXXXX.patch)
   git diff --binary "$mergebase" "$orig_sha" > "$patch"
   git apply --index "$patch"
   git commit --author="$group_author" -m "<final subject>" [-m "<optional body line>"]
   rm "$patch"
   ```

   Notes:
   - `git diff "$mergebase" "$orig_sha"` is exactly the patch the PR introduces against its base; applying it onto `$mergebase` **cannot conflict** — same base in, same content out.
   - `--binary` preserves binary file changes (default `git diff` emits a placeholder that `git apply` can't replay).
   - `--index` updates both the working tree and the index in one step, preserving file modes and renames.
   - If `git apply` somehow fails on the merge-base, something is wrong (corrupt ref, partial fetch) — stop and surface; don't auto-merge or reach for `--3way`.
   - If the patch is empty, the branch has nothing left to ship — close the PR rather than tidy it.

   Skip the cherry-pick paths below for a single-commit plan.

   For a **"keep as-is"** entry in a multi-commit plan (one source commit, message unchanged), preserve the original commit exactly — both author and message:

   ```bash
   git cherry-pick <source SHA>
   ```

   For a **squash** or **single commit with a new message** in a multi-commit plan, apply each source commit's tree changes without committing, then commit once with the final message and the captured author:

   ```bash
   git cherry-pick --no-commit <source SHA 1> [<source SHA 2> ...]
   git commit --author="$group_author" -m "<final subject>" [-m "<optional body line>"]
   ```

   For a **split**, apply the source commit's changes without committing, split via partial staging, and use the captured author for both halves:

   ```bash
   git cherry-pick --no-commit <source SHA>
   git restore --staged .
   git add -p   # or: git add <specific paths> for whole-file splits
   git commit --author="$group_author" -m "<split A subject>"
   git add -A
   git commit --author="$group_author" -m "<split B subject>"
   ```

   If `cherry-pick` reports a conflict: stop and don't try to auto-resolve. The default response is to fall back to a simpler version of the plan — drop the reorder or non-contiguous squash that caused the conflict, keep those commits in their original order as separate commits, and re-run from Step 6.2. Only escalate to hand-resolution or plan-only if the user asks for it. More resulting commits is fine; a half-hour rebase fight isn't.

4. **Verify the tree is identical.** This is non-negotiable — it's how we know the rewrite preserved meaning — and because we rebuilt on the *same* merge-base the branch already used, it's a one-liner: the new HEAD must have the exact same tree as the old tip, just reached in fewer commits.

   ```bash
   if ! git diff --quiet "$orig_sha" HEAD; then
     git reset --hard "$orig_sha"
     echo "Tree drift detected — original history restored. Aborting."
     exit 1
   fi
   ```

   A non-empty diff means the rebuild changed content (a botched split, a dropped hunk, a cherry-pick conflict resolved wrong) — restore from backup and stop. No blob-hash stripping, no base-movement special cases: same base in, same tree out. (This works precisely *because* of Step 6.2 — had we reset to a moved `origin/$base`, the trees would differ by the base delta and you'd be back to fragile patch-text comparison.)

5. **Force-push with lease.**

   ```bash
   git push --force-with-lease origin HEAD
   ```

   If the lease fails (someone else pushed to the branch), stop and surface — don't escalate to plain `--force`. If instead a `pre-push` hook fails on a sandbox/permission error (e.g. it shells out to `ps` or another blocked binary), re-run the same push outside the sandbox — that's a hook-environment issue, not a lease or history problem.

6. **Report.** Print:
   - PR URL.
   - Final commit count (`git log --oneline origin/"$base"..HEAD | wc -l`).
   - The one-line restore command, in case the user changes their mind:
     `git reset --hard backup/<branch>-tidy-<ts> && git push --force-with-lease`
   - If Step 1.4 found downstream stacked PRs, list each with the exact rebase command it needs. Use `$orig_sha` (saved in 6.1) as the upstream argument so reflog-divers and other consumers of the old tip can still find it:

     ```
     Downstream rebase needed:
       - <PR URL> (head: <branch>)
         cd <downstream worktree>
         git fetch origin && git rebase --onto origin/<this-branch> <orig_sha>
     ```

## Behavior on weak input

- "Just tidy it" with no PR context → default to the current branch.
- An "obvious" plan (only contiguous squashes, no controversial choices) → still show it before executing. Cost of asking is low; cost of an unwanted rewrite is high.
- Ambiguous grouping (a commit could plausibly belong to two groups, or could plausibly be its own commit vs. folded in) → lean toward the easier execution. If folding is contiguous and trivial, fold; if it would require reordering past other commits or a non-contiguous squash, leave it as its own commit. Extra commits in the result are cheap; complex maneuvers aren't. Mark it in the plan as a judgment so the user can redirect during the `edit` round.

## Notes

- This is the inverse of `create-pr`'s "don't push when checks fail" rule — it operates *after* push, on a branch that's already public. The safety net is the backup ref + the byte-equivalent diff check, not pre-flight checks.
- Don't run lint/typecheck/test as part of this skill. The user already verified the code; we're only moving commits around, not changing them.
- A branch that's behind `master` needs no special handling: the rewrite rebuilds on the branch's existing merge-base, so the PR's base and diff are unchanged. Don't merge/rebase `master` in as part of tidying — that's a separate operation the user requests explicitly.
