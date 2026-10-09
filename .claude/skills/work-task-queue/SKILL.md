---
name: work-task-queue
description: Use when continuously taking implementation work from a profile-backed repository queue, especially when claiming Ready issues, opening implementation PRs or safe stacks, handing work to review, or monitoring for the next eligible task.
---

# Work a task queue

Continuously turn truthful `Ready` work into reviewable implementation handoffs. One validated
profile and the complete live queue are the inputs; draft implementation PRs, truthful issue
handoffs, and an armed worker monitor are the outputs.

## Ordered workflow

### 1. Load dependencies and validate the profile

Read and follow these dependencies before touching the tracker:

- [`steward-task-queue`](../steward-task-queue/SKILL.md) for profile resolution, validation,
  backend access, live-input completeness, and monitoring.
- [`claim-task`](../claim-task/SKILL.md) for eligibility, claim arbitration, Queue transitions,
  Claim, and file-lock rules.
- [`create-pr`](../create-pr/SKILL.md) for committing, pushing, and opening or updating a draft PR.
- [`stacked-pr-rules`](../stacked-pr-rules/SKILL.md) whenever more than one PR is proposed.

Derive each dependency's skill directory from the path used to read its `SKILL.md`. Derive every
executable path from that directory: in particular, use the validator and backend adapter beside
`steward-task-queue`, and the `task-queue` and replay executables beside `claim-task`. Never assume
the current working directory or copy an executable into this skill.

Fresh-read this worker session's identity at role startup and run
`<claim-task-skill-dir>/task-queue validate-session --session <session-identity>`
before tracker access, selection, or any marker, `Queue`, `Claim`, or generation-ref write.
Require exactly one identity and fail closed if it is missing or is not a `claim-task` session
token. Keep that validated token unchanged for every claim marker, Claim event, settlement caller,
and ref-authority check in this role.

Resolve and validate exactly one repository profile through `steward-task-queue`. Stop before
tracker access on a missing or invalid profile, unsupported mutation capability, or failed
preflight. Use that profile for every subsequent read and write.

For a GitHub profile, apply this requirement:
Apply `steward-task-queue`'s Cursor Cloud GitHub credential contract before tracker access.
Keep that credential on every queue read and write.

### 2. Fetch the complete live inputs

Use `steward-task-queue` to fetch the full current issue set and all open implementation changes,
including Queue metadata, activated generations, scoped Claim events, blockers, exact `Touches`,
required issue labels, owner links, changed files, current heads, CI, review state, and merge
state. Include merged changes needed to reconcile an open owner.

Normalize through the profile's backend adapter and `claim-task` replay path. Cached queue output,
an old PR head, or a previous monitor tick is context only. Re-fetch before every selection and
after every event.

### 3. Select one eligible Ready issue

Run `<claim-task-skill-dir>/task-queue next` on the normalized complete issue set and choose only
its highest-priority valuable eligible `Ready` result. Follow its deterministic tie-break and
eligibility result; do not recreate those rules in prose.

A dependency or live `Touches` collision makes an issue currently ineligible but does not change
its stored Queue state. Leave a colliding issue `Ready`; there is no stored `Blocked` state. If
there is no eligible valuable result, go to section 9 without claiming or inventing work.

Before claiming an eligible result, confirm this session can carry the task to its handoff, as
**One task per fresh worker** below describes. A context-limited monitor claims nothing.

### 4. Claim the activated Ready generation

Use `claim-task`'s complete work-claim protocol with the active generation for this `Ready` visit:
write the generation-scoped marker, enter `In progress` with scoped Claim, re-read authority, and
run `<claim-task-skill-dir>/task-queue settle`. Converge Claim exactly as that dependency directs.

Only after settlement names this session as winner, create its generation-specific lock ref
`claude/issue-<N>-<generation>`. After losing settlement, converge Claim to the winner, do not
revert Queue or create work or the generation-specific ref, and do not immediately select the
same issue against the unchanged snapshot. Refresh the complete queue and choose the next eligible
item. Run `claim-task`'s **Rejected generation-ref protocol** unchanged after any rejected
generation ref.

After the ref exists, dispatch sections 5 to 7 to a fresh task worker as **One task per fresh
worker** below describes, and resume at section 8 when it returns.

### 5. Re-read before implementation

After winning, re-read the issue, activated generation, current default branch, open and recently
merged changes, owner mappings, exact changed-file lists, and live `Touches`. Confirm the problem
and acceptance criteria still apply. If another change invalidates the plan, reconcile under
section 10 rather than implementing against stale assumptions.

If stewardship returned an owner with an existing PR through a fresh `Ready` generation because
review authorship was unrecoverable, preserve its locks and inspect that PR before changing code.
The worker adopts or verifies the existing PR: establish its current head, ownership, diff,
tests, and provenance; make only required fixes; then use section 8 to create a truthful
`Needs review` handoff under this worker's validated identity. Do not infer or backfill the prior
author's `implementation_authors`.

### 6. Implement and verify

