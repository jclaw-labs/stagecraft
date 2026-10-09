---
name: create-pr
description: Create a draft pull request in the active git repo, drafting a tight, reviewer-facing body that explains intent, impact, and review focus instead of narrating the diff. Uses the repo's PR template if present, or a project-specific local override. Always creates drafts; leaves unknown sections of the template blank rather than fabricating content. Use whenever you finish making changes (new work or review feedback) — commit, push, and open or update a PR without waiting to be asked — and whenever the user asks to open, create, push up, draft, revise, or tighten a PR.
---

# Create PR

## When to use

Whenever you made changes that should ship: commit and push, then create or update the PR. Don't wait to be asked. Also use when the user asks to create / open / push up / draft / revise / tighten a PR. If a PR already exists for the branch, update it rather than opening a second one.

## Bundled stack helper

Derive `<create-pr-skill-dir>` from the path used to read this `SKILL.md`. Use
`pr-stack-section` when it is available on `PATH`; otherwise invoke the bundled sibling as
`bash <create-pr-skill-dir>/pr-stack-section`. Its required library is bundled under
`<create-pr-skill-dir>/lib/`, so a fresh vendored project needs no local-config checkout.

## Confirm the host clone (do this first)

Convention: the user often keeps two checkouts — their own (named the same as the GitHub repo) and a separate "agent" checkout named differently, so the agent's PR work doesn't interfere with the user's open files. Not every project has a separate agent clone, though.

Detect by comparing the local checkout's directory basename to the origin repo name:

```bash
toplevel_name="$(basename "$(git rev-parse --show-toplevel)")"
origin_repo="$(basename -s .git "$(git remote get-url origin)")"
```

- **`toplevel_name != origin_repo`** → this is an agent-named clone (e.g. cloned into `foo-ai` from `github.com/owner/foo`). Proceed silently.
- **`toplevel_name == origin_repo`** → this looks like the user's primary checkout. The user may have started the skill here on purpose (no separate agent clone exists), or by mistake. Ask once before proceeding:

  > Just confirming — this looks like your primary `<origin_repo>` checkout (directory name matches the origin repo). Did you mean to run me here, or did you want me to work in a separate clone? The push and any branch creation will happen wherever we proceed.

  Wait for the answer. **Once given, treat it as standing for the rest of the session** — don't re-ask for further PR or worktree work in this same project. If a worktree was just created via `new-worktree` in the same project, that decision already covered this question; don't re-ask.

## Hard rules

- **Always `--draft`.** No exceptions unless the user explicitly says "not a draft".
- **Leave unknown sections blank.** Don't invent ticket numbers, test plans, screenshots, or reviewer steps. An empty heading is better than a hallucinated one.
- **Ask once for the related ticket** if it isn't already known (see "Ticket intake" below). This is the one allowed clarifying question (besides the host-clone confirmation, if applicable); everything else falls back to "produce the best body from available info".
- **Always start the body with the tracker URL on the first line** when one exists. Omit the line entirely if there genuinely is no ticket.
- **Don't narrate the diff.** Reviewers can read the diff. The body should give them what the diff _can't_.
- **Concise.** High signal-to-noise. Treat every sentence as guilty until proven necessary.
- **Never push with `--no-verify`.** If pre-push fails, fix the underlying issue (most commonly: husky not bootstrapped in a worktree — see the `new-worktree` skill).
- **Never push when local checks fail.** Run lint, typecheck, and tests locally before push (see step 4) and surface failures rather than letting CI catch them. Don't claim "CI will tell us" — that wastes a CI cycle and a review pass.
- **Never fabricate screenshots or image descriptions.** Either upload real images via the "Add screenshots" step (11), or leave the Screenshots heading and any HTML comment from the template intact. Don't invent captions or describe UI you haven't seen.
- **When a PR changes tests, report what they cost in suite time.** Measure it, don't estimate it, and keep it to one figure in the Checklist section (see "Test time" below). No test changes, no line.
- **Keep creation context frozen.** Later sessions don't replace it with their own model or environment. Existing artifacts do not gain context retroactively.

## Voice and style

Follow the [`writing-style`](../writing-style/SKILL.md) skill for tone, phrasing, what-to-cut rules, and the two-pass drafting workflow. The rules below cover what's PR-specific.

## What makes a good PR body

A PR body is a note from author to reviewer. Optimize for a reviewer who skims first, reads closely second — they should be able to answer in seconds:

1. What changed?
2. Why did it change?
3. What should I pay attention to?

**Include** something only if it surfaces at least one of:

- intent / primary goal
- rationale or trade-off
- review focus (where to look hard)
- user-facing or system-level impact
- meaningful risk, rollout concern, or follow-up

**Omit (PR-specific):**

- facts obvious from the diff (renames, moves, type changes, mirrored tests)
- file-by-file or function-by-function summaries
- low-level details that don't affect review priorities

The general style rules in `writing-style` cover the rest (filler, narration, citations, empty intensifiers, abstracting up).

## Evidence for mechanism claims

A mechanism claim says **how** the system behaves, not merely what the diff intends: what a library does with bad input, what a bundle or import graph contains, what reaches telemetry, what a save persists, or why a cache, retry, or guard engages.

Run the path that establishes the claim before putting it in the body. Use the evidence that fits the mechanism — construct the input, inspect the built artifact or dependency graph, observe the emitted payload, or read back the persisted result. Text search locates code; it does not prove runtime reachability, and a directory-scoped search cannot establish an import graph that leaves that directory on its first hop.

