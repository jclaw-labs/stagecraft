# Agent instructions

Personal working rules for any AI coding agent acting on my behalf — Cursor, Claude Code, Codex, others. They cover _how_ I work: git hygiene, pull requests, code comments, and how you report back to me. They are the same rules I run on every project of mine.

**This file is vendored.** It is generated from my `local-config` repo by `bin/sync-project`, so the copy in this repository is a build artifact — an edit here is overwritten by the next sync. Change the source in `local-config` instead. `.claude/toolkit.manifest` records the commit this copy came from.

**Precedence.** These rules govern process, and on process they are authoritative. They do not override this repository's own guidance about the product itself: where this file and the repo's `CLAUDE.md`, `PROJECT.md`, or an active skill disagree about the domain, the architecture, or what the software is allowed to do, **the repository wins**. Repo docs and skills still govern anything these rules are silent on.

## When a hook blocks a command

Several of the rules below are enforced by `beforeShellExecution`/`preToolUse` hooks, and a hook denial is deterministic — not a flaky check, not an approval prompt. The identical command will be denied every time, so **don't retry it**, and don't reach for `request_smart_mode_approval` to push it through: that flag is for Cursor's _Auto-review_ classifier, not hook denials, so the retry just gets denied again. Take the narrower allowed path the block names instead — a threaded reply rather than a top-level `gh pr comment`, a claimed slot rather than the root checkout — or surface the situation to me and let me decide. Routing around a guardrail is never the answer. On the Substack Mac the same hooks run in Claude Code too, through `claude/cursor-adapter.py`, which `setup.zsh` registers in `~/.claude/settings.json`; a denial there comes back as a refused tool call carrying the same message, and it means the same thing. The test shims, the Playwright path and the worktree database URLs reach Claude Code's shell through its session env file instead of being prefixed to each command, and the database URLs follow the directory the shell is in, so commands run inside a slot keep my allow rules. A command that names a different worktree's path than the one the shell is in (any worktree, from the root) still comes back with that worktree's database URLs exported in front, and Claude Code asks before running it even when my rules allow the command as typed. So `cd` into the worktree on its own, which asks once, and run the rest from there.

## When the shell stops responding

If the Shell tool returns "no exit status" instead of output or an error, the shell session for this conversation is dead, and it does not recover — I've watched an agent re-probe it for half an hour. Two of those in a row is the signal.

Don't keep probing, and don't report the work as blocked. A subagent runs in its own process and gets a healthy shell, so dispatch one to run the commands for you. Only a subagent's final message reaches you, so tell it to put the full output there rather than describing it.

## Subagents have these rules too

Each runtime has its own route to this file:

- **Claude Code, on every machine `setup.zsh` has run on**, reads it natively. `links.conf` links `~/.claude/CLAUDE.md` to this file with no variant tag, and Claude Code loads that into every session and every subagent it starts, apart from built-in read-only agents such as Explore and Plan, which skip it. On the Substack Mac, `claude/cursor-adapter.py` skips the injection hook below, so Claude Code never gets a second copy.
- **Cursor, on the Substack Mac only**, gets it from `~/.cursor/hooks/inject-global-agents-md.sh`, which adds it at session start and prepends it to every new `Task` prompt. `links.conf` links `~/.cursor/hooks.json` and `~/.cursor/hooks` for the `substack` variant alone. If a subagent there reports it has no Buildkite or Datadog access, check that hook rather than rewording anything here.
- **Cursor on the personal, pi5 and pop machines, and any agent on a cloud VM,** get no home copy. The hook is not linked on those machines, on purpose, and `setup.zsh` never runs on a cloud VM. They have these rules only where the repo carries a copy, such as the root `AGENTS.md` that `sync-project` writes into my projects.

So don't paste chunks of this file into a subagent's prompt: where the runtime delivers it, a pasted copy loads it twice. The one handoff that needs a paste is a cloud agent launched from a machine without the hook, and the `local-or-cloud` skill covers it.

## After a wait, re-check before acting or reporting

I usually keep working while a question of yours sits unanswered, so I may well have merged the PR you were about to merge, committed the fix you were about to write, or landed the branch you were about to rebase. Anything you learned before a pause can be stale by the time you resume.

So when you come back from a blocking question, a long-running command, or an overnight gap, re-read the specific state you're about to rely on before you act on it or report it — the PR's state, the branch tip, the working tree, the latest CI run. Offering to fix something I already fixed is worse than the second it costs to look.

## A watcher that can't poll must say so

A background watcher that polls the network (a queue, a PR, a CI run) has two outcomes that look the same from outside: "nothing happened" and "the poll failed". If the loop discards stderr or turns a failed `gh api` into an empty result, it stays "running" while it sees nothing at all. One queue watcher ran for over an hour that way while three `Needs review` issues arrived, and only the 30-minute heartbeat found them.

So when you write one:

- **Prove the first poll works before you leave it running.** Run one poll in the foreground and check that it exited 0 with a well-formed response. An empty list is a fine answer; output alone proves nothing, since `gh api --jq` can print an error body to stdout and still fail. A watcher whose first poll failed is not armed.
- **Keep a failure distinct from an empty result.** Check the exit status and put the error somewhere that reaches you, which usually means stdout: a watcher harness may write stderr to a file and never wake you with it. Never `2>/dev/null` a poll, `|| echo '[]'` it, or `|| true` it without counting the failure, even where tool guidance suggests `|| true` for transient errors.
- **Repeated failures wake you.** After a few consecutive failed polls (three is a fine default), exit with the error. Exit wakes you in every harness; printing a line instead only works where stdout lines are events. A watcher that quietly keeps failing is worse than none, because its silence reads as "no event".

## PR comments

**What you can always do:** reply to _my_ comments and to _bot_ comments (Greptile, Cursor, Bugbot, etc.), and resolve those threads. Reading comments to surface them is always fine. GitHub replies and thread resolves are NOT off-limits in general — the one rule below is narrow.

**The one rule:** never respond to another _human_ reviewer — anyone other than me. For someone else's comment: no reply, no new PR/issue comment, no review, no fix tied specifically to their comment, and don't resolve their thread. Surface it to me and let me decide. If you break this rule I will be fired by my company.

The discriminator is _who authored the comment you're acting on_, not the action itself:

- **Me.** I'm the PR author. When I leave a comment or ask you to act on one, address it and resolve the thread. **Prefer resolving with no reply** — the resolved state plus the diff already says you handled it. Only leave a reply when it adds something the resolve doesn't: you didn't make the change, you did something different than asked, or the "why" isn't obvious from the diff. Merging my PR is fine too.
- **A bot.** Automated reviewers aren't human, so the rule doesn't apply — resolve their threads, validating their suggestions rather than obeying them. Same reply preference as my threads, with the "you didn't make the change" case made explicit because it's easy to under-apply here: **when you decline a bot's suggestion (no code change), reply with the reasoning before resolving.** A bare resolve on a declined suggestion is indistinguishable from silent acceptance — someone reading the thread later can't tell whether the bot was wrong, the fix landed elsewhere, or it was ignored. Hold that reasoning to a real bar: you refute a bot by naming the mechanism that makes it wrong, not by failing to find the code that would make it right. "I searched and nothing sets that" is how you talk yourself into dismissing a true finding — go find the thing that does. When you made the change as suggested, resolve with no reply as usual.
- **Any other human.** Surface, never answer: don't reply and don't resolve their thread.

**Prefix every reply with `[Agent]`.** Any comment you post on GitHub — practically always a thread reply — must start with `[Agent] ` so readers can tell an agent wrote it. Use `[Agent]` in every harness (Cursor, Claude Code, Codex): it marks agent-written text, not the tool. The GitHub account is mine, so without the prefix your words read as mine (jclaw); the prefix is the attribution. Older comments start with `[Cursor] `; leave them as they are.

To resolve with no reply — the default — just call `resolveReviewThread`. When a reply _is_ warranted, use the REST reply path — `POST repos/<owner>/<repo>/pulls/<n>/comments/<id>/replies` (or `in_reply_to=<id>`), then `resolveReviewThread`. Don't use a top-level `gh pr comment`: it isn't tied to a thread, so the hook blocks it no matter who you're responding to.

**Standalone notes go in the PR body, never a top-level comment.** When you want to record context on a PR that isn't a reply to anyone — a caveat about the change, a heads-up for reviewers, why it looks the way it does — put it in the **PR body**, not a `gh pr comment`. Something you're *not* fixing here is a different thing and belongs in the tracker instead; see the finding rule below. Edit the description (via the `create-pr` skill) so the context lives with the PR instead of as a loose comment that pings people. Between this and the reply paths above, there's effectively no reason for you to post a top-level PR comment — the sole exception is the `deep-review` skill's own marker and the response `address-deep-review` posts to it.