Implement only the claimed issue under repository instructions. Keep `Touches` exact as the
change evolves, and update profile-required issue labels through the profile adapter. Verify the
behavior and required repository checks before describing the work as reviewable.

When the validated profile lists a CI exception, check each red job against it before treating the
red as the change's. A GitHub Actions job refused for an account billing problem matches only by
`steward-task-queue` section 9's recognition test: it ran zero steps, and its check-run annotation
says recent account payments failed or the spending limit needs raising. For a matching job,
follow that section: don't re-run, root-cause, or wait on it; run the suites that cover the change
locally and record their results in the PR body where the CI result would go. A job that ran steps
is ordinary CI, so the fallback ends by itself once jobs run again.

Do not change role merely because review work exists. This session remains a worker and never
uses worker ownership as permission to review its own result.

### 7. Open or update the implementation PR

Follow `create-pr` to commit, push, and open or update a draft PR linked to the owner issue. Do not
claim that an unpushed or unverified diff has a durable review handoff.

Use more than one PR only under `stacked-pr-rules`. Every slice must be independently landing-safe
in merge order and every description must carry the synchronized full change-set navigation. If
the proposed bottom slice needs a later slice to pass, redraw the slices or keep one PR.

The worker never merges a PR, enables auto-merge, marks a draft ready, or changes PR labels.
It may update the owner issue's required issue labels through the validated profile.

### 8. Hand off reviewable work

Re-fetch the issue and every owner PR. Continue only when all implementation work being handed
off is pushed, reviewable, correctly linked, and accurately represented by exact `Touches` and
profile-required issue labels. Check every owner PR body with
`agent-provenance body-record --body <fresh-PR-body-file>`. A missing or malformed block is not
fixed in this workflow, so name that PR and its `body-record` error in the handoff; the steward reports
it to the user for a decision.

Before the `Needs review` transition, record the stack ownership shape in the handoff. For
`distinct-owner-per-PR`, map every PR to its owner issue and record the complete owner ancestry.
For `single-owner-multiple-PRs`, map the remaining ordered PRs to the same owner issue. Do not
leave the reviewer to infer ownership from branch names, `Touches`, or stack position.

Perform the profile's two-phase transition in this order: append the pending intent for the next
review generation, perform the `Queue write` to `Needs review`, then append its activation.
Append the scoped Claim clear for the completed `In progress` generation and repair the Claim
projection exactly as `claim-task` directs. Report the resulting generation and handoff.
The resulting `Needs review` state is unheld and carries no Claim.

Never review your own work. Leave the activated `Needs review` visit unheld for an independent
reviewer, then continue as a worker.