If the path cannot be executed, write the statement as explicitly unverified when the uncertainty matters to review; otherwise leave it out. The body does not need a transcript, but it must not turn an inference into established context.

## Default body structure

Unless the user asks for a different shape, the **Summary** section is:

1. **One sentence** of the PR's main purpose. Stands alone.
2. **2–5 short bullets** with the most important supporting points (rationale, non-obvious choices, impact).
3. **Optional final bullet** for review focus, risk, rollout, or follow-up.

The leading tracker line and the template's other sections (Checklist, reviewer testing, screenshots) follow the per-section rules in step 6 below.

## Test time

Every test that lands is time the whole team pays on every build from then on, and nobody sees that cost at review time unless somebody puts a number on it. So when a PR changes tests, measure the cost and put it in the body.

**A PR that doesn't touch tests gets no line at all** — not even "no new tests". When there is something to report, it's one figure: what the change added or removed.

```
Test time: +14s
Test time: -12s
Test time: no measurable change
```

That's the whole readout almost every time. The file names and the case count are already in the diff, so leave them out, and leave out the touched files' total wall time too. A total is the number a reader compares across PRs, and on a shared machine it won't hold still: one unchanged suite measured 27s and then 63s in the same session, and the three slices of one stack once reported totals that implied three different bases.

**Measure it, don't estimate it.** A brand-new file's whole time is its delta. For cases added to an existing file, read their per-case annotations, such as `(78ms)`, from a warm full-file run. Those annotations leave out `beforeEach` and `afterEach` time, so when the added cases run per-case hooks, or share expensive setup with the cases already there, run the file on the base too and diff the two. A run filtered to just those cases by name (`-g` / `--grep` / `-t`) is no shortcut: its total is mostly bootstrap, and a run whose pattern matches nothing skips the root hooks, so subtracting one still counts part of the bootstrap as the cases' cost. Deletions are the same in reverse. Take the second run of each, since the first pays for a cold cache and compilation. Step 4 already has you running these files.

**Below 10 seconds, write "no measurable change".** The floor is a fixed convention, so it holds on a quiet machine too: repeat runs of unchanged suites on a loaded one routinely spread wider than that, so a smaller delta is noise, and printing it to a decimal claims a precision it doesn't have. One warm run on each side, the second as above, settles a delta under 10s, so don't spend repeat runs pinning down a small number. A delta that clears 10s needs three warm runs on each side, and the figure is the difference of their medians. When repeat runs of the unchanged files spread wider than that difference, it is still noise. Write "no measurable change" and give the spread as the evidence, as in `Test time: no measurable change (repeat runs spread 36s)`. That is a measurement, not the shrug "Defend a number only when it needs defending" rules out.

Strip ANSI colour codes before you parse a reporter's output (`sed 's/\x1b\[[0-9;]*m//g'`). Some runners colour piped output (mocha with `-c` does), and a pattern over the raw text matches nothing.

**The line goes at the bottom of the `## Checklist` section**, as a plain line rather than a `- [ ]` item — it's something to read, not something to tick. Leave the template's own checklist items alone.

**Defend a number only when it needs defending.** A few seconds doesn't. Past that, go look at what the tests are doing before you write anything — there's usually something to take: two cases asserting the same path collapse into one, setup that runs per case gets hoisted to run once, a unit test stands in for one that goes to the database. If the time is still worth paying, one clause says what it buys; if you can't say, cut the test rather than shipping the number with a shrug.

```
Test time: +14s — each case seeds a publication to hit a different rejection path
```

## Ticket intake

Before finalizing the body, make sure you know whether there's a related tracker ticket (Linear, Jira, GitHub issue, etc.) — or have confirmed there isn't.

**If no ticket has been provided** — and one isn't obvious from chat history, the branch name (e.g. `jdoe-ABC-123-fix-dropdown` → `ABC-123`), or recent commit messages — ask once:

> Is there a tracker ticket or issue for this change? (Paste a URL or ID, or say "none".)

Wait for the answer, then continue automatically. Don't re-ask, don't expand the question, don't block on anything else.

**If a URL or ID is provided**, fetch context where you can — Linear via the `plugin-linear-linear` MCP server (`get_issue`), GitHub issues via `gh issue view <id>`, etc. Use the ticket as supporting context to sharpen the Summary's explanation of:

- why the change exists
- user-facing or system-level impact
- important constraints or trade-offs
- risks, rollout concerns, or follow-ups
- what the reviewer should scrutinize

**Do not turn the PR body into a ticket summary.** Compress ticket details into the few points that improve reviewer understanding. The link itself carries the rest.

**Always include the link** as the body's first line, above the `## Summary` heading. Use a label that matches the tracker:

```
Linear: https://linear.app/...

## Summary
…
```

```
Issue: https://github.com/owner/repo/issues/123
Closes #123

## Summary
…
```

**Add a `Closes #N` line when merging this PR finishes a GitHub issue in the same repository.** Put it on its own line, with the keyword and the `#` adjacent and no `issue` word between them. `Closes issue #123` doesn't link, and the issue silently stays open after the merge. Use one keyword per issue: `Closes #12, closes #34`. Leave it out when the PR fixes one item of an umbrella issue, because the umbrella closes only once all its items are decided.

If the ticket can't be fetched (connector unavailable, permissions, etc.) but the user supplied a link, use what they gave you and still include the link on the first line.

If the user explicitly says there is no ticket, omit the line entirely.

### Check commit closing directives

Before creating or updating the PR, inspect every commit message in the PR range for GitHub closing directives (`close`, `fix`, or `resolve` and their variants). A directive is correct only when this PR finishes the issue it names, the same test as the `Closes #N` line above. A directive naming a parent, superseded ticket, or deliberately unfinished issue is stale metadata even when the PR body uses a non-closing reference.

Fix a stale directive before the branch is reviewed by rewording the commit. Squashing alone isn't enough wherever the default squash message lists the commit messages — local-config's does — because the directive then lands in the squashed commit and closes the issue anyway, and `merge-stack` squashes with that default message. Once review has started, don't rewrite history mid-review. Instead, either reword the commit as the last step before handoff to merge with `tidy-commits` and tell the reviewer the tree is unchanged (it refuses a non-draft PR that has human reviews, so use the other path there), or put a landing constraint at the top of the body: name the issue that must stay open, and require a hand merge with `gh pr merge <pr> --squash --subject <title> --body-file <file>` whose subject and body both leave the directive out, not `merge-stack`. The subject matters too: a single-commit PR's default squash title is that commit's subject. Keep the PR body itself free of the stale directive. After the merge, check that the issue is still open and reopen it if not.

## End-to-end workflow

### 1. Locate the PR template

Try in this order:

1. **Local override** — a project-specific template at `<local-config>/repo-tools/pr-templates/<repo-name>.md`, where `<local-config>` is the dir holding the user's shared shell/git/agent config. Resolve via `~/.agents` if present (its target's grandparent is the local-config root). `<repo-name>` is the basename of the repo's git toplevel.
2. **Repo template** — `.github/pull_request_template.md` or `.github/PULL_REQUEST_TEMPLATE.md` in the repo.
3. **Default** — a minimal inline template:

   ```
   ## Summary
   ```