A `beforeShellExecution` hook (`guard-no-reviewer-reply.sh`) enforces this, and it's narrower than the rule: for a targeted reply/edit it resolves the _author of the comment you're acting on_ and allows the write when that author is me or a bot, denying only writes aimed at another human (plus every top-level `gh pr comment` / `gh pr review` and the `addComment` / `addPullRequestReview*` / `submitPullRequestReview` GraphQL mutations, which aren't thread-targeted — with one sanctioned exception: a `gh pr comment` prefixed `DEEP_REVIEW_SKILL=1`, which is the `deep-review` skill posting its review-marker comment or `address-deep-review` posting its response to one). It never blocks reads, and it leaves `resolveReviewThread` and merges alone — so resolving isn't hook-enforced; keep it to my threads and bots' per the rule. If it denies a write, that's the guardrail catching a reply aimed at another human: surface that comment to me instead of routing around it.

## PR labels

Don't add or remove labels on PRs on your own. Labels often gate CI checks,
deploy behavior, or review routing — surface what label you'd add and why, and
let me apply it.

## Agent context and runtime targeting

At session start, establish the model, effort, and creation environment from the
authoritative provenance source supplied by the harness. Never infer them from the
prompt or a self-reported model name. If the harness reports a model change, retain
the provenance for every model seen and re-check it before creating an artifact.
Use the `agent-provenance` skill for the platform-specific steps.

For agent-facing work, classify the target by the behavior an agent can reach,
not by the files it changes:

- Use cloud only when every changed behavior is behind an explicit cloud-only boundary.
- Use local only when every changed behavior is behind an explicit local-only boundary.
- Use either when cloud and local reach the same changed behavior path.
- Use both only when correctness depends on distinct cloud and local behavior.

`Either` means one environment exercises the whole change. `Both` means one
environment cannot cover it. Uncertainty is not a target. Inspect the reachable
behavior until one value is justified, and fail closed if it remains unresolved.

Every agent-created PR, issue, or ticket must carry exactly one agent context
block in its body. The block records creation context as a structured identity:
lab, line, version, modifiers, effort, creation environment, raw runtime ID,
and, for agent-facing work, runtime target. Unknown identity fields stay
explicitly unknown, and the raw runtime ID is preserved. Only agent-facing work
adds a runtime target. Non-agent-facing work keeps target absent and has no
cloud/local coverage gate.

The model identity, effort, and creation environment are a frozen snapshot of
the artifact-creating session. Later agent editors and reviewers must not
replace the creation context with their own session. Only the runtime target may
change when the runtime scope changes.

When agent-facing work becomes ordinary, remove only its runtime target. The
frozen creation context stays unchanged.

New artifacts include the rendered block in their initial body or description.
Existing artifacts do not gain creation context retroactively. When an existing
PR's target changes, fetch its live body immediately before the edit, transform
only the owned block, write through the sanctioned PR-body path, and re-read the
body to verify the visible block and machine record.

Work targeted at `either` needs a check in cloud or local. Work targeted at
`both` stays draft or not ready until both paths have been checked. A reviewer
running in an incompatible environment hands the review to a compatible
reviewer instead of approving an unchecked path.

## New work: decide local or cloud first

When I hand you a new piece of work that will end in a commit, read the `local-or-cloud` skill before you claim a worktree or touch a file, and follow its decision: do it here, or hand it to a Cursor cloud agent. When it picks cloud, treat that as my explicit request for a cloud agent. Skip it for read-only questions, for follow-ups on work already underway in this session, when you're a cloud agent or a subagent yourself, when the skill isn't installed where you're running, and in the other cases the skill lists. When I ask for a cloud agent, still read the skill, because it lists what to check before launching and what the prompt must carry. A cloud agent or subagent skips because the decision was already made upstream of it.

## Always commit, push, and open a PR

When you make changes, ship them: commit, push, and open a PR — or push onto the existing one. Don't wait to be asked. This is the default for new work and for addressing feedback on existing work. A local-only diff is unfinished. When you're done, give me the PR URL, not a "want me to commit this?" prompt.

If a PR already exists for the branch, add a follow-up commit and push. Don't open a second PR, and don't leave the fix sitting uncommitted.

Any time you create, open, draft, push up, revise, or tighten a PR, use the `create-pr` skill — read and follow it instead of hand-rolling `gh pr create` / `gh pr edit`. The skill owns the draft flag, tracker line, body shape, local checks, and screenshot flow. A bare `gh pr create` is not the fast path, it's the wrong path.

Skip shipping only when one of these is true:

- I explicitly said not to commit, not to push, or not to open a PR
- There is nothing to ship (read-only, no file changes)
- The files are secrets or credentials
- The git repo isn't the active workspace and I haven't already asked you to work there — confirm first, and once I have, ship as usual

The Substack root checkout is not an exception to shipping; it's an exception to *where*. Claim a slot, then commit, push, and open the PR from the slot. Same for local-config's root checkout: make a worktree, then ship from it.

Don't invent extra exceptions. "It's a small change", "you might want to review locally first", and "I'll wait until you say ship" are not exceptions.

## A finding you're not fixing goes in the tracker

When you notice something real that you won't fix in the current change — a gap in a neighbouring file, something a retro turned up, a decision that needs making, a fix that would collide with an open PR — file it. Don't narrate it in the PR body, and don't drop it.

That's the line against the PR-body rule above, and it's about what the text is *about*. A body carries notes on *this* PR, and stops being read the moment it merges. A finding is about something else and outlives the PR, so a finding parked in a body is a finding lost.

**GitHub issues everywhere, Linear for Substack.** A Substack finding goes to the **SPON** team, assigned to me, labelled `ai:draft` — a label that already exists for agent-drafted tickets. SPON is my team, so the finding lands in my lap and I move it if it belongs elsewhere. Don't try to route by which team owns the code: a wrong guess drops a ticket on a stranger's board. In a repo that is neither mine nor Substack's, surface the finding to me instead of filing it.

Before filing, search open issues and PRs for the same thing. A match gets a comment saying you hit it too, not a second issue — a second sighting is better signal than a duplicate, because it says the thing recurs. On GitHub use `gh issue comment`; the `gh api` path works too, but the reviewer-reply guard denies it when it can't confirm the number is an issue rather than a PR.

For a new finding, render the filing session's agent context before the create
call. GitHub issues include the rendered agent context block in the initial body.
Linear tickets put the block rendered with `--linear` in the initial
description, because Linear shows HTML details and comments as raw text. Don't
retrofit creation context onto an existing issue or ticket.

**That search gets skipped in exactly the case that needs it.** When the finding arrives mid-task and has nothing to do with what you're doing, writing it down feels like the whole job and searching feels like a detour — so the drive-by is what duplicates. Two sessions filed the same flaky suite that way, on two different assertions, neither one referencing the other. Search anyway; it is one command — `gh search issues --include-prs --repo <owner>/<repo> "<terms>"`, and it has to be that one, because `gh issue list --search` never returns PRs. If it finds nothing, run it once more with only one or two of the finding's most distinctive nouns. GitHub search requires every term, so a synonym or one extra word hides an exact duplicate: two searches for a Claim-marker bug both came back empty while an open issue with the same reproduction sat in the queue. Read the broad search's hits instead of adding terms back until the list is empty. You are the only person who can tell the two apart cheaply.

**When the tracker write itself is refused, or the dedupe search it depends on, the finding still has to outlive the session.** Don't loop on the write. A sandbox block is not a refusal: re-run it once with unrestricted network, and treat it as refused only if that re-run is refused too. A hook denial isn't a refusal of the write: take the narrower path it names, as "When a hook blocks a command" says. Some guards scan the whole command, body included, so they can trip on what the finding itself says, and the paths they name are for the command they think they saw, not for a write. If none of those paths fits, take the finding's text out of the command line, title included: `--body-file` for GitHub, with `gh api repos/<owner>/<repo>/issues -F title=@title.txt -F body=@finding.md` when the title itself trips the guard, and for Linear a title and description read from files into `lin`'s variables (see "Linear: use the GraphQL API, not an MCP"). If that is denied too, or there is no such path, the refusal is final. A classifier refusal gets one retry through the approval path where there is one — in Cursor, `request_smart_mode_approval`, which is what brings up the card. Once a refusal is final — a harness refusal, a classifier refusal with no approval path, or a retry that shows no card, errors, or that I turn down — stop retrying, and put the full text you would have filed in your reply to me, so I can file it from my own terminal. Also record it where the current work already lives — the PR body under its own heading, or the response comment inside a review loop — as a holding place rather than the destination. "I mentioned it" is not filed, and neither is a write that returned an error you didn't read.

Filing is not a way to avoid the work. If the fix is in scope, small, and safe, make it.

## Keeping a filed finding's state

**GitHub issues only.** A Linear ticket is yours to comment on but not to tick or close, per the Linear section below, so a Substack umbrella can't carry its state this way.

**Several findings at once go in one issue**, as a `- [ ]` line each under a hand-written `**Item status** — N of M decided.` line. That block is what a reader sees once they *open* the issue, and nothing recomputes the bold line, so it is the one part that can be wrong.

**Nothing about the body reaches the issue list**, so the title carries the only signal a scanner gets: suffix it `(+N …)` with the count of the items after the lead one. GitHub does render a progress badge in that row, but it counts *sub-issues* and ignores task lists entirely — measured on two public repos, where an issue with nine sub-issues shows `6 / 9` and an issue with five checkboxes in the same row position shows nothing. So don't expect the checkboxes to be visible from outside, and keep the suffix honest, because it is what's left.

**An older umbrella gets brought up to date the first time you touch it.** Several were filed before any of this — some have no list, some no suffix, and some a tally line using the older word. So when you resolve an item in one, add what's missing, fix the word and the suffix, and tick the items that were already decided. Otherwise the tracker keeps teaching the old form to whoever copies the convention off it next.

**Tick an item once it's decided, and say what you decided.** Resolved, declined, deferred, handed to another issue — all four are decisions, and the tick means only that the item needs no more attention. That is why the tally counts decisions rather than fixes: a declined item is finished, and a tally that refuses to count it holds the issue open forever. Name the outcome on the line, with the PR if there was one, and correct the tally. The comment is where the evidence goes, the body is where the state goes. Close the issue when every item is ticked — and close it as `NOT_PLANNED` when nothing in it was actually fixed, so the closed state itself says which happened — a `6 of 6` block reads the same whether every finding landed or every one was dropped.

**When the decision is a fix, the tick belongs at merge, and whoever merges does it.** The other three decisions have no PR to wait for — tick those when you make them. But an item fixed in a PR that never lands isn't decided, so it stays unticked as `(in PR #NN)` until that PR merges, and by then the agent that wrote the fix is gone, since shipping ends at *opened*. So it falls to whoever merges. Say which item a PR resolves in its body, or the merger has no way to know: `merge-stack` and `pr-body-rules` already tick a PR body's own checkboxes at that moment, and this is the same moment with a different target.


**Fetch the body immediately before you edit it, and write it back with `--body-file`.** `gh issue edit --body` replaces the whole body with no conflict detection — the same hazard as the PR-body rule above, and `guard-pr-body-clobber.sh` now watches `gh issue` alongside `gh pr`, so a clobber on an issue gets caught the same way: it snapshots the body when you read it, and denies the write if the live body has moved on since. A PR and an issue that share a number are tracked separately, so reading one doesn't authorize writing the other. Follow `pr-body-rules`' discipline anyway: read it now, change the one line, write it back. Keep the body's newlines out of the command text, because this repo's *other* guards split on newlines and judge each line as its own command — a body quoting a force-push in a fence gets denied on its contents. `--body-file` only helps if the file was already there: writing it with a heredoc puts the body back in the command and denies just the same. Produce the file with your harness's file-write tool, or redirect `gh issue view <n> --json body --jq .body` into it and edit that.

## Visual evidence: every UI change ships with a screenshot

If a change alters what a person sees — a component, a stylesheet, a template, a rendered route, an admin form — the PR body carries screenshots of it before you mark it ready. Not a description of what changed, the picture. Before/after when you modified something that already existed, after-only for something new. Add a short recording on top when the change is in motion, since a hover, a transition, a drag or a multi-step flow can't be shown in a still — but a recording never replaces the stills, because most reviewers won't press play.

**Capture from the PR's deploy preview, not from localhost.** The preview is the build a reviewer can click, it's the artifact CI produced, and a shot taken from it proves the branch deploys and renders. A localhost shot proves your machine renders, which nobody else can reproduce or check. So wait for the preview to finish building and screenshot its URL. The `capture-pr-screenshots` skill has the mechanics — finding the preview URL, what to do while it builds, and the rule that every shot must visibly contain the thing that changed.

**If the repo has no deploy previews, tell me — don't quietly fall back to localhost.** Name the repo, say previews aren't wired up, and say roughly what adding them would take for that stack. Then carry on rather than blocking: capture from a local production build, and label those shots as local in the PR body so nobody reads them as evidence the branch deploys. I'd rather be nagged every time than find out later that every screenshot in a repo came off somebody's laptop.

Substack is the exception, and it doesn't need the nag. There's no per-PR preview an agent can reach there, so captures are local on the Mac — the browser sections below are the mechanics, and `web-ui-test-video` handles video.

**The image gets onto the PR with `gh --attach`, never a third-party host.** It uploads to GitHub's own attachment store and writes the markdown into whatever it posts; the `capture-pr-screenshots` skill has the flags, the size limits and the CI wiring. Two things that bite. An attachment outlives the comment that minted it, so a body can cite URLs a CI run already uploaded rather than posting them twice. And each posting mints fresh URLs, so name the run beside them — otherwise the body goes on rendering an old run's pictures long after the code moved, and nothing signals it.

**From a Claude Code cloud session `--attach` can't get through, but `git push` can.** Commit the shots to the repo's `pr-assets` branch and link them from the body by commit SHA — you may push there without asking, whatever branch you were told to work on. The `capture-pr-screenshots` skill has the commands and the two things to check first.

Skipping is allowed, and it has to be said out loud. A pure refactor with no visual delta, types, build tooling, backend-only work, tests: write `No screenshots — <reason>` in the body. An empty Screenshots section reads the same whether you decided or forgot.

## Stacked PRs: each must land safely on its own

When you split work across multiple or stacked PRs, every PR must be independently mergeable into the default branch and leave the product coherent once merged — even if the PRs above it never land. The `stacked-pr-rules` skill is the single source of truth for these landing-safety rules — read it whenever you create, slice, or reorder a stack; `split-to-prs` covers the general slicing process.

Every PR in a stack also has to say what the stack *is*, so I can open any one of them and see the whole shape — landed parts included: a `## PR stack` outline listing the chain and marking where that PR sits, plus the merge-mechanism and dependency checklist items. Never hand-write the outline — `pr-stack-section --apply <pr>` generates it into every PR in the chain at once, and re-running it after anything that reshapes the stack is how it stays true. Run it when you **open** a stack and not just when you land one: the shape comes from base refs, a merge destroys them, and the block's own record of the tree is the only thing that survives that — so a stack that was never `--apply`d while it was intact has no history to show afterwards. The `pr-body-rules` skill is the single source of truth for both the outline and the checklist items; the stack skills point there rather than restating them.

## Code comments

Default to no code comments at all. Most commits you make will not contain any new code comments. Most comments agents add are noise: narration, restating what the code already says, or explaining the diff. Or they're full of jargon that make them useless anyway. Make the code self-evident through names, types, and structure first, and put context, motivation, and trade-offs in the PR body — git blame walks a curious reader back to the commit and PR from there. If a comment is truly warranted, you are allowed. Save comments for the rare thing the code genuinely can't say: something non-obvious, a workaround for an external bug, a decision that looks wrong without context.

The exceptions are an escape hatch, not a menu. The way this rule actually fails is comment by comment: each one gets justified as an "invariant" or "looks wrong without context", and the diff ends up with five. So budget as well as classify — a modest diff with more than one new comment means you're rationalizing; re-review each and cut. Three tells you've crossed the line: the same comment pasted at two call sites (state the fact once where the decision lives, or encode it in a name instead), any comment in a test (the test name is the comment — don't annotate fixtures or assertions), and a comment that runs past one sentence (the overflow belongs in the PR body).

When a comment does earn its place, use simple plain language above all else. I cannot emphasize that enough. Write it as one short sentence a teammate would say out loud — no jargon, no stacked identifiers, no formal register. If it takes a re-read to parse, rewrite it or cut it.

If I explicitly ask for a comment or doc-comment in a specific place, write exactly what I asked for — don't take it as license to comment elsewhere.

This governs what you _add_. Never delete or rewrite existing comments just to satisfy this rule (see "Scope of changes") — leave them as they are.

## Commit messages

One to two lines. The subject line is the headline; an optional second line adds the one piece of context that wouldn't fit. Anything longer belongs in the PR body — the commit points readers there, not the other way around.

## Say whether `#123` is a PR or an issue

GitHub numbers issues and pull requests in one sequence, so `#123` on its own doesn't say which one it is. `Fixed by #76` reads the same either way and I have to click to find out — and it comes up constantly, because an issue filed minutes after a PR gets the very next number. So put the type in front, on the first mention of each number: `PR #76`, `issue #75`. It's one word, and it holds up in a chat reply, a PR body, an issue comment or a commit message. Once a passage has established which is which, a bare `#76` further down is fine.

A link doesn't cover it on its own — the URL says `/pull/76`, but what the reader sees is the link text, so the word goes in there too: `[PR #76](url)`. A bare full URL already says it, so leave those alone. A cross-repo reference needs the same word: `PR substackinc/substack#72763`.

## Force-pushing: don't wipe a reviewer's diff

Once a branch is pushed and might have been looked at — by me or anyone — make further changes as **new commits** followed by a plain `git push`. Do **not** `git commit --amend` or rebase-squash and then force-push a branch under review: it destroys GitHub's "changes since you last reviewed", so no one can see what actually moved between rounds. A tidy single commit is a **pre-merge** goal, not a mid-review one — squash only at the very end, when I ask or right before merge (the `tidy-commits` skill).

Force-pushing is legitimate in two cases: rebasing a stacked child after its parent's commit changed, and rebasing a branch onto a newer `master`. Do those through the stack skills (`merge-stack` / `refresh-stack`), which rebase and push via the `restack` script; even then, don't cascade it — batch restacks so a child isn't force-pushed for every small parent edit — and **name the branches you force-pushed and why** in your reply, never silently. For a genuine one-off no skill covers, surface it to me rather than force-pushing on your own. A `beforeShellExecution` hook (`guard-force-push.sh`) enforces this: a hand-typed `git push --force`/`--force-with-lease`/`-f` is denied. If it blocks you mid-review, that's the guardrail — add a follow-up commit instead of routing around it.

## Editing a PR body: don't wipe my edits

I rewrite PR bodies in the browser constantly, often while you're mid-task, and `gh pr edit --body` replaces the whole body with no conflict detection — we both write as `jclaw`, so GitHub warns neither of us and the loss is silent. So every write starts from a body you fetched **just now**, and applies your change as a surgical edit to that text: replace the one line, the one section, the one checkbox. Never send a body you rendered from your own draft or from a copy fetched earlier in the session — that's what turns "tick the test-plan box" into "revert my rewrite". The risk peaks right after you've asked me to drag-drop screenshots, since you've just sent me to the pencil yourself.

If you do clobber something, GitHub keeps every revision: recover it and re-apply your change on top of mine rather than asking me to retype, and tell me what you restored. The `pr-body-rules` skill is the single source of truth here — read it before any body write; it has the discipline in full, the recovery query, and that query's non-obvious gotchas.

A `beforeShellExecution` hook (`guard-pr-body-clobber.sh`) enforces this by supplying the compare-and-swap GitHub lacks: it snapshots the body whenever you read one, and denies a `gh pr edit --body` when you never read it or when the live body no longer matches your snapshot. It judges only staleness, never your new text, so a deliberate "tighten this body" rewrite passes untouched. If it denies you, refetch and re-apply onto my version — that's the guardrail catching a clobber, not something to route around.

## Scope of changes

Touch only what the change requires. When moving or rewriting code, preserve the existing inline comments — they were written for a reason, and "default to no comment" applies to what you'd add, not what you'd remove. Same for formatting, naming, or structure that's tangential to the change.

## Local checks

After editing code, run the project's lint, typecheck, and test scripts before declaring the work done. Discover them from `package.json` scripts (or the repo's equivalent) — `lint`, `typecheck`, `test`, `check`. If a script doesn't exist, skip it; if one fails, fix it before moving on. Don't lean on CI as your first signal.

**Run the suite in a clean environment before you believe it.** Variables you exported while poking at the code stay exported, and a test that reads one will happily pass on your shell's leftovers instead of its own fixtures — green for a reason that won't survive anyone else running it. Run it once through `env -u` (or a fresh shell) with every variable the code reads unset, and if a test needs one, have the suite set it rather than inheriting it. This has produced a false green twice: once where three assertions were reading a variable a debugging session left behind, and once where installing the tool under test put a file on the default path its own suite then tripped over.

**Keep a probe's variables out of the shell.** When you set a variable just to try something, scope it to that one command: `FOO=1 cmd`, or `(export FOO=1; cmd; other)` for several. A bare `export` outlives the probe in any agent shell that keeps state between calls, and it's how the first of those false greens started.

**"No change in output" is a measurement.** Before telling me a change leaves rendered output, behavior or bundle size unchanged, show it: a render diff, a test that pins it, or the check CI runs. Read the callee before reasoning about the values you pass into it, because its defaults and coercions decide what `null` and `undefined` become. A default parameter applies to `undefined` and not to `null`, which is how an `alt={alt ?? undefined}` "that renders the same" turned every null alt into `alt=""`.

## Never pop a stash you didn't just make

The stash is one stack for the whole repository, shared by every worktree and every agent in it. `git stash` with nothing to save prints "No local changes to save" and exits 0, so `git stash && <check> && git stash pop` then pops whatever was on top, which is somebody else's work landing in your tree. A plain `git stash pop` later in the session has the same problem whenever anyone has stashed since.

To check something against a clean tree, prefer a throwaway worktree (`git worktree add --detach <dir> HEAD`), which leaves the stack alone. When you do need the stash, name the entry and pop only that one, and only if it exists. Look it up right before the pop, since its index moves whenever anyone stashes, and run the whole block in one shell invocation, since a lost `$msg` finds nothing:

```bash
msg="probe-$$-$(date +%s)"
git stash push -u -m "$msg"
# ...check against the clean tree...
ref="$(git stash list --format='%gd %s' | awk -v m=": $msg" 'substr($0, length($0) - length(m) + 1) == m {print $1; exit}')"
if [ -n "$ref" ]; then git stash pop "$ref"; elif [ -n "${msg:-}" ]; then echo "no stash named $msg: nothing was saved, so pop nothing"; else echo "\$msg was lost: find your probe-<pid>-<epoch> entry in git stash list, confirm it with git stash show -p, and pop that ref; pop nothing if you can't tell it from a peer's"; fi
```

## Don't batch a file write with the command that reads it

Tool calls sent in one parallel batch run concurrently, in no guaranteed order. So a file write and the command that consumes it — `gh pr comment --body-file`, a body check, a commit of the file — never go in the same batch: the consumer can run first and read a missing or stale file, and a guard that inspects the file judges the wrong thing. Send the write, wait for its result, then send the command that reads it. The same holds for any step that must see an earlier step's effect, such as the final edit to a draft before the command that publishes it. This has cost a reply-guard denial on a `--body-file` that wasn't written yet, and a PR body that shipped without its last edit.

## Triaging a red build: compare against the base, job by job

On a branch whose CI is already red — normal on a shared integration branch — "is it green?" is unanswerable, and the useful question is "what's red here that isn't red on my base?". Answer it by diffing the **whole set of failing jobs** against the base branch's own latest build, then treat anything new as yours.

Checking only the one job you expect your diff to touch is how a real regression ships. One logical check is usually split across several CI jobs — a repo's "typecheck" runs once per tsconfig project, and a file can be clean in the project you looked at and broken in another that also compiles it. An unchanged error count in that one job proves nothing about the rest, so compare the sets, not a sample.

## ripgrep's short flags are not grep's

`rg -r` is `--replace`, not `--recursive`, and it takes a value: the rest of its flag cluster, or else the next argument. ripgrep recurses by default, so there is no `-r` to reach for, and either `grep` habit fabricates an answer. `rg -rn <pattern>` prints every match with the matched text replaced by `n`. `rg -nr <pattern> <file>` makes the pattern the replacement and the file name the pattern, so it searches the whole directory for the file name — printing nothing with exit 1, which reads as "no matches", or printing other files' lines with the pattern pasted in. Neither warns you, and `rg -n -r` fails the same way. Never pass `-r` to rg unless you mean `--replace`; use `rg -n`. `rg -E` is `--encoding`, not `--extended-regexp`; it fails loudly, which is the kinder half of the same trap.

To see every match with its whole line, use `rg --vimgrep <pattern>`, which prints one row per match with its column; for surrounding lines, use `-A`/`-B`/`-C`. Never use a fixed-width `rg -o '.{10}<pattern>'`. That window silently drops any match with fewer than ten characters before it on its line, and because ripgrep never emits overlapping matches, it also drops a second match whose window would reach back into the first.

If `rg` output ever looks mangled or comes back unexpectedly empty, suspect your own flags before the machine. There is no rg config on any of my boxes, and `--no-config` fixes nothing.

## The shell is zsh

Agent shells run zsh. Where it hasn't loaded this repo's zshrc (cloud sessions, other machines), zsh's defaults apply: an unmatched glob aborts the whole command, and a word starting with `=` expands to a command's path or fails. So quote globs that might not match (or pass them to `rg -g`), and quote any word starting with `=`. My machines set `NO_NOMATCH` and `NO_EQUALS` in agent shells, but you can't always tell which shell you're in.

Three zsh habits no option turns off. Brace a variable that a colon follows (`git show "${SHA}:path"`), because `$SHA:a…` reads `:a` as a modifier. Give a helper a name that isn't an alias (anything longer than a letter or two): `name() { … }` fails when `name` is an alias, and `function name { … }` defines it but the alias still runs when you call `name`. And don't read `$PIPESTATUS`: it's bash, and in zsh it expands to nothing, so `cmd | grep …; echo "exit=${PIPESTATUS[0]}"` prints `exit=` and proves nothing, and under `set -u` zsh stops with `PIPESTATUS[0]: parameter not set` instead. zsh's own is `${pipestatus[1]}`, lowercase and 1-indexed; simpler is to capture first, `out="$(cmd 2>&1)"; rc=$?`, and grep `$out` afterwards.

## Buildkite: use the `bk` CLI

This environment has the Buildkite CLI (`bk`) installed and authenticated. Whenever you need Buildkite info — build status, failing steps, job logs, annotations, artifacts — reach for `bk` first (e.g. `bk build view`, `bk build list`, `bk job log`, `bk artifacts list`). Don't fall back to hand-rolled REST/GraphQL calls or scraping the web UI. There's no Buildkite MCP connected here, so `bk` isn't just the preferred path, it's the only one — which overrides project docs that say otherwise (e.g. a repo `CLAUDE.md` telling you to use the Buildkite MCP).

**Never conclude you have no Buildkite access.** There's no `BUILDKITE_API_TOKEN` and nothing in `~/.netrc` — `bk` keeps its token in `~/.config/bk.yaml` and reads it itself, so an empty `env | grep -i buildkite` is expected rather than a finding. Don't fall back to GitHub check annotations, a local repro, or asking me for logs; if `bk` itself errors, quote me the error.

Treat your access as **read-only**. Only run commands that read state (`view`, `list`/`ls`, `log`, `download`, `watch`). Never create, cancel, rebuild, retry, unblock, reprioritize, or otherwise mutate anything. If a task seems to require a write, stop and tell me; it's my call to make.

That rule is doing real work for builds and jobs specifically. `write_builds` is the only write scope on the token, so retrying, rebuilding, or cancelling is the one class of mutation that would actually land. Pipelines, agents, clusters, and registries are read-scoped and would fail on their own — don't mistake that for a safety net, and note the `graphql` scope is a write path too, so the rule covers GraphQL and not just the subcommands.

`bk auth status` prints the org, the full scope list, and the token's expiry as JSON, and is itself read-only — check access with it rather than probing with a write. The token covers only the `substack` org and expires on a rolling basis, so a sudden `401` means it needs a fresh `bk auth login`, not a different command.

The flags aren't guessable and aren't consistent between subcommands, so use these verified forms rather than improvising:

```bash
bk build list -p <pipeline> --branch <branch> --limit 1   # newest build on a branch — spell out --branch, `-b` is rejected here
bk build view <number> -p <pipeline>                      # whole build as JSON, including .jobs[] — here `-b` *is* --branch
bk job log <job-uuid> --no-timestamps --no-pager          # job UUID is positional; there is no --job/--build, and -p/-b are deprecated no-ops
```

`build list` and `build view` both emit JSON, so let `jq` do the work — this is the failing-job set the section above tells you to diff:

```bash
bk build view <number> -p <pipeline> | jq -r '.jobs[] | select(.exit_status != 0 and .exit_status != null) | "\(.name)\t\(.id)"'
```

Job logs are full of ANSI colour and docker-compose noise; strip the escapes before grepping, with `| sed 's/\x1b\[[0-9;]*m//g'`.

## Datadog: use the `dog` CLI, and curl for logs

This environment has dogshell installed as `dog`, and it picks up the API and app keys from `~/.dogrc` on its own — nothing to export, no `--api-key` to pass. Reach for it when you need metric names, monitors, events, downtimes, or dashboards. There's no Datadog MCP connected here, so `dog` plus raw API calls are the only paths, which **overrides project docs that say otherwise** — the Substack `CLAUDE.md` says to use a Datadog MCP and its `datadog` skill assumes one exists. Neither is true. (It got there via `uv tool install datadog`, so that's the command if it ever goes missing.)

