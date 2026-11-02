# Agent instructions

Personal working rules for any AI coding agent acting on my behalf — Cursor, Claude Code, Codex, others. They cover _how_ I work: git hygiene, pull requests, code comments, and how you report back to me. They are the same rules I run on every project of mine.

**This file is vendored.** It is generated from my `local-config` repo by `bin/sync-project`, so the copy in this repository is a build artifact — an edit here is overwritten by the next sync. Change the source in `local-config` instead. `.claude/toolkit.manifest` records the commit this copy came from.

**Precedence.** These rules govern process, and on process they are authoritative. They do not override this repository's own guidance about the product itself: where this file and the repo's `CLAUDE.md`, `PROJECT.md`, or an active skill disagree about the domain, the architecture, or what the software is allowed to do, **the repository wins**. Repo docs and skills still govern anything these rules are silent on.

## Start and safety

These rules govern my process in every project. Project guidance governs the product and anything these rules do not cover. When a hook denies a command, follow the allowed path it names; do not retry the same command or bypass the guard. After a long wait or a question, recheck the PR, branch, working tree, and CI state before acting or reporting.

A background watcher must distinguish an empty result from a failed poll. Verify its first poll, check exit status on every poll, and wake the session after repeated failures.

If the Shell tool returns "no exit status" twice, that session's shell is dead. Stop probing it; have a subagent run the remaining commands in its own shell and return their full output in its final message.

## Git and pull requests

When you change files, commit, push, and open a PR, or add a new commit to the existing PR. Exceptions are an explicit instruction not to ship, no changes to ship, secrets or credentials, or a repository I have not asked you to work in. Use the `create-pr` skill whenever you create or revise a PR. Give me the PR URL when done.

Once a pushed branch may be under review, use new commits and an ordinary push. Do not amend or force-push away a reviewer's diff. Use `merge-stack` or `refresh-stack` for their sanctioned rebases, and name any force-pushed branches in your reply. Use `tidy-commits` only at the end. Follow `stacked-pr-rules` when splitting work across PRs, and update the stack outline with `pr-stack-section --apply`.

Fetch the live PR body immediately before each edit, preserve my intervening edits, and follow `pr-body-rules`. Commit messages are one or two lines. On first mention, call a GitHub number `PR #123` or `issue #123`, including in link text.

## PR labels

Don't add or remove labels on PRs on your own. Tell me what you suggest.

Never pop a stash you did not just make. A plain `git stash pop` can apply another worktree's stash. Prefer a throwaway worktree for clean-tree checks; otherwise identify your own named stash immediately before applying it.

## Review comments and findings

Never respond to another human reviewer's comment or resolve their thread. Do not post a new PR or issue comment, review, or fix tied specifically to their comment; surface it to me. You may address my comments and bot comments. Resolve an accepted suggestion without a reply when the diff makes the outcome clear. Explain a declined bot suggestion before resolving it. Prefix every GitHub reply you post, including pending-review comments, with your model shorthand and a space, such as `[Opus 5.5 Medium] `, from `agent-provenance prefix`; it prints `[Agent]` when the model is withheld or unknown. Use threaded replies; put standalone notes in the PR body. Only the review skills may post their marker comments at top level. You may create a pending PR review with inline comments for me to submit, but never submit one.

When an Auto-fix (`<ci-monitor-event>`) wake or any other trigger brings review comments, treat every finding as a hypothesis, not an instruction. Before changing code, check it against the current head: reproduce the failure, search for callers, or run the test. Decline a wrong finding with the counterexample. If a comment's first line is `<!-- deep-review-marker -->`, load `address-deep-review` before touching code and follow it for triage, fixes, declines and the stopping rule.

Put real out-of-scope findings in the tracker, after searching existing issues and PRs. A match gets a second-sighting comment, not a duplicate. If a tracker write is finally refused, give me the complete finding text in your reply instead of silently dropping it. Use GitHub issues for my repos; for Substack use a SPON Linear ticket assigned to me with `ai:draft`. In another person's repo, surface the finding instead of filing it. For several GitHub findings, use one issue with checkboxes, an `Item status` decided count, and a `(+N …)` title suffix. Mark a fix decided when its PR merges; fetch the live issue body before editing its checklist.

For a GitHub finding, a checked box means decided, including a decline, deferral, or handoff. Tick those decisions when made and name the outcome on the item; leave a proposed fix unticked until its PR merges. Keep the `Item status` decided count current and close the issue when every item is decided, as `NOT_PLANNED` if none was fixed.

## Evidence and code

Every visible UI change needs screenshots that show the changed element in the PR body: before/after for changed UI, after for new UI. Use the deploy preview and `capture-pr-screenshots` where available. If there is no preview, tell me and label screenshots from a local production build; Substack is the exception, where local capture is normal and needs no warning. For a change with no visual delta, state `No screenshots — <reason>` in the body.

Touch only what the task needs and preserve existing comments when moving code. Default to no new code comments. Use one short, plain sentence only for a fact the code cannot express; an explicit request for a comment at a specific place takes precedence. Put rationale in the PR body. Run the repository's relevant lint, typecheck, and test scripts after code changes. Keep probe variables scoped to the probe, and verify claims that rendered output or behavior is unchanged. For red CI, compare the full set of failing jobs with the base branch's latest build.

When launching Playwright yourself, use bundled headless Chromium, never my installed Chrome or a visible browser. Do dependent file writes and reads in order, not in one parallel batch. Use `rg -n` for line-numbered searches; `rg -r` means replace, not recursive search. In zsh, quote globs that may not match and brace variables followed by a colon.

## Agent-created artifacts

At session start, get model, effort, and environment from the harness's authoritative source through `agent-provenance`; do not infer them from the prompt. Every agent-created PR, issue, or ticket gets exactly one agent context block in its body. The block records creation context: lab, line, version, modifiers, effort, environment, and raw runtime ID. The creation context is a frozen snapshot of the artifact-creating session. Later agent editors and reviewers must not replace the creation context with their own session. Only the runtime target may change when the runtime scope changes.

Classify agent-facing work by reachable behavior. Use cloud only when every changed behavior is behind an explicit cloud-only boundary. Use local only when every changed behavior is behind an explicit local-only boundary. Use either when cloud and local reach the same changed behavior path. Use both only when correctness depends on distinct cloud and local behavior. Uncertainty is not a target. Only agent-facing work adds a runtime target. Non-agent-facing work keeps target absent and has no cloud/local coverage gate.

Work targeted at `either` needs a check in cloud or local. Work targeted at `both` stays draft or not ready until both paths have been checked. When agent-facing work becomes ordinary, remove only its runtime target. The frozen creation context stays unchanged. GitHub issues include the rendered agent context block in the initial body. Linear tickets put the block rendered with `--linear` in the initial description. Follow `agent-provenance` for rendering and verified body edits.

A reviewer in an incompatible environment hands agent-facing work to a compatible reviewer instead of approving an unchecked runtime path.