If a template is found, use it as the starting body.

### 2. Determine the base branch

- Default: the repo's default branch. Detect via `git symbolic-ref refs/remotes/origin/HEAD` (typically `main` or `master`).
- **Stacked PR check**: if the current branch was branched off another branch with an open PR (not the default), base on that branch instead so the diff only shows the new work. Detect by:

  ```bash
  git log --oneline origin/<default>..HEAD
  ```

  If that shows commits clearly belonging to another in-flight branch, run `gh pr list --head <that-branch>` to confirm an open PR exists. If so, base on that branch and mention the stacking sequence in the Summary.

- **Slicing the stack yourself?** If you're deciding *how* to split work into a stack (not just opening a PR on a branch that already exists), use the `split-to-prs` skill for the general slicing process. Whichever way the stack came to be, every PR in it must be safe to land on its own — read the `stacked-pr-rules` skill for the landing-safety rules and hold each slice to them.

- **Resolve the full stack**: if a stack is detected (this PR sits on another open PR, or other open PRs are stacked on this branch), resolve the entire stack — step 6 needs the parent's URL, and step 10 puts the stack outline on every PR in it. `pr-stack-section <parent-PR-or-branch>` prints the resolved chain; so does `restack-detect <bottom-parent-branch-or-PR>`. Neither can see this PR before it exists, so run it against the parent now and let step 10 pick up the new PR. Failing both, walk base refs manually: `gh pr list --state open --json number,headRefName,baseRefName,url` and follow `baseRefName → headRefName` links up and down from the current branch.

### 3. Prepare agent context

Every agent-created PR gets creation context. Step 3 captures only the
authoritative creation record. In local Cursor, save the complete injected
`Agent provenance` record. In Cursor Cloud, normalize the `run-info` metadata
without adding a target yet. In Claude Code, local or cloud, save the output of
`"$agent_provenance" from-claude-code` run without `--target`; in the cloud,
where the harness forbids model IDs in pushed artifacts, add `--withhold-model`.

Resolve the companion command once from the repository root:

```bash
repo_root="$(git rev-parse --show-toplevel)"
agent_provenance="$(command -v agent-provenance 2>/dev/null || true)"
if [ -z "$agent_provenance" ]; then
  agent_provenance="$repo_root/.claude/skills/agent-provenance/agent-provenance"
fi
[ -x "$agent_provenance" ] || {
  printf '%s\n' 'agent-provenance command is unavailable' >&2
  exit 1
}
```

Only agent-facing work adds a runtime target. Classify that target now and keep
the decision for step 8. Non-agent-facing work keeps the authoritative record
unchanged and does not inherit a cloud/local coverage gate.

Use `either` when cloud and local reach the same changed behavior path, so a
check in one environment covers the change. Use `both` only when correctness
depends on distinct cloud and local behavior and both checks are required.
Uncertainty is not a target; inspect the reachable behavior until the
classification is justified. Keep an `either` PR unready until cloud or local
has been checked, and keep a `both` PR unready until both have.

Set private file permissions and keep the record until step 9 verifies the
body. For an existing PR, do not normalize the later session to reconstruct
creation context. Classify only a changed runtime target, then use the
target-only path in step 9.

### 4. Run local checks

Before pushing, run the project's check scripts so CI doesn't catch what local would have. This implements the global `Local checks` rule from `~/.agents/AGENTS.md` at the latest possible moment.