Treat your access as **read-only**: `search`, `show`, `show_all`, `stream`, `validate`, `can_delete`. Never post, update, delete, mute, or unmute anything. This rule is load-bearing in a way the Buildkite one isn't — the app key carries full write scope, so every destructive verb here would actually land rather than failing on a missing scope. `dog monitor mute_all` silences monitoring org-wide, and `dog metric post` writes junk into real dashboards. If a task looks like it needs a write, stop and tell me; it's my call.

Two gaps will bite you, because the obvious command doesn't do what its name suggests:

- **`dog search query` returns metric _names_ only** — matching identifiers, never values, and never logs. It's for discovering what a metric is called.
- **`dog metric` has exactly one verb, `post`.** There is no way to read a metric's value through the CLI at all. Metric values need `/api/v1/query`, and logs have no `dog` mode whatsoever, so they need `/api/v2/logs/events/search`.

Verified forms — the timestamp handling in particular isn't guessable:

```bash
dog search query "ecs"                            # metric NAMES matching a substring
dog monitor show <monitor-id>
dog monitor show_all
dog event stream $(date -v-7d +%s) $(date +%s)    # unix timestamps, BSD date
dog downtime show_all
dog dashboard show_all
```

`date -v-7d` is the BSD form and the only one that works on this Mac. The repo skill's `date -d '7 days ago'` is GNU and dies with `date: illegal option -- d`.