The handoff also ends this session's control of the handed-off branches, as `claim-task` defines
the holder. From the `Needs review` write onward, make no commit, push, finding fix, or review
response on those PRs, even when a PR event (CI, a review comment, a merge conflict) reaches you:
the reviewer that wins the next generation owns all of them. At the handoff, end this session's
PR-activity subscription for those PRs (`unsubscribe_pr_activity` or the runtime's equivalent), so
later PR events stop reaching this session. Anything worth passing on goes in
a plain comment on the owner issue, which the claim holder and the steward read. Writing to that
work again needs a fresh `Ready` generation and claim.

### 9. Select the next task or monitor

Return to section 2 and select again. When no valuable eligible `Ready` issue exists, claim
nothing and report the live dependency, collision, or value reason.

Start or refresh the product-native subscription preferred by `steward-task-queue`; otherwise use
one inspectable persistent monitor at `cadence_minutes.worker` from the validated profile. Finish
the current tick and its writes before you re-arm the monitor. After each event, fetch live state
and repeat this workflow. While idle, never switch roles, lower the value bar, or invent
eligibility. This worker never stops while idle; it remains on the armed monitor after each
refresh.

### 10. Interrupt or put work down truthfully

`Waiting for input` is only for an exact human decision discovered before any implementation
branch exists. Clear the active scoped Claim as `claim-task` requires, record the precise
alternatives, set the profile's real `Waiting for input` state, and leave no file lock. A later
return to `Ready` is a stewarded two-phase transition, not a direct Queue edit.

Work with an unmerged branch must never enter `Waiting for input`. If it is genuinely reviewable,
use section 8 and state what remains. If it is not reviewable or cannot be safely released, it
must not enter `Needs review`: keep `In progress`, keep Claim, preserve exact `Touches` and issue
labels, and continue or re-arm monitoring. Do not log out while pretending those live locks were
released.

Before any intentional stop, re-read and reconcile Queue, Claim, exact `Touches`, and required
issue labels through the profile adapter. Record any non-obvious decision or incomplete handoff
as a comment on the owner issue, then leave the corresponding monitor armed; elapsed time never
proves that a claim or branch is dead.

## One task per fresh worker

A worker that keeps one session across tasks piles every issue body, diff, test log and PR body
into one context, and in time it can no longer finish a task it has already claimed (#606). So
this session is a thin monitor. It runs sections 1 to 4 and 8 to 10, and each claimed task's
sections 5 to 7 run in a fresh task worker that exits when that task's PR is up.

**Identity.** The task worker acts under the monitor's validated session token. It does not
validate or mint an identity of its own, so the claim marker, the Claim event, and the
`implementation_authors` a reviewer later reads all name the monitor. Reviewers run in separate
sessions with their own tokens, so self-review exclusion still holds.

**The brief.** The task worker gets none of the monitor's context, so its brief carries all of it:

- the repository, the owner issue number, and the validated profile path;
- the active `In progress` generation and its lock ref `claude/issue-<N>-<generation>`;
- the implementation branch to push, and its worktree when the monitor made one;
- the monitor's validated session token, and the `claim-replay` command that checks the Claim
  still names that token for that generation. The task worker runs it before every push and stops
  writing when the Claim names anyone else, as `claim-task` requires of the holder;
- every rule section 1 places on tracker access and writes, such as the Cursor Cloud GitHub
  credential contract for a GitHub profile;
- sections 5 to 7 of this skill and the dependencies they use, read from this skill's directory;
- that it never writes `Queue`, `Claim`, a claim marker, or a generation ref, and never hands off;
- what to return: each PR's number and head SHA, the branch, the exact `Touches` the change now
  needs, the checks it ran with their results, each PR body's `agent-provenance body-record`
  result, and anything left unfinished. No diff, logs, or issue text.

**Dispatch.** Choose the path from the tools this session actually has:

- **A subagent tool** (Cursor's or Claude Code's Task tool): dispatch a new general-purpose
  subagent for each task, never a resumed one. Cloud agents reject `resume: "self"` (#58), and a
  resumed worker carries the last task's context, which is what this section removes. Run it in
  the foreground, since a backgrounded worker ends the monitor's turn mid-task.
- **No subagent tool** (a Cursor Cloud agent that another session launched is one; look the tool up
  by name before concluding it is missing): run the role from a schedule that starts a fresh agent
  per tick, such as a Cursor Automation. Each scheduled agent validates its own session token,
  claims at most one task, does it through section 8, and exits. The schedule is its armed monitor,
  and no context carries from one task to the next.
- **Neither:** claim nothing, and report that this runtime cannot run a task in a fresh worker.

**When it returns.** Read the PRs, heads, changed files, and Claim from the provider rather than
the worker's account of them, then continue at section 8. A worker that stops short of a handoff
is routed by what the provider shows:

- stopped before any branch existed on a decision only a human can make: take section 10's
  `Waiting for input` path;
- left pushed but unfinished work: keep `In progress` and the Claim, and dispatch one fresh worker
  briefed with that branch and what remains;
- stopped or died before its first push for any other reason, such as running out of context while
  exploring: keep `In progress` and the Claim, and dispatch one fresh worker with the same brief
  plus whatever the first one reported.

When a second worker in a row stops on one task with no new commit on the branch, or still with no
branch, dispatch no third: put the work down through section 10, by what the provider and that
worktree show.

- **With implementation evidence** as `claim-task`'s **Reclaiming a dead task** counts it, which
  includes commits or a diff left in the worktree the monitor made and not only a pushed branch,
  that work still holds its files, so keep `In progress`, the Claim, and exact `Touches`. Work
  that is only in that worktree ends with this session and nobody else can fetch it, so first run
  the brief's `claim-replay` command, and while the Claim still names this session, commit any
  diff and push the worktree's branch; when it names anyone else, stop writing as `claim-task`
  requires of the holder. Only a person's answer can release that Claim, and `steward-task-queue`
  section 7 exempts it from the two-hour release once the issue says so: post section 10's
  incomplete-handoff record as a comment on the owner issue that starts `Needs a person:` and
  names the pushed branch, its head, what remains, and why each worker stopped. Name the issue in
  every section 9 report until a person decides.
- **With none**, nothing holds the files, so release the task the way `claim-task`'s
  **Reclaiming a dead task** does without implementation evidence: clear the scoped Claim, then
  append and activate a fresh `Ready` generation through the two-phase transition. Comment on the
  owner issue why both workers stopped, and claim that issue no more from this session, so a
  session with fresh context takes it.

A worker that dies costs one task; the claim's two-hour activity rule in `claim-task` still covers
a monitor that dies with it.

**A context-limited monitor claims nothing.** Before each claim, the monitor needs room to select,
claim, brief a worker, read its result, and hand off; without a fresh worker it also needs room for
the whole task. When it lacks that, it leaves every eligible issue unclaimed in `Ready` for another
worker, reports which issues were eligible and that it stopped for context, and stops re-arming so
a fresh session takes the role. This is not idling, so section 9's rule against stopping while
idle does not apply. Claiming anyway would hold the issue's files `In progress` with nobody working
until the two-hour rule releases them.

`steward-task-queue`'s **Replacing a heavy queue session** is the shared rule for the rest: the
outside signals that mark a heavy session (compactions, "prompt too long" errors, failed turns,
stalls on usage limits), the quiet point between tasks where the role may move, the handoff the
fresh session gets, and that this session stops once the fresh one is running. A monitor that sees
one of those signals in itself treats it as lacking room.