Pick the package manager from the lockfile: `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, otherwise `npm`. For non-JS repos, use the equivalent (`cargo check / clippy / test`, `go vet / test`, `pytest`, etc.).

Read `package.json` `scripts` and run the ones that exist, in this order:

- `lint` — if it fails, try one auto-fix pass (`<pm> run lint -- --fix` or whatever the script accepts) and re-run.
- `typecheck` — fix any errors before continuing.
- `test` — fix any failures before continuing. If snapshot tests fail, **don't blindly run `--updateSnapshot` to make them green** — diff the snapshots and confirm the change is intentional first. If the test suite is slow and the change is non-test code, it's fine to scope to the affected package or to skip with a one-line note to the user; otherwise run it. If the PR changes tests, take the timing measurement here while you're already running them ("Test time" above).

If a script doesn't exist, skip it silently. If `package.json` has none of these, mention once that no local check scripts were discovered and continue.

If anything still fails after the auto-fix pass, surface the failures and stop. Don't push, don't `--no-verify`. The user decides whether to fix or override.

### 5. Push the branch (if not already pushed)

Push to the branch the PR is actually on, which is not always the local name. A review worktree's local `claude/issue-392-stack` can track `origin/claude/issue-392`, and a plain `git push -u origin HEAD` there would publish a new `claude/issue-392-stack` and repoint the upstream at it, leaving the PR unchanged. So read the configured upstream first, and pass in the base from step 2: a stacked child cut from `origin/<parent>` tracks its parent's branch, and only the base tells that apart from a local name for this PR's own branch. Once the parent's PR has merged, step 2's base is no longer the parent, so the recipe also asks GitHub whether the upstream still heads an open PR.

```bash
push_pr_branch() {
  local base="${1:-}" branch remote merge default open
  case "$base" in ""|"<"*) echo "push: pass the base branch from step 2" >&2; return 1 ;; esac
  branch="$(git symbolic-ref --quiet --short HEAD)" || { echo "push: HEAD is detached; check out the PR branch first" >&2; return 1; }
  remote="$(git config "branch.$branch.remote")"
  merge="$(git config "branch.$branch.merge")"; merge="${merge#refs/heads/}"
  default="$(git symbolic-ref --quiet --short "refs/remotes/${remote:-origin}/HEAD" 2>/dev/null)"; default="${default#*/}"
  # A local upstream, or one that is the base (a branch cut from origin/main or from a parent PR's branch), names no PR branch.
  [ "$remote" = . ] && merge=""
  [ -n "$base" ] && [ "$merge" = "$base" ] && merge=""
  case "$merge" in "${default:-main}"|main|master) merge="" ;; esac
  if [ -n "$remote" ] && [ "$merge" = "$branch" ]; then
    git push -u "$remote" HEAD
  elif [ -z "$remote" ] || [ -z "$merge" ]; then
    git push -u origin HEAD
  else
    open="$(gh api -X GET "repos/{owner}/{repo}/pulls" -F head="{owner}:$merge" -f state=open --jq length)"
    case "$open" in
      0) git push -u origin HEAD; return ;;
      [1-9]*) ;;
      *) echo "push: could not ask GitHub whether $merge has an open PR; nothing was pushed" >&2
         return 1 ;;
    esac
    git ls-remote --exit-code --heads "$remote" "refs/heads/$merge" >/dev/null
    case $? in
      0) git push "$remote" "HEAD:refs/heads/$merge" ;;
      2) echo "push: $branch tracks $remote/$merge, which is gone from $remote though its PR is open; check the PR's head branch before pushing anywhere" >&2
         return 1 ;;
      *) echo "push: could not read $remote to check $remote/$merge; nothing was pushed" >&2
         return 1 ;;
    esac
  fi
}
push_pr_branch "<base from step 2>"
```

Replace `<base from step 2>` with the base branch's name, such as `main` or the parent PR's branch; an empty or unreplaced base stops the push. Matching names push to the upstream's own remote, so a branch tracking `fork/<branch>` stays on `fork`. No upstream yet, a local upstream, or an upstream that is the base branch keep the plain `git push -u origin HEAD`, so a stacked child gets its own branch rather than pushing onto its parent's. Differing names first ask GitHub whether the upstream heads an open PR. If it doesn't, the upstream is a parent whose PR already merged or closed, so the branch takes the plain push and gets its own name. If it does, `HEAD` goes to the configured upstream explicitly, leaving the upstream setting alone, and git moves the `$remote/$merge` tracking ref with the push. The lookup uses the REST API, which a Claude Code cloud session allows where it refuses GraphQL, and it passes the head filter with `-F` because only `-F` expands `{owner}`: with `-f`, GitHub receives the literal `{owner}`, matches no PR, and every upstream takes the plain push. Both flags percent-encode the value, so a `+` or `#` in the branch name reaches GitHub intact either way. It counts only PRs whose head branch is in `gh`'s own repo, so a fork's head is out of its reach. If `gh` can't answer, the push stops rather than guessing. An upstream with an open PR whose remote branch is gone stops: recreating it would push to a branch the PR may no longer use, so surface it rather than picking a name. A remote that can't be read stops too, with its own message, since that is an access problem rather than a merged PR.

If the pre-push hook fails with `.husky/_/husky.sh: No such file or directory`, the current dir is a worktree without husky bootstrapped. Run the install command in the package dir of the worktree (per the `new-worktree` skill), then retry the push.

### 6. Fill in the template

Read the diff vs base:

```bash
git diff <base>...HEAD --stat
git log --oneline <base>..HEAD
```

Apply the two-pass workflow to write the **Summary**. Per-section rules:

- **Summary** — one sentence + 2–5 bullets per the structure above. Use the user's stated intent and any ticket context as the source of "why", and apply [Evidence for mechanism claims](#evidence-for-mechanism-claims) before stating how the system behaves.
- **Checklist** (if the template has one) — leave items unchecked. The author checks them after manual verification. **Keep every default checklist item the template ships with** (e.g. `Unit/integration tests`, `Tested manually and confirmed it works as expected`). Stack/dependency items are added _in addition to_ these — never replace or drop the template's defaults, and don't substitute a custom `Test plan` section for them. After rendering, re-read the template's `## Checklist` and confirm each of its items is present in your body verbatim. If the PR changes tests, the `Test time` line from step 4 goes at the bottom of this section, below the items and outside the list — and if it doesn't, that line is absent entirely ("Test time" above). When tests changed but the template has no `## Checklist`, append that section with required stack/dependency items when applicable followed by the timing line; do not invent template-default checkbox items.

  **If this PR is part of a stack** (resolved in step 2), it also carries the two stack checklist items, prepended above the template's defaults — and every other open PR in the chain has to carry the merge-mechanism one too. [`pr-body-rules`](../pr-body-rules/SKILL.md) is the single source of truth for both items' exact text and for the backfill; follow it rather than reproducing the rules here, and report which PRs you updated in step 12. The stack *outline* is a separate, generated thing — step 10 handles it, and it is not something you write into the template.
- **Reviewer test steps** (e.g. an "If you'd like to test yourself" section) — only include concrete steps if you actually know how to exercise the change locally (a script command, a URL, a feature flag toggle). If unsure, delete the section. Do not write generic "run the app and click around" filler. If the user said reviewer testing is required (rare), rename the heading to something like `Please test this yourself before approving`.
- **Migration commands** — if the diff is a database migration PR, add a `## Migration commands` section (after Summary, before the Checklist) with the exact apply and revert commands for each migration file, copy-pasteable from the app directory. Use the repo's real invocation — check how migrations are actually run (package.json scripts, migration docs) rather than guessing. In Substack, that's the writer knexfile explicitly:

  ```bash
  ./esr node_modules/knex/bin/cli.js migrate:up <migration_file>.js --env development --knexfile knexfile-writer.ts

  ./esr node_modules/knex/bin/cli.js migrate:down <migration_file>.js --env development --knexfile knexfile-writer.ts
  ```

  Point `./esr` at the package's JavaScript entrypoint (`node_modules/<pkg>/bin/cli.js`), not a shell shim in `node_modules/.bin/`. `esr` runs its argument as JavaScript, and Substack's pnpm-installed `.bin/knex` is a shell wrapper — running `./esr node_modules/.bin/knex ...` makes Node parse `basedir=$(dirname ...)` as JavaScript and fail with `SyntaxError: missing ) after argument list`. Package managers may also link a JavaScript entry directly, so use the target `bin` field from the package's `package.json` (or the path a wrapper resolves) rather than assuming the `.bin/` shape.

- **Screenshots** — leave the heading + any HTML comment if it's a UI change (Step 11 will offer to fill it in); delete the section entirely if not. If the template has no Screenshots section and Step 11 ends up wiring in images, append one at the end of the body.
- **Tracker first line** — fill in the URL gathered during intake. Drop the line entirely if the user confirmed there's no ticket. If the template ships with a placeholder (e.g. `Linear:` on the first line), complete it or remove it.
- **Name the item, not just the issue**, when the ticket is an umbrella holding several findings — `Issue: <url> (item 3)`. Whoever merges this PR is the one who ticks that item, per AGENTS.md's "Keeping a filed finding's state", and an issue number alone doesn't tell them which of six boxes to tick. The line costs three words and is the only thing carrying the fix's target past the moment you stop working on it.

### 7. Choose a title

- Concise, present-tense, no trailing period.
- If a tracker ticket ID is known and the repo's existing PR titles use one (check `gh pr list --limit 10`), prepend it (e.g. `[ABC-123] `).
- Otherwise reuse the latest commit message subject if it's already good, or summarize the diff in <80 chars.
- The title is itself a single-sentence summary; same rules apply (purpose, not narration).

### 8. Create the PR

After step 6 finishes the body template, prepare the final creation record.
For agent-facing work only:

```bash
"$agent_provenance" record-target \
  --record "$creation_record_file" \
  --target '<cloud|local|either|both>' >"$record_file"
```

For non-agent-facing work, use `"$creation_record_file"` unchanged as
`"$record_file"`. Render once for inspection, then insert once into the finished
template:

```bash
"$agent_provenance" render --record "$record_file" >"$context_block_file"
"$agent_provenance" body-insert \
  --record "$record_file" \
  --body "$template_body_file" >"$initial_body_file"
```

The PR must receive `"$initial_body_file"` in the same create call:

```bash
CREATE_PR_SKILL=1 gh pr create --draft --base <base> \
  --title "<title>" --body-file "$initial_body_file"
```

The `CREATE_PR_SKILL=1` prefix is required: a `beforeShellExecution` guard denies bare `gh pr create` / `gh pr edit` to enforce that PRs go through this skill. Keep the prefix on every `gh pr create` / `gh pr edit` invocation below. It keys on the command, not on how you pass the body, so `--body-file <path>` needs it just the same — and without it that form is denied identically, with a message that names the skill rather than the flag, which reads like `--body-file` being unsupported when it isn't.