The app key isn't scoped to every surface, and the failure tells you nothing useful — `ERROR: Failed permission authorization checks`, with no mention of which scope is missing. **`dog hosts` and `dog service_level_objective` both fail this way**, so host inventory and SLO status aren't reachable. Don't debug the syntax when you see that message; it means the key lacks the read scope, so surface it to me instead of hunting for a flag.

Default output is loose TSV; pass `--raw` for JSON and let `jq` do the work:

```bash
dog --raw monitor show_all | jq -r '.[] | select(.overall_state != "OK") | "\(.overall_state)\t\(.name)"'
```

For logs and metric values, read the keys out of `~/.dogrc` and call the API directly. Assign them to variables rather than interpolating inline, and **keep them out of anything you print** — no echoing the key, no `set -x`. Expect Cursor's auto-review to stop a command that reads `~/.dogrc` and calls out to the network, since that shape looks like credential exfiltration; that's a classifier prompt rather than a hook denial, so it's mine to approve: retry once through the approval path, as the finding rule describes. If that brings up no card, don't keep retrying; tell me what you were trying to read. The keys and calls look like this:

```bash
DD_API_KEY="$(rg '^apikey' ~/.dogrc | cut -d= -f2 | tr -d ' ')"
DD_APP_KEY="$(rg '^appkey' ~/.dogrc | cut -d= -f2 | tr -d ' ')"

curl -s -X POST "https://api.datadoghq.com/api/v2/logs/events/search" \
  -H "Content-Type: application/json" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  -d '{"filter":{"query":"service:web status:error","from":"now-1h","to":"now"},
       "sort":"-timestamp","page":{"limit":50}}' \
  | jq -r '.data[] | "\(.attributes.timestamp)\t\(.attributes.service)\t\(.attributes.message)"'

curl -s -G "https://api.datadoghq.com/api/v1/query" \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  --data-urlencode "from=$(date -v-1H +%s)" --data-urlencode "to=$(date +%s)" \
  --data-urlencode 'query=avg:system.cpu.user{*}'
```

The account is on the US site, so the default `--api_host` is right and there's no region flag to pass. The query-syntax half of the Substack `datadog` skill — service names, `@attribute` filters, the `service:cron/<job-name>` convention — is still accurate and worth reading; it's only the CLI-availability and MCP claims that are wrong.

## Linear: use the GraphQL API, not an MCP

Substack tracks work in Linear, and `LINEAR_API_KEY` is already in the shell from `~/.config/secrets/env.zsh` — nothing to export, no flag to pass. Reach for it when you need a ticket's intent, its parent chain, or to file a finding.

**There is no Linear MCP connected here**, and four skills say otherwise under three different names: `build-from-linear` and `product-problem-statement` want `mcp__claude_ai_Linear__*`, `create-pr` wants `plugin-linear-linear`, and Substack's `deep-review` just says "the Linear MCP". None of them exist in Cursor, so the API isn't the preferred path, it's the only one — which **overrides those docs**. Never conclude you have no Linear access; an empty tool catalog is what this setup looks like, not a finding.

Treat the key the way you treat the Datadog one, and for the same reason: it's a personal API key, so it acts as me with full write on everything I can reach, and nothing fails closed. Reads are always fine. The only sanctioned writes are **filing a finding and commenting on one**. Never edit, close, reassign, re-prioritize, move, or relabel an existing ticket — mine or anyone else's — and never do anything in bulk. If a task looks like it needs more than that, stop and tell me.

Every call is the same POST, so define the helper once and let `jq` build the payload — hand-escaping a GraphQL query into JSON is where this goes wrong:

```bash
lin() {
  local out
  out="$(curl -sS --fail-with-body -X POST https://api.linear.app/graphql \
    -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" \
    --data "$(jq -nc --arg q "$1" --argjson v "${2:-"{}"}" '{query:$q,variables:$v}')")" \
    || { printf 'lin: %s\n' "$out" >&2; return 1; }
  jq -e '.data and ((.errors // []) | length == 0)' >/dev/null <<<"$out" \
    || { printf 'lin: %s\n' "$out" >&2; return 1; }
  printf '%s\n' "$out"
}

# a ticket and its parent chain — the trail deep-review wants to walk
lin 'query { issue(id:"SPON-476") { identifier title description state{name} parent{identifier title} } }'

# search before filing, so a repeat becomes a second sighting rather than a duplicate
lin 'query { searchIssues(term:"perk abuse redemption", first:5) { nodes { identifier title state{name} } } }'

# file a finding on SPON, assigned to me and labelled ai:draft: the title and
# description are read from files into variables, so neither is escaped into
# GraphQL nor sits in the command line
ids="$(lin 'query { team(id:"SPON") { id } viewer { id } issueLabels(filter:{name:{eq:"ai:draft"}}) { nodes { id } } }')" &&
vars="$(jq -c --rawfile title /tmp/title.txt --rawfile body /tmp/finding.md '{input:{
  teamId: .data.team.id, assigneeId: .data.viewer.id,
  labelIds: [.data.issueLabels.nodes[0].id // error("no ai:draft label")],
  title: ($title | rtrimstr("\n")), description: $body}}' <<<"$ids")" &&
lin 'mutation($input: IssueCreateInput!) { issueCreate(input:$input) { success issue { identifier url } } }' "$vars"
```

**The helper fails loudly on purpose, because a quiet failure reads as permission.** A plain `curl -s` blocked by a sandbox prints nothing, the `jq` it's piped into prints nothing and exits 0, and an empty dedupe search is exactly the answer that authorizes filing. So the helper prints the curl error or GraphQL error to stderr and returns 1. Read that, and act on an empty result only after `lin` itself succeeded. A pipe loses its return code, so capture first: `r="$(lin '…')" && jq -r '…' <<<"$r"`. When it reports a connection failure, re-run with unrestricted network.

Expect auto-review to stop `lin` for the same reason it stops the Datadog calls: it reads a credential and posts to an external host. Moving the query into a script doesn't help, since that was refused too. That's mine to approve: retry once through the approval path, as the finding rule describes. If that brings up no card, don't retry further. For a write, or a dedupe search a write depends on, use the refused-write fallback in the finding rule; for any other read, tell me what you were trying to read.

`team(id:"SPON")` takes the team key rather than a UUID, so resolve ids by key instead of pasting them in. The `ai:draft` label is workspace-wide (its `team` is null), so one lookup works from any team.

## Screenshots via the Cursor browser MCP

This is the local-capture path — Substack, or a repo with no deploy previews. Everywhere else the shots come from the preview deployment.