### 9. Verify or update agent context

For a newly created PR, re-read the body and verify that it contains exactly one
start marker, one end marker, and one machine record matching `"$record_file"`.
The context was part of the initial body, so no follow-up body write is needed.

For an existing PR whose runtime target changed:

1. Read [`pr-body-rules`](../pr-body-rules/SKILL.md).
2. You must fetch the live body immediately before the transform. This fresh
   read is the compare-and-swap snapshot, not a body saved earlier in the
   workflow.
3. Run `"$agent_provenance" body-target --target <cloud|local|either|both>` against that
   exact body. The command preserves creation context and surrounding bytes.
4. Write the result through the sanctioned PR-body adapter with `--body-file`.
5. Re-read the body and verify the markers, machine record, requested target,
   frozen creation fields, and surrounding content.

When an agent-facing PR becomes ordinary, run
`"$agent_provenance" body-target --clear-target` against the fresh live body
instead. It removes Required coverage while preserving frozen creation fields.
Use the same sanctioned compare-and-swap write and readback checks.

If the compare-and-swap guard reports stale state, discard the transformed
output, fetch the live body again, and repeat. Never apply the later session's
normalized record to an existing PR.

### 10. Refresh the stack outline

If this PR is part of a stack, put the `## PR stack` outline on every PR in the chain now that this one exists:

```bash
pr-stack-section --apply <new-pr-number>
```

That's the whole step — the script resolves the chain in both directions from whatever PR you name, so it also refreshes the parent's and any children's outlines to include this new PR. It places the block under the tracker line and above the Summary, and rewrites nothing that's already current. [`pr-body-rules`](../pr-body-rules/SKILL.md) owns the rules; don't hand-write the block, reproduce its format, or put it in the template in step 6.

This step is also load-bearing for later: the block records the tree it drew, and that record is the only thing that survives a merge deleting the parent's branch and retargeting the children. Running it here, while the base refs are still intact, is what lets the outline still show the landed part of the stack months from now. Skipping it doesn't just leave today's outline missing — it means there is no history to recover.

Do this **before** step 11, not after: step 11 sends the user to the browser's pencil, and any body write racing that is how their edits get clobbered. Skip the step entirely for a standalone PR (the script will tell you it isn't stacked, and change nothing).

### 11. Add screenshots (optional)

After the draft PR exists, offer to wire up screenshots. Skip the question (and this step) only if the diff has zero UI surface — no `.tsx` / `.jsx` / `.vue` / `.swift` / `.kt` files, no CSS, no template changes. When in doubt, ask.

**Why this flow looks like it does.** `gh --attach` uploads to GitHub's own attachment store with the CLI token and writes the attachment markdown into the PR body. Use it by default. The browser upload remains the fallback when the user supplies their own images. Claude Code cloud sessions cannot reach the upload endpoint, so they commit their captures to a `pr-assets` branch instead.

#### 11.1 Ask the user

First, offer to **take the screenshots yourself**. Ask via the structured multiple-choice UI (the `AskQuestion` tool / native question card) whenever the harness provides one; options should be clickable and self-describing — never bare numeric codes like `done 2` that the user has to decode:

- **Take them for me** — you capture the screenshots (dev server + browser, simulator, etc.). On a local machine, save them to their own folder under `/tmp` (per the global screenshots rule in `~/.agents/AGENTS.md`), reveal that folder in Finder, and attach the files with `gh --attach`. In this path, **you choose the format** (pick whatever fits the images best — plain inline, two-column, or captioned) and skip the format question and the format-specific input in 11.4; go straight from parsing (11.2) and order confirmation (11.3) to rendering (11.5).
- **I'll upload my own** — the user captures and uploads their own screenshots; continue with the upload instructions and format question below.
- **Skip** — leave the Screenshots section blank.

If the user chose "take them for me" on a local machine, run `gh --version` before capturing. `gh --attach` needs `gh` 2.99.0 or newer. If the installed version is older, update it with the package manager that installed it and check the version again. If it cannot be updated, stop and ask whether to use the browser upload fallback instead of attempting an unsupported flag. When the user accepts, capture the screenshots, reveal their folder in Finder, follow the browser fallback below, and do not enter the attachment path.

Once the version preflight passes, capture the screenshots and reveal their folder in Finder. Do not send the user to the PR body editor on this path; keep browser editing paused until attachment verification finishes.

`gh pr edit --attach` is a whole-body write: the CLI reads the current body, uploads the files, then writes its captured body plus attachment markdown. The body-clobber guard cannot see that hidden read/write pair. Before attaching:

1. Fetch and save the live body.
2. Record its `user-attachments/assets/...` URL multiset.
3. Fetch and save `userContentEdits(first:10)` using the recovery query in [`pr-body-rules`](../pr-body-rules/SKILL.md).

Attach all files in one command so there is one body-write window. Give every alt text a unique run label or short head SHA; alt text stays readable metadata, never upload identity:

```bash
CREATE_PR_SKILL=1 gh pr edit <N> \
  --attach '/tmp/<task>-screenshots/before.png#<short-sha>: <what the before image shows>' \
  --attach '/tmp/<task>-screenshots/after.png#<short-sha>: <what the after image shows>'
```

The command can update the body before returning a failure. After it returns, even nonzero:

1. Fetch the live body through the non-authorizing REST read in `pr-body-rules`.
2. Fetch `userContentEdits(first:10)` again and subtract the pre-attach revision set by `editedAt` plus full `diff`. If history lags, wait and re-read once.
3. Order the new revisions oldest-first. Starting with the pre-attach body, compare each revision's URL multiset with the immediately preceding revision and identify where this run's URLs first appear. A later browser revision that carries a URL forward introduces nothing and cannot masquerade as a second upload. Require exactly one revision that introduces this run's URLs; it may be current, older than a browser save, or present after the command returned nonzero. If none or more than one fits, stop rather than guessing or uploading again.
4. Diff that CLI revision's URL multiset against the pre-attach body. Those newly minted URLs—not the current body's contents and not alt text by itself—prove what this invocation uploaded.
5. If any other revision appeared, use the newest non-CLI revision as the recovery base. If it already contains every new URL, the user's save preserved the attachment and no body write is needed. Otherwise copy only the missing attachment markdown from the identified CLI revision, then write that reconciliation through `pr-body-rules`' authorizing snapshot/write/verification flow. This handles both race orders: browser-before-CLI and CLI-before-browser. Report what you restored.
6. Re-read the live body through the non-authorizing REST path and confirm it contains every newly minted URL plus the recovery base's text.

If some files are still missing after a failed batch, fix the reported cause and run one new command containing only those files. Before that retry, repeat the body, URL, and revision snapshots above.

Attachment needs push access. Images and GIFs are limited to 10 MB; videos are limited to 10 MB on Free plans and 100 MB on paid plans. Keep images under 500 KB where practical.