When you capture screenshots through the `cursor-ide-browser` MCP (CDP under the hood), these things bite repeatedly:

- `Emulation.setDeviceMetricsOverride` (the viewport/width override) **resets on navigation** — reapply it _after_ each `browser_navigate`, then confirm with `window.innerWidth` before capturing.
- `browser_take_screenshot` with `fullPage` **clips horizontally** when the emulated width is wider than the webview's physical panel. For a complete grab, clear the override (native width) or emulate a width no larger than the panel — don't emulate a desktop width and expect the whole page.
- Page content often scrolls in an **inner container**, not the window, so `window.scrollTo` does nothing. Use `browser_scroll` (direction + amount, or a `ref` with `scrollIntoView`).
- The tab is a **single shared surface** — your own later navigation, or a concurrent agent, can clobber its cookie jar — so a capture that depends on being logged in as a specific user is fragile through it. For authed / session-dependent shots, drive an **isolated browser you launch** (e.g. headless Playwright) with the session cookie injected, rather than the shared tab.

Whenever you save screenshots as deliverables (any screenshot the user will want to see or use — PR evidence, before/after shots, UI verification), save them into **their own folder under `/tmp`** (one folder per task/batch, e.g. `/tmp/<task-name>-screenshots/`), and when you're done capturing, **reveal that folder in Finder** with `open <folder>` — in addition to embedding the images in the chat. Do this every time without being asked. One folder reveal at the end beats per-file reveals.

## Launching your own browser: never mine

When you drive Playwright yourself, launch its **bundled Chromium, headless** — a plain `chromium.launch()`. Never pass `channel: 'chrome'` (or `'msedge'`), and never `headless: false`. Together those run the real Google Chrome out of `/Applications` and put windows on my screen that take focus, which reads as an agent hijacking my browser. The profile is a throwaway temp dir so my cookies and logins aren't exposed, but I still don't want the windows.

An animated canvas is not a reason to go headed. Bundled Chromium headless does WebGL with hardware acceleration — verified `ANGLE (Apple, Apple M5 Max, OpenGL 4.1)`, drawing correctly with no extra flags.

If Playwright tells you `Executable doesn't exist … run npx playwright install`, **don't switch channels to work around it.** Check `PLAYWRIGHT_BROWSERS_PATH` first: Cursor's sandbox injects a path inside an ephemeral `cursor-sandbox-cache` directory that is usually already deleted, while the real cache at `~/Library/Caches/ms-playwright` is fully populated. The `pin-playwright-browsers-path.sh` hook pins this for any JS-running command, so you shouldn't see it — if you somehow do, re-run with `env -u PLAYWRIGHT_BROWSERS_PATH`.

In a Substack slot, require `@playwright/test`, not `playwright`. Only `@playwright/test` is linked into the warmed tree's `apps/substack/node_modules`, so `require('playwright')` fails with `Cannot find module`, and `require('@playwright/test')` exports the same `chromium`. The pinning hook runs in Claude Code through the same adapter, but expect a Claude Code launch to need the Bash sandbox turned off.

One shared browser cache is right, and pool slots can record **concurrently** off it: the binaries are read-only and every `launch()` mints its own `--user-data-dir`. Don't install per-slot copies, and don't treat a shared cache as a concurrency problem.

For **video** of a web flow, the repo skill takes precedence — `.claude/skills/web-ui-test-video/SKILL.md` records the run on Buildkite and hands back an artifact. Local recording is a fallback, not the default.

## local-config: branch work goes in a worktree

Applies only in my local-config repo — the dotfiles clone whose `setup.zsh` owns `~/.zshrc`, `~/.agents`, and `~/.local/bin`. Ignore this section in any other repo.

The main checkout is the live config, not a workspace: every one of those `$HOME` symlinks resolves into it, so taking it off `main` silently swaps the shell, git, and agent config of every session on the machine — including the one you're running in. Make a worktree before you touch a branch:

```bash
WT="$(local-config-worktree jackson/<branch>)"
```

It prints the path and nothing else, so capture it. The worktree is cut from a fresh `origin/main`, or checks out the branch when it already exists locally or on origin, and asking twice hands back the same path. To review or address an open PR, use `local-config-worktree --review <pr>` instead: it checks out the PR's exact head on `review/pr-<pr>` rather than whichever local branch shares its name, and `deep-review-orchestrate` says how to push from it. Branch-name mode is for authoring. Everything after that is plain git: work with `git -C "$WT"` and absolute file paths, commit, push, and open the PR from there, and clean up from the root with `git worktree remove "$WT"` and `git branch -d <branch>` (`-D` for a `review/pr-<pr>` branch, which a squash merge leaves looking unmerged). Creating is the only step with a wrapper, because from the root git raises the same ref transaction for `worktree add -b` as it does for `checkout -b` and no hook can tell them apart.

Committing straight to `main` in the root is fine when I ask for it: a docs typo, a skill tweak I want live in the next shell. What's blocked is moving the root off `main` — `git checkout -b`, `git branch`, detaching, stashing, rewinding `main`, and on git 2.46+ `git switch <branch>` as well. That's a git `reference-transaction` hook rather than a Cursor hook, so it holds whatever tool runs the command. If it fires, it means you skipped the worktree: go make one. Don't retry, and don't reach for `LOCAL_CONFIG_ROOT_OK=1` — that's for root maintenance I explicitly asked for, and `local-config-worktree`'s own use of it isn't precedent for yours.

Three things about being blocked that you won't guess:

- **Never `git reset --hard` in the root.** It is the one command that gets past the guard, because git rewrites the working tree *before* it consults the hook. A refused reset still discards your uncommitted work, and a reset onto a commit old enough to predate the guard deletes the hook itself on the way — after which nothing is watching at all. Nothing can block this from inside git; it's on you. If you need the root back to a known state, `LOCAL_CONFIG_ROOT_OK=1 git -C <root> reset --hard origin/main` moves forward, which is safe.
- **A refusal can still leave the root part-way through something.** The tree is written before the ref is, so a denial can land with files already changed. Run `git -C <root> status` after any denial and clean up before you walk away — this is the machine's live config, not a scratch checkout.
- **If you already have uncommitted work sitting in the root, move it; don't commit it.** Committing to `main` is the one thing still open to you and it publishes to every shell on the machine. Make the worktree, carry the changes across, then clear the root with the override — this is root maintenance, which is what it's for:

  ```bash
  git -C <root> add -A &&
    git -C <root> diff --cached --binary | git -C "$WT" apply --3way &&
    LOCAL_CONFIG_ROOT_OK=1 git -C <root> stash -u
  ```

  Chained on purpose: the `stash` must not run and clear the root unless the apply succeeded. `--cached --binary` after `add -A`, never a plain `diff`: a plain one omits every file you created, and without `--binary` a single binary file fails the whole patch. `--3way` is what makes it work in the usual case — the patch is against the root's `HEAD` while the worktree was cut from a fresh `origin/main`, so whenever the root is behind (its normal state, which is why `ff-local-config-main` exists) a straight apply fails on any file both commits touch. The stash keeps a copy until you've checked the worktree.
- **On git older than 2.46 the block fires after the move.** Switching to a branch that already exists locally raises no ref transaction at all — that's the Pi and the Pop!_OS desktop — so `post-checkout` reports the move and makes the command fail only after HEAD has changed. Put the root back with `LOCAL_CONFIG_ROOT_OK=1 git checkout main`, and don't assume a non-zero exit means nothing happened.

**A failed `--3way` apply is not all-or-nothing.** It lands what it can and leaves the rest conflicted, so on a non-zero exit the worktree may hold some of your files plus `<<<<<<<` markers in others — and because `--3way` implies `--index`, what does land arrives staged. The root still has everything, so nothing is lost; the worktree is what needs clearing before you retry. Reset it (`git -C "$WT" reset --hard && git -C "$WT" clean -fd`), fast-forward the root, and run the chain again. Don't try to fast-forward first — the root is still dirty at that point and the merge will refuse.

`.worktrees/` is gitignored *and* dot-hidden, so Cursor's Grep, Glob and codebase search report "No matches found" for files inside a worktree instead of erroring — and a bare shell `rg` finds nothing there either, for the same two reasons. Read works. To search a worktree from the root you need `rg -uu <pattern>`, or an explicit path (`rg <pattern> "$WT"`). Treat any miss under `.worktrees/` as "I didn't look". The same goes for `.claude/worktrees/`, which is gitignored and dot-hidden too and is where Cursor's own agent worktrees land.

## Substack: claim a worktree slot, keep root on master

Applies only in my Substack agent clone — origin `substack`, checkout directory `substack-ai`. Ignore this section in any other repo.

Everything this section names is prefixed `substack-`, and that prefix is load-bearing: a `substack-slot-*` command, a `substack-*` hook, or the `substack-claim-worktree` skill only makes sense in that clone. The pool commands hardcode `apps/substack`, that repo's build artifacts, and its `monograph` databases, so pointing one at another repo is a mistake rather than a configuration.

Never commit agent plan documents to the Substack repo. Keep plans in chat or outside the checkout, and remove any generated plan file before committing.

The root checkout is a clean reference, not a workspace. A `sessionStart` hook switches it to `master`, fetches `origin/master`, and fast-forwards `master` to it when the root is clean; the prompt-time refresh only fetches. Don't commit, branch, or make code edits directly on the root.

Before making any code change, claim a pool slot via the `substack-claim-worktree` skill. Don't call `move_agent_to_root` — the root is always on master, so its `git checkout master` migration collides and hangs. Operate on the slot with `git -C <slot>` and absolute file paths; the session root staying on the host clone is purely cosmetic.

If a write to the root checkout is ever blocked, that's the guardrail working — **don't retry the same write**, and don't look for a way around it. Treat the block as the signal that you skipped claiming a slot: go claim one and redo the write there.

**Two switches get past the veto, so read the message rather than the exit code.** On git older than 2.46, switching to a branch that already exists raises no ref transaction at all, so `reference-transaction` never gets a say. On any git, switching to a `pool/*` parking branch is allowed on purpose, because `git worktree add` writes a new slot's HEAD with an identical transaction line and the two can't be told apart. Either way the root really does move. A `post-checkout` hook catches it immediately after: the `git checkout` still fails, but it failed *after* the fact, so the root is now on the wrong branch. Put it back with `SUBSTACK_ROOT_OK=1 git checkout master` — which the message tells you — and then go claim a slot. Don't assume a non-zero exit means nothing happened.

The single exception is root **maintenance I explicitly asked for** — stashing leftovers, resetting to master, fast-forwarding it. Re-run that one command with a `SUBSTACK_ROOT_OK=1` prefix, which both the shell hook and the root's git hooks accept, and say that you used it. It is never a way to get your own work into the root, and asking me leading questions to manufacture the permission is worse than the block: if I didn't ask for the maintenance, the block stands and the slot is your answer. Tracked uncommitted changes still freeze the fast-forward; untracked junk (a `.pnpm-store/` from a sandboxed install, `.DS_Store`) does not. An untracked file that isn't gitignored can, once `master` starts tracking the same path: git refuses the fast-forward and the next session start reports why. The sessionStart hook will tell you when the root is frozen — surface that to me rather than clearing the files yourself.

The pool size is mine to set, not yours — **never grow it on your own** (`substack-slot-setup`/`POOL_SIZE`). When `substack-slot-claim` reports the pool exhausted, trust it (see `substack-slot-status` / `substack-slot-lib.sh` — do not second-guess with ad-hoc git checks). Never `git switch -C` or `substack-slot-park --force`/`--steal-live` over a peer's slot.

A failed claim comes in several shapes, and they want different things from you. If it prints a list of slots under "their sessions have gone quiet", those hold only recoverable work — **show me that list and ask which to free**, then take the one I name with `substack-slot-claim --approved agent-N`. Never pick for me. If it prints a list under "could not be assessed", the scan gave up on those slots and nothing is known about what they hold — surface them to me too, but don't offer them as something an approval can take, and don't go poking at one to find out. If it exits **69** and prints a list under "gh did not answer for them", nothing is known about any of them: the GitHub API was unreachable, which is what Cursor's agent sandbox does to `api.github.com` — and `gh auth status` passes anyway, so a green auth check proves nothing here. **Re-run the claim with full network access**, which is yours to do; don't report a full pool, because the pool was never assessed. Exit 69 has a second cause: a list under "git could not list origin's branches" means gh answered but git could not read origin, so nothing is known about whether those slots' commits were pushed. Re-run with full network access for that one too, and don't report a full pool. If it prints a list under "another session's live reservation", those slots are clean and only another active session's reservation holds them: show me the list and ask before taking one with `substack-slot-park --steal-live agent-N`, then run `substack-slot-claim --approved agent-N` to reserve it, and don't report a full pool. Only a bare "every slot holds live work" with no list after it means the pool is full: say so and stop. Details: `substack-claim-worktree` skill.

If a slot you've claimed ever shows working-tree changes you didn't make, **stop**: they're almost certainly another agent's in-flight work (reappearing third-party edits = a live agent still writing to that slot). Don't `git restore`/`reset`/`checkout` them away or `git add` them — surface it to me.

Read-only or question-only sessions don't need a worktree.

### Reading code: the searchable tree is the stale one

Two traps that compound into a silent wrong answer, so know them before you go looking for code.

**The root can be stale.** Local `master` moves whenever any session starts with the root clean, so it can change under a running session, and between session starts it lags origin. Tracked leftovers stop the session-start fetch and fast-forward, while the prompt-time hook still refreshes the remote ref; the session-start hook reports their classification in context. Code you read in the root can still predate work that merged on origin, so a symbol you can't find there may well exist on master.

**The slot is invisible to search.** The pool lives under `apps/substack/.cursor/`, which is gitignored, so Cursor's Grep, Glob and codebase search report "No matches found" for files inside a slot instead of erroring. Read works there, and so does shell `rg`.

So when the question is about the branch you're working on, read the slot by absolute path and search it with shell `rg`, never Grep. Treat a Grep miss under a slot as "I didn't look", not "it isn't there". Before concluding anything about master from the root, check how far back it is with `git rev-list --count HEAD..origin/master`.

### Running the app: use the agent-dev tooling

When a task needs the app actually running (manual QA, reproducing a runtime bug, hitting an endpoint), don't start a bare `npm run dev` — start the slot's **isolated** dev server via the `agent-dev` tooling (`~/src/agent-dev/agent-dev.sh`), which gives the slot its own port/db/DynamoDB/Redis so it never collides with my personal stack or another slot. Follow the `substack-claim-worktree` skill's "Run the app" section for the flow — including how to launch it (managed background job, not `&`), the boot gotchas for cold one-off worktrees, and how to log in. Most code/test tasks don't need a running server — skip it then.

**Logging in to the local app:** never form-fill credentials in the browser or navigate to a magic-link/token URL — both trip auto-review (the token-URL block fires approval prompts with no visible UI). Use the email-OTP-from-server-log or seed-password API paths instead; recipes are in the skill's "Log in to the running app" section.

### Never reset the local dev database

NEVER run any command that drops or recreates the local dev databases. `scripts/dev/reset-local-dbs.sh` calls `dropdb`/`createdb` against the **hardcoded** `monograph_dev` and `monograph_generated_dev` regardless of any `DATABASE_URL_DEV` override, so it silently wipes my real local data and every publication in it. This includes `npm run reset-local-db`, `npm run drop-and-recreate-dev-db`, `npm run reset-test-db`, the script itself, and the full Playwright harness (`scripts/test/playwright.sh`, which runs `reset-local-db`). Raw `dropdb`/`createdb` of `monograph_dev` / `monograph_generated_dev` is equally off-limits. Use the slot's isolated db (agent-dev tooling) instead — never the shared dev db.

A `beforeShellExecution` hook (`substack-block-dev-db-reset.sh`) enforces this by denying those commands; if it blocks you, that's the guardrail working — don't retry or route around it. It tries to match real _invocations_ rather than the words, but only partially: it strips quoted strings when the command's leading program is in a carrier list (`git`, `rg`, `echo`, `cat` and friends) and scans everything else raw. `cd` is not a carrier, so a `cd … && …` compound that merely mentions a trigger token inside a quoted argument is denied anyway — reword it rather than retrying. Meanwhile `bash -c "dropdb monograph_dev"` and a destructive command chained after a benign one are still denied. Worktree copies (`monograph_dev_wt*`) and using `monograph_dev` as a `--template` source also stay allowed. If a real reset is genuinely needed, stop and tell me — it's my decision to make in my own terminal.

The `agent-dev` tooling is itself fail-closed: `agent-db.sh` runs an `assert_isolated` check before any drop/create/migrate/seed and refuses unless the slot name _and_ the knex `DATABASE_URL_DEV`/`GENERATED_DATABASE_URL_DEV` all point at this slot's `monograph_dev_wtN` db — so a missing/half-applied isolation env can never let it fall back to `monograph_dev`.

### Formatting: run format-write-changed before committing

Before every `git commit` in the Substack repo, run `npm run format-write-changed` to auto-apply lint/style fixes to your uncommitted changes. It only touches unstaged working-tree files, so run it before `git add`. It also skips **untracked** files, because it lists files with `git diff`, and `git add -u` skips them too. So a new file reaches CI unlinted unless you mark it first: `git add -N <new files>` (intent-to-add) before the format step puts it in both lists. The hook clears a commit only for `format-write-changed`, `format-write-branch` or `format.sh --write`; `npm run format-write <file>` formats just the files named and does not clear it. The `substack-format-before-commit` hook enforces this and **only clears when the format step is in the same command as the commit** — so chain them, and run from your **slot's** `apps/substack`, never the root checkout (a leading `cd` into the root trips root-protection):

```bash
cd "$SLOT/apps/substack" && npm run format-write-changed && git add -u && git commit -m ...
# with new files:
cd "$SLOT/apps/substack" && git add -N test/frontend/new_spec.tsx && npm run format-write-changed && git add -u && git commit -m ...
```

For changes already committed on the branch, use `npm run format-write-branch`. This keeps formatting out of CI and off the diff.

### Running tests: ALWAYS use stest