**Claude Code cloud session:** don't run the attach command or try to reveal Finder — its GitHub proxy cannot reach the upload endpoint. Commit the files to `pr-assets` and link them by commit SHA, following [`capture-pr-screenshots`' cloud-session section](../capture-pr-screenshots/SKILL.md#from-a-claude-code-cloud-session). You wrote those links, so skip 11.2 and 11.3 and go straight to rendering (11.5) and splicing (11.6) with them.

If the user chose "I'll upload my own", or the old-`gh` fallback applies, send these upload steps:

> 1. Open the PR: <PR URL>
> 2. Click the pencil to edit the body, then drag-drop the screenshots anywhere in the body (don't worry about where — I'll move them into the Screenshots section). Wait for each upload to finish (the `[Uploading ...]` placeholder gets replaced with the real URL), then save.

For "I'll upload my own", ask the format as a multiple-choice question. Name **and** describe every option in plain language:

- **Plain inline** — each image full-width on its own line
- **Two-column table** — images paired side by side under shared column headers like "Before | After" (follow up once for the two header names)
- **Captioned table** — images side by side with a caption row under each pair (follow up for one caption per image; see https://github.com/substackinc/substack/pull/63999 for the rendered shape)

Treat the user's format answer as the "uploads are finished" signal — don't require a separate "done" message. If the structured question UI isn't available, ask the same questions in plaintext with the option names and descriptions spelled out, and accept answers by name (e.g. "two-column"), not just by number. For a browser fallback after "Take them for me", keep the format you chose and ask only for confirmation that the upload finished.

#### 11.2 Fetch the body and parse images

After every `gh --attach` attempt, whether it succeeded or failed, or once the user finishes the browser upload:

```bash
gh pr view <pr-number> --json body --jq .body > /tmp/pr-<N>-body.md
```

Extract every user-attachments image reference, in document order. GitHub emits two shapes when you drag-drop:

- `<img width="W" height="H" alt="<filename>" src="https://github.com/user-attachments/assets/<uuid>" />` (the modern shape; carries intrinsic dimensions and alt text)
- `![<alt>](https://github.com/user-attachments/assets/<uuid>)` (the older markdown shape, occasionally)

For each match record: URL, width, height (if present), alt text (if present). Missing dimensions are fine — just omit the `width`/`height` attributes in the rendered output and let GitHub auto-size.

On the `gh --attach` path, use the CLI attachment revision identified in 11.1. Compare its URL multiset with the pre-attach body, require one newly added URL per expected file, and associate those URLs with the command's unique alt texts. An old URL carrying the same descriptive text proves nothing about this run. After any race reconciliation, verify those same new URLs in the live body. A nonzero command that minted all expected URLs has already succeeded; do not retry it. If URLs are missing, report that command's error, fix the cause, and retry only those files after taking fresh snapshots.

On the browser path, zero images usually means the user saved before the uploads finished. Tell them: "I don't see any `user-attachments/assets/...` URLs in the body yet — did the uploads finish before you saved? Wait for each `[Uploading ...]` placeholder to turn into a real URL, save again, and let me know." Don't proceed.

Proceed to order confirmation only after every expected file has attachment markdown in the body.

#### 11.3 Confirm order

List the parsed images in chat, numbered by alt text (the filename GitHub auto-fills), and ask once:

```
Found N image(s) in the body:
  1. Screenshot 2026-05-28 at 1.04.27 PM
  2. Screenshot 2026-05-28 at 1.05.09 PM
  3. ...

Order look right? (y / "swap N M" to swap two / "drop N" to remove one)
```

Accept one round of reordering edits, re-print the list, then proceed. Don't loop forever — if the user keeps tweaking, fold them all in and move on.

In-chat preview is not available: GitHub gates `user-attachments/...` URLs behind real browser cookies, so the URLs neither render inline in Cursor's chat panel nor download with the `gh` OAuth token. The user identifies images by filename + index, with the PR open in their browser as the visual reference. Don't try to embed them.

#### 11.4 Collect format-specific input

Skip this step entirely if you took the screenshots yourself (11.1 "take them for me") — you chose the format, so write your own headers/captions from what each screenshot shows.

- **Plain inline** — no further input.
- **Two-column table** — ask once: "Two column headers? (e.g. `Before | After` or `Desktop | Mobile`)". Parse the two halves on either side of the separator.
- **Captioned table** — ask one caption per image, one at a time, referencing the filename so the user can identify it:

  ```
  Caption for image 1 of N (Screenshot 2026-05-28 at 1.04.27 PM):
  ```

  Accept the reply and move to the next. An empty reply leaves that caption blank (`|  |`). After the last image, confirm: "All captions captured. Splicing into the PR body."

#### 11.5 Render the Screenshots block

Use the recorded URL / width / height / alt for every `<img>` tag. Width/height attributes are optional — omit them entirely (no empty `width=""`) if you don't have them.

**Plain inline.** One `<img>` per line:

```
<img width="W" height="H" alt="<filename>" src="https://github.com/user-attachments/assets/<uuid>" />
```

**Two-column table with shared headers.** Lay out in 2-column rows; if the count is odd, leave the last cell empty:

```
| <header A> | <header B>
| --- | ---
| <img width="..." height="..." alt="..." src="..." /> | <img width="..." height="..." alt="..." src="..." />
| <img width="..." height="..." alt="..." src="..." /> | <img width="..." height="..." alt="..." src="..." />
```

**Captioned table.** A 2-column table where each pair of images is followed by a row of captions, and pairs are separated by two blank rows. Matches the format in https://github.com/substackinc/substack/pull/63999. The `| _ | _` header row is intentional — GitHub renders the cells empty so no visible header sits above the images.

```
| _ | _
| --- | ---
| <img width="..." height="..." alt="..." src="..." /> | <img width="..." height="..." alt="..." src="..." />
| <caption 1> | <caption 2>
|  |
|  |
| <img width="..." height="..." alt="..." src="..." /> | <img width="..." height="..." alt="..." src="..." />
| <caption 3> | <caption 4>
```

If the image count is odd in either table format, the trailing image cell gets a partner empty cell (`| <img ... /> | `), and in the captioned table the caption row matches (`| <caption N> | `).

#### 11.6 Splice into the PR body

**Re-fetch the body first.** The copy from 11.2 predates every question you asked in 11.3 and 11.4, and on the browser path the user may still have the pencil open. Refetch now, re-locate the image tags in the fresh text, and make the two edits below against it ([`pr-body-rules`](../pr-body-rules/SKILL.md)).

Two edits to the body in one `gh pr edit` call:

1. **Strip every parsed `<img>` / `![](...)` user-attachments reference from wherever it currently sits in the body.** Otherwise the images render twice (once where the user pasted them, once in the formatted block). Also strip any now-orphaned blank lines those tags left behind.
2. **Insert the rendered Screenshots block** into the existing `## Screenshots` section, replacing any HTML-comment placeholder from the template. If the template had no Screenshots section, append `## Screenshots\n\n<block>` at the end of the body.

Then push:

```bash
CREATE_PR_SKILL=1 gh pr edit <number> --body "$(cat <<'EOF'
<updated body>
EOF
)"
```

Same heredoc rules as Step 8 — single-quoted delimiter, no escaping. Keep the `CREATE_PR_SKILL=1` prefix (see Step 8).

### 12. Report the PR URL

Only after step 9 verifies the agent context block, print the URL `gh` returned,
plus a one-line note if you based on a non-default branch (so the user knows the
stacking order), a one-line note naming the other stack PRs whose bodies you
touched — the outline refresh in step 10 and any `/merge-stack` reminder you
backfilled in step 6 — and a one-line note if a screenshot upload failed (so
they know to attach manually).

## Editing an existing PR body

If the user asks to revise / tighten / rewrite an existing PR body (not create a new PR):

- Preserve real meaning; remove filler and repetition aggressively.
- Elevate low-level bullets into higher-level reviewer-relevant statements when possible.
- Keep only details that affect reviewer understanding, scrutiny, or risk.

**Read [`pr-body-rules`](../pr-body-rules/SKILL.md) before you write.** `--body` overwrites the whole body, so the mechanics — refetch immediately before the write, edit that exact text, verify after, and recover a version you clobbered — live there. This applies to every body write in this skill, not just a user-requested rewrite: the screenshot splice in step 11.6 and the checklist backfill in step 6 are the two that have actually destroyed the user's writing.

Update via:

```bash
CREATE_PR_SKILL=1 gh pr edit <number> --body "$(cat <<'EOF'
<new body>
EOF
)"
```

## Behavior on weak input

If the user provides only a rough description, scattered notes, or just "open a PR":

- Infer the likely reviewer-facing purpose from the diff and chat history.
- Compress details into higher-level points.
- Don't invent specifics not supported by the input.
- If key context is missing, still produce the best possible body from what's available rather than blocking on questions. Make uncertainty explicit only when it's real and matters to the reviewer.
- The **only** allowed clarifying questions are the ticket intake (above) and, if applicable, the host-clone confirmation (above). Don't expand to a list of follow-ups.

## Branch and commit conventions

Follow whatever conventions the repo already uses — read its `CLAUDE.md`, `CONTRIBUTING.md`, or recent branch/commit history (`git log --oneline -20`, `git branch -a`) and match. Don't impose a default if the repo has its own pattern.