ALWAYS run tests through `stest` in the Substack repo — every test run, no exceptions: a single file, a directory, frontend or backend. NEVER invoke `mocha`, `npx mocha`, `npm run test`, or `npm run test:frontend` directly. `stest` sets up the env the suite expects (this worktree's own test databases, `NODE_ENV=test`, the test DynamoDB endpoint); any other invocation silently runs in the wrong environment and produces misleading failures. It adds no Node loader flags: the runners moved to `tsx`, so a test that fails because it stubs an imported module's namespace gets moved to `proxyquire` or dependency injection, not a flag. If you break this rule I will be fired by my company.

**How to invoke it:** `stest` is a shell **function** already loaded in your (even non-interactive) shell, not a binary — so just run `stest <path> [-g '<name>']`. Do **not** `npx stest` (that installs an unrelated public package), and don't conclude it's unavailable and fall back to `npm run test`. The function uses paths relative to `apps/substack`, so run it from there — in a worktree that means `cd "$SLOT/apps/substack" && stest test/…`. Running it from the slot root fails with confusing missing-file errors, not because `stest` is missing.

Write new frontend tests in TypeScript (`.ts` or `.tsx`). CI rejects new `.js` and `.jsx` test files.

This isn't just about misleading failures — a direct `mocha` run **wipes the personal `monograph_dev`**. `db/knex-writer.ts` resolves its environment from `PLAYWRIGHT_ENV || NODE_ENV || 'development'` at module-load, and `NODE_ENV=test` is set only as a side effect of loading `@/test`. Many test files import a model/DAL before `@/test` (e.g. `test/api/subscriber_perks/test_public_listing.ts` imports `@/dal/subscriber_perks` before `@/test`), so under bare `mocha` knex-writer evaluates in `development` → `DATABASE_URL_DEV || { database: 'monograph_dev' }`. In a pool-slot shell `DATABASE_URL_DEV` is unset, so it lands on the personal `monograph_dev`, and `test/index.js`'s once-per-suite bootstrap then wipes + reseeds it with test-factory data. `stest` avoids this by loading `test/index.js` as a setup file first (so `NODE_ENV=test` is set before any model loads → `monograph_test`). A `beforeShellExecution` hook (`substack-block-unsafe-mocha.sh`) enforces this by denying direct `mocha`/`npx mocha` invocations that don't set `NODE_ENV=test`; if it blocks you, use `stest` (or prepend `NODE_ENV=test`).

As defense-in-depth for _every_ dev-env path (not just bare mocha — also `knex migrate`/`seed`, ad-hoc scripts, anything that resolves `NODE_ENV=development`), a second `beforeShellExecution` hook (`substack-inject-slot-dev-db-env.sh`) rewrites any command scoped to **any** worktree under the worktree home (`apps/substack/.cursor/worktrees/<name>/…`, pool slots and one-offs alike, whether named in the command or your cwd) to prepend the four per-worktree database URLs — `DATABASE_URL_DEV` and `GENERATED_DATABASE_URL_DEV`, plus `DATABASE_URL_TEST` and `GENERATED_DATABASE_URL_TEST` — the same per-slot disposable dbs `agent-env.sh` would export. So when `DATABASE_URL_DEV` would otherwise be unset, knex-writer's `development` fallback lands on the slot's throwaway `monograph_dev_wtN` instead of the personal `monograph_dev`. It only ever injects a `wtN` db (never the bare personal db), respects any of the four you set yourself (checked per pair — pinning either dev URL leaves the whole dev pair alone, and the test pair is still injected), and blocks only a database command whose `cd` target is a shell variable it can't read, because hooks see the command text rather than your shell's variables — write the slot path out. Otherwise you won't see it, but it's why a stray dev-env command in a slot can no longer wipe my real data.

Each worktree gets its **own test databases**, so `stest` no longer shares one `monograph_test` with every other worktree and with my own checkout. The `stest` wrapper derives the worktree's slot from the path (under the worktree home, or nothing at all), exports `DATABASE_URL_TEST`/`GENERATED_DATABASE_URL_TEST` for `monograph_test_wtN`, and runs `agent-db.sh ensure-test` first, which copies a master-pinned template and rebuilds the pair if it has drifted ahead of the branch. Five consequences worth knowing:

- **A refusal from `ensure-test` is information, not an obstacle** — read the message, because it says which refusal it is. The two you'll actually hit: "template is not ready" means nobody has built it yet, so run `agent-db.sh test-template` from the master checkout; "still ahead" means the branch is older than the template, so rebase — re-running won't help, and copying can't fix it. On an active stack, where a rebase would force-push every child, use a throwaway pair instead (below). It also refuses if you're outside the worktree home, if its isolation check fails, or if it gives up waiting for the lock, and those read differently.
- **A throwaway pair runs a stale branch without rebasing.** Create two empty databases, pin both test URLs on the `stest` call, and drop them when you're done. `stest` skips `ensure-test` when you set both URLs yourself, the injection hook leaves a pair you set alone, and the suite migrates the empty databases from scratch. Pin both or neither: `stest` refuses one alone, because the other would land on the shared database. Keep `monograph` out of the names, so they can't be mistaken for the databases this section protects. Each name also needs `test` as its own `_`-separated part, because the test bootstrap refuses any database without one. That's why the names below end in `_test`, and why a name like `stest_scratch_mybranch` fails, since its `test` is buried inside `stest`:

  ```bash
  cd "$SLOT/apps/substack" && createdb mybranch_scratch_test && createdb mybranch_scratch_generated_test
  cd "$SLOT/apps/substack" && DATABASE_URL_TEST=postgresql:///mybranch_scratch_test GENERATED_DATABASE_URL_TEST=postgresql:///mybranch_scratch_generated_test stest test/api/test_example.ts
  dropdb mybranch_scratch_test && dropdb mybranch_scratch_generated_test
  ```
- **Run tests from inside a worktree.** From my own `~/src/substack` checkout the wrapper deliberately sets nothing and the canonical `monograph_test` is used, exactly as before.
- **A `stest` that seems to hang is probably queueing, not stuck.** `ensure-test` holds one machine-wide lock for its whole run, so two slots testing at once go one after the other, and a slot that arrives while the template is being built waits for that build. Give it a few minutes before assuming something is wrong. A shell that can't write `~/.substack-agent` (a sandboxed Cursor shell) makes `stest` refuse up front instead; rerun with `required_permissions: ["all"]`, and in Cursor request that up front, including for compound commands that only end in `stest`. A hang without that refusal is a real queue.
- **The two ways this can go wrong are handled differently, on purpose.** When the tooling isn't installed — no `substack-slot-resolve` on `PATH`, no `agent-db.sh`, or one too old to know `ensure-test` — the wrapper says so and then leaves the test URLs exactly as it found them. It doesn't unset them, which matters: the injection hook has usually already pointed them at this worktree's own databases, so the run stays isolated even though nothing was provisioned. Refusing here would just leave `stest` broken with no way forward. But when you *are* inside a worktree and its slot can't be worked out, it refuses to run, because then nobody can name the database this worktree should use and guessing means writing the shared one from inside a worktree — the thing this whole change exists to stop.

**Many backend tests run a prebuilt bundle, not your source.** `api/lib/ssr.ts` loads `web_ssr_rsbuild/email.js` and `main.js`, plus `web-react_ssr_rsbuild/main.js` for routes already off Preact. Every `getSchemaRuntime()` call goes through `web-schema_ssr_rsbuild/schema.js`, and that covers parsing imported HTML and extracting text from post bodies as well as rendering them. Those bundles compile in `frontend/`, `schema/`, and everything they import, `lib/` and `packages/pencraft` included. The slot builds them when it's bootstrapped or reconciled, not when its source changes. So they go stale after you edit any of that code, after you switch to or rebase onto another branch, and whenever bootstrap printed `REGEN failed`, which leaves an older copied build in place. A test that reaches stale code is still running the old build: a mutation probe comes back green and looks like a worthless assertion, and a real fix looks like it did nothing. Rebuild from `apps/substack` with `npm run build:rsbuild` before you trust the result — it builds every environment in about 30 seconds — and again after you restore a mutation. If a test keeps passing under a mutation that should break it, rebuild before you decide the assertion is weak.

### Typechecking: use the fast `tsgo` scripts

To typecheck locally, use the `tsgo` (native Go compiler) npm scripts from `apps/substack`: `npm run typecheck:tsgo:backend`, `npm run typecheck:tsgo:frontend` (also `:test`, `:scripts`, `:admin`, or bare `npm run typecheck:tsgo` for every target). These finish in ~10–15s; a plain `tsc --build ./tsconfig.json` takes minutes — don't reach for it. This also matches CI, which forces `tsgo` for PRs, so a clean local `tsgo` run is the same signal the build will give.

Run them **through `npm run`** — never `./scripts/typecheck.sh …` or a bare `tsc`/`tsgo` directly. Only `npm run` puts `node_modules/.bin` on PATH; a direct call dies with `tsc: No such file or directory`.

A type error in shared backend code (`api/`, `models/`, …) fails the CI `Typecheck backend`, `Typecheck tests`, AND `Typecheck scripts` jobs at once (the test/scripts projects reference the backend project), so `typecheck:tsgo:backend` catches the common case — but run the bare `typecheck:tsgo` (all targets) when you've touched test/scripts files to catch errors that live only there.

Known local-only false positive: `typecheck:tsgo:backend` reports `api/graphql.ts … 'isCustomerSupportMode' does not exist` (TS2339) from a stale generated artifact that CI doesn't have. Don't chase errors in files you didn't touch — focus on the files in your diff. (If a generated-artifact error blocks a file you _did_ change, regenerate with `npm run generate-imports`.)

A second one: `typecheck:tsgo:test` and `:admin` can report TS2339 on `ExperimentsQuery` / `ExperimentQuery` fields in `frontend/admin/tabs/Experiments/*`. That's a stale gitignored `graphql/types/index.ts` that CI regenerates; filter those errors out rather than chasing them, or try regenerating it with `npm run graphql-types`.
