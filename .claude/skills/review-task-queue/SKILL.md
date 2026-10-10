---
name: review-task-queue
description: Use when continuously reviewing implementation work from a profile-backed repository queue, especially when claiming Needs-review issues, running deep-review loops, reviewing PR stacks bottom-up, waiting for merges, or monitoring for the next review.
---

# Review a task queue

Continuously turn truthful `Needs review` work into reviewed merge handoffs. One validated profile
and the complete live queue and PR graph are the inputs; reviewed owner handoffs, stack
subscriptions, and an armed reviewer monitor are the outputs.

## Ordered workflow

### 1. Load dependencies and validate the profile

Read and follow these dependencies before touching the tracker:

- [`steward-task-queue`](../steward-task-queue/SKILL.md) for profile resolution, validation,
  backend access, live-input completeness, and monitoring.
- [`claim-task`](../claim-task/SKILL.md) for eligibility, claim arbitration, Queue transitions,
  Claim, and file-lock rules.
- [`deep-review-orchestrate`](../deep-review-orchestrate/SKILL.md) for the complete review and
  addressing loop, its current-head stop rule, and escalation conditions.
- [`stacked-pr-rules`](../stacked-pr-rules/SKILL.md) for stack navigation and landing safety.

Derive each dependency's skill directory from the path used to read its `SKILL.md`. Derive every
executable path from that directory: in particular, use the validator and backend adapter beside
`steward-task-queue`, the `task-queue` and replay executables beside `claim-task`, and review-loop
helpers beside `deep-review-orchestrate`. Never assume the current working directory or copy an
executable into this skill.

Fresh-read this reviewer session's identity at role startup and run
`<claim-task-skill-dir>/task-queue validate-session --session <session-identity>`
before tracker access, selection, or any marker, `Queue`, `Claim`, or generation-ref write.
Require exactly one identity and fail closed if it is missing or is not a `claim-task` session
token. Keep that validated token unchanged for `--reviewer`, every claim marker, Claim event,
settlement caller, and ref-authority check in this role.

Resolve and validate exactly one repository profile through `steward-task-queue`. Stop before
tracker access on a missing or invalid profile, unsupported mutation capability, or failed
preflight. Use that profile for every subsequent read and write.

**Pin the protocol for each claim cycle.** After reading the dependencies, record their revision:
one hash over the `SKILL.md` of every skill this role's writes depend on, plus every executable
this role runs from their directories (for example `cat <files> | shasum -a 256`). That set is the
four dependencies above and the skills they write through: `review-end-decision` (the close
route's Claim and `Queue` writes), `agent-provenance` (its `body-record` executable decides
`runtime_target`), and `address-deep-review` and `deep-review` (the response and marker posts).
Recompute it before every marker, `Queue`, `Claim`, generation-ref, push, or response write. When
it has changed, the protocol you read at startup may no longer be the installed one, so make
neither that write nor any later one under the old reading. Re-read every dependency and
re-validate the session token and profile. Holding no claim, restart from section 2 with fresh
live state. Holding one, fresh-replay its Claim under the reloaded protocol: when settlement still
names this session, resume that generation at section 5; when it does not, treat the claim as
lost, as section 4 says. Before resuming, read the generation ref and run `claim --review
--resume` only if the ref is missing: `--resume` is for `claim-task`'s exit-4 `held-without-ref`
case, and it reads an existing ref as a disagreement that stops even the holder. A reload after this session's claim marker but before settlement runs
`task-queue settle` for that generation first, and `claim-task`'s replay decides whether to finish
section 4 or take its losing path. A long-running reviewer once kept following a claim protocol
that a merge had replaced before its first claim completed (#520).

For a GitHub profile, apply this requirement:
Apply `steward-task-queue`'s Cursor Cloud GitHub credential contract before tracker access.
Keep that credential on every queue read and write.

### 2. Fetch the complete live inputs

Use `steward-task-queue` to fetch the full current issue set and complete PR graph, including
Queue metadata, activated generations, scoped Claim events, blockers, exact `Touches`, required
issue labels, owner links, full stack descriptions and bases, changed files, current head
revisions, CI, reviews, draft state, and merge state. Include merged changes whose owners still
need reconciliation.

Normalize through the profile's backend adapter and `claim-task` replay path. Fetch every exact
base and head from the live provider; never fabricate a revision or substitute one remembered
from an earlier tick. Derive each issue's complete stack ancestry from the live PR graph and
owner links rather than from Touches or remembered navigation. Re-fetch before every selection
and after every event.

### 3. Select one eligible review

Resolve the live PR/owner mappings into each issue's complete `stack_ancestors` list before
selection. Fresh-read every candidate's implementation author/session identities and this review
session's identity from live issue, PR, and session data before selection or any marker, `Queue`,
`Claim`, or generation-ref write. Normalize every `Needs review` record with:

- `implementation_authors`, a unique, nonempty array of session tokens;
- `runtime_target`, read from the owner's open implementation PRs' agent context blocks: run
  `agent-provenance body-record --body <fresh-PR-body-file>` on each PR. Take the `target`
  recorded by the owner's bottom unmerged PR in the live PR graph, the one PR section 6 reviews,
  or `null` when its block records none. A block whose models the harness withheld
  (`models_withheld: true`, as a Claude Code cloud worker writes) is valid, and its
  `target` sets `runtime_target` like any other. Never combine targets across an owner's PRs: each review
  certifies only that bottom PR, and a later PR's target applies once section 8 makes it the
  bottom one. A failed `body-record` means that PR's block
  is missing or malformed. Omit the field when any PR's block is missing or malformed, and give
  the record a `normalization_error` naming that PR, so it fails closed while the steward reports
  it; and
- the validated review session token as a separate executable input.

Pass this session's runtime as `--runtime`: `cloud` when the authoritative provenance source
reports a Cloud environment, `local` when it reports Local. That source is the one
`agent-provenance` names for this harness. For Claude Code, local or cloud, it is
`CLAUDE_CODE_REMOTE`: `true` means `cloud`, and anything else means `local`, which is the
environment `agent-provenance from-claude-code` records. Never infer it from the prompt, and stop
before selection when the environment is unknown, including in a harness that has no provenance
adapter.

Pass the validated review session token only as `--reviewer`; do not put
`review_excluded` in the input. On a record-local replay or authorship failure, include that issue
with a nonempty `normalization_error`, preserve its live Queue and exact `Touches`, blockers, and
stack ancestry, and omit the Claim, generation, or authorship that could not be established while
the steward repairs it. The executable makes only that record ineligible while its live Queue
continues to hold its files, so valid siblings remain selectable in the same pass.

Do not fabricate `implementation_authors`. If complete live evidence cannot recover authorship,
write no review claim or PR mutation; preserve its locks during repair and have the steward return
the owner through a fresh `Ready` generation. A worker adopts or verifies the existing PR and
later creates a truthful `Needs review` handoff. This is recovery through executable generations,
not an exception to self-review exclusion.

Fail closed for the whole normalized snapshot on incomplete live input, missing or ambiguous owner
mappings, malformed ancestry, an ambiguous reviewer identity, duplicate JSON object keys, invalid
normalized field types, or a stack cycle. After every candidate has either trusted normalized
authorship or an explicit record-local error, run
`<claim-task-skill-dir>/task-queue next --queue "Needs review" --reviewer <review-session-identity> --runtime <cloud|local>`
on the complete normalized issue set. The executable derives `review_excluded` by exact membership
of `--reviewer` in `implementation_authors`. Choose only the highest-priority eligible `Needs review` result
and accept the executable's directed stack, blocker, collision, self-review exclusion, priority,
and deterministic tie-break decisions. Never turn a computed dependency, `Touches` collision, or
unmerged stack parent into an invented Queue state.

The executable leaves a self-authored record ineligible with the reason
`self-authored implementation is excluded from review`, while its unmerged files stay locked against
implementation picks (like any unclaimed review, it holds nothing against another review pick).
Write no marker, `Queue`, `Claim`, or generation ref for an excluded record. Because every
candidate is annotated before selection, one executable pass selects the next eligible
non-self-authored item. If `.next` is `null` because all review candidates are excluded, go to
section 10 without writing review state.

Before claiming an eligible result, confirm this session can carry the review to its handoff, as
**One review per fresh worker** below describes. A context-limited monitor claims nothing.

Runtime compatibility works the same way. A record this runtime cannot certify — `local` work for
a Cloud reviewer, `cloud` work for a Local one, and `both` work for either — is ineligible with a
reason naming the runtime it needs, keeps every file lock against implementation picks, and stays unclaimed in `Needs review`
for a compatible reviewer's own pass. Write no marker, `Queue`, `Claim`, or generation ref for it,
and do not post-filter results in prose; the next eligible record is already selected.

### 4. Claim the activated review generation

Use `claim-task`'s complete review-claim protocol with the active generation for this
`Needs review` visit: write the generation-scoped marker, enter `Under review` with scoped Claim,
re-read authority, and run `<claim-task-skill-dir>/task-queue settle`. Converge Claim exactly as
that dependency directs.

Only after settlement names this session as winner, create its generation-specific lock ref
`claude/review-<N>-<generation>`.

Settlement makes this session the generation's controller, as `claim-task` defines the holder:
the only session that pushes to the owner's PR branches, addresses findings, and posts review
markers or responses on them. Before the addressing pass starts, before every push, and before
every marker or response post, fresh-replay the Claim and require that it still names this session
for this generation. Under `deep-review-orchestrate`, the parent replays before each post it makes,
and each subagent brief that posts a marker or response carries the same check before its post,
with the parent's session token, the active generation, and the replay command to run. Each brief
that pushes or posts also carries section 1's pin command, rerun verbatim before every push and
post, with no further write on a different result.
If the Claim no longer names this session, the claim is lost: stop writing and leave the branch
and PR as they are.

A session that lost settlement, or whose Claim moved, leaves that loop to its holder: it posts no
response and re-runs no verification there. On a lost settlement, do not change Queue or begin
review. Losing one item does not stop the role: follow `claim-task`'s losing path and select again
from fresh state, which may pick a different item. Run `claim-task`'s
**Rejected generation-ref protocol** unchanged after any rejected generation ref.

After the ref exists, dispatch sections 5 and 6 to a fresh review worker as **One review per fresh
worker** below describes, and resume at section 7 when it returns.

### 5. Resolve the owner PRs and stack

Resolve every live PR to exactly one owner issue. For a stack, read the complete synchronized
change-set navigation and traverse bottom-up. Apply `stacked-pr-rules` to each PR against its
landing base; a slice that depends on a later PR to build, test, or remain coherent is not ready
for review.

Fail closed on missing owner links, incomplete navigation, stale bases, or ambiguous stack shape.
Separate governing instructions may authorize PR-description repair only; PR-label writes remain
unconditionally forbidden.

### 6. Review the bottom unmerged PR

Select the bottom unmerged PR only. Fetch its exact current base and head, make local and remote
heads agree, and run `deep-review-orchestrate` through its clean current-head stop or a named
escalation. Tests and an old approval do not review a newer head.

After a clean review, go to section 7. Do not review a child while its reviewed parent remains
unmerged: subscribe and wait for that PR to merge before selecting the next PR in the stack.

When the validated profile lists a CI exception, check each red job against it before the loop's
CI comparison counts it. A GitHub Actions job refused for an account billing problem matches only by
`steward-task-queue` section 9's recognition test: it ran zero steps, and its check-run annotation
says recent account payments failed or the spending limit needs raising. Every job is red in that
state, on the base too, so the failing-set comparison says nothing about the head. For a matching
job, follow that section: don't re-run, root-cause, or block a clean stop on it; run the suites
that cover the change locally on the reviewed head, and record their results in the review
response or final report in place of the comparison. A job that ran steps is ordinary CI and gets
the usual comparison, so the fallback ends by itself once jobs run again.

### 7. Hand off a clean current head

Treat an inspectably live merge monitor as a hard precondition for any `Ready to merge` handoff.
First attempt the product-native PR merge subscription. If native setup is unavailable or fails,
start one inspectable persistent fallback monitor at the validated profile's
`cadence_minutes.merge_monitor` and verify its handle is live. Monitoring becomes armed only after
the native subscription setup succeeds or the fallback handle is verified live.

If neither setup path succeeds, do not perform any `Ready to merge` handoff write: keep Queue
`Under review`, keep the scoped `Under review` Claim, preserve exact `Touches` and required issue
labels, report the merge-monitor capability gap, and remain in a live retry/monitor loop until one
setup path succeeds. Never clear Claim, expose `Ready to merge`, or continue the handoff without an
inspectably live watcher.

Only after monitoring is armed, immediately fresh-read the PR's merge state and head plus the owner
issue's Queue, Claim, exact `Touches`, and required issue labels. If that read finds the PR merged,
skip every open-PR handoff write and enter section 8 from that fresh state.

If that read finds the PR still open, perform the `Ready to merge` handoff writes only after
requiring the review loop's clean stop to cover that exact current head. A changed or unreviewed
head returns to section 6 without a handoff. Re-derive `runtime_target` from fresh owner PR
bodies as section 3 does; when it is missing, malformed, or no longer one `--runtime` can
certify, make no `Ready to merge` write and use section 9's intentional `Needs review` handoff, where
a compatible reviewer selects it, a `both` record waits as section 10 reports, or the steward
reports its unreadable block. Otherwise, update the owner issue's exact `Touches`
from every PR it still owns and its profile-required issue labels, set Queue to `Ready to merge`,
append the scoped `Under review` Claim clear, and repair the Claim projection as `claim-task`
directs. Report the reviewed head from the live read. The resulting `Ready to merge` state is
unheld and carries no Claim.

Immediately after those writes, fresh-read the same PR and owner state and reconcile any merge
before waiting on the armed merge monitor. A merge observed by either immediate read enters
section 8 immediately. If the PR remains open after the second read, keep the subscription armed
or the fallback handle live and wait for its merge event.

This role must not merge a PR, enable auto-merge, mark a draft ready, or change PR labels. It may
update only the owner issue fields and issue labels authorized by the validated profile. When
`review-end-decision`'s close route applies to queue-owned single-PR work, it may also close that
PR and return the owner issue to `Ready`, clearing the scoped `Under review` Claim first, as that
route directs.

### 8. Continue only after merge

Enter this section only after a fresh provider read proves the PR merged. Use this same
reconciliation whether the merge was observed by either immediate read or delivered by the armed
merge monitor. For the monitor path, resume only after the merge event, then re-read the
provider rather than inferring success from elapsed time. Re-fetch the entire stack because the
next PR's base, head, owner, changed files, blockers, locks, and authorship may have changed.

Follow the ownership shape the worker recorded:

- For `distinct-owner-per-PR`, complete any missing scoped `Under review` Claim clear and
  projection repair, close the merged PR's owner issue, clear only that owner's merged file locks,
  and preserve every unmerged owner's `Touches`. The next PR keeps its distinct owner and
  already-activated review generation.
- For `single-owner-multiple-PRs`, do not close the owner after an intermediate merge; recompute
  exact `Touches` from every remaining unmerged PR, update required issue labels, complete any
  missing scoped `Under review` Claim clear and projection repair, append a pending intent whose
  predecessor is the completed review generation, write `Queue: Needs review`, and append its
  activation. This is a new review generation for the same owner, not reuse of the completed one.
  Close and release the single owner only after its final PR merges.

Return to sections 2 and 3 with complete live inputs. During active stack continuity, use the
freshly normalized `implementation_authors` and validated review session token to run
`<claim-task-skill-dir>/task-queue next --queue "Needs review" --reviewer <review-session-identity> --prefer <next-owner-issue> --runtime <cloud|local>`.
The option may prefer the next owner only when that record is fully eligible. A blocker, open
ancestor, or unrelated file lock makes it fall back to the canonical highest-priority eligible
issue; a review exclusion or runtime incompatibility does the same. An eligible preferred owner remains selected even when
another eligible issue has higher Priority.

A preferred record whose `implementation_authors` contains the `--reviewer` identity is ineligible
and falls back to the canonical eligible non-self-authored result. Do not post-filter or reselect a
self-authored result in prose; the normalized input makes the executable decision. Only after live
selection returns an eligible record may you proceed to section 4 for the active generation. If it
returns no record, go to section 10. Continue bottom-up until the stack is merged.

### 9. Escalate without waiving review

A capped, pivoted, write-stopped, or otherwise escalated loop is never `Ready to merge`, and
there is no exception that can make an unreviewed current head merge-ready. Fetch and record the
live unreviewed current head; never invent its SHA.

If actively continuing or waiting for an explicit event, keep `Under review`, keep Claim, and
continue or re-arm monitoring. For an intentional review handoff, preserve exact `Touches` and
the unmerged branch's file locks, then use the profile's two-phase transition: append the pending
intent for a new `Needs review` generation, perform the `Queue write` to `Needs review`, and
append its activation. Clear only the scoped old review Claim and record the unresolved decision,
cap reason, and unreviewed current head. A write-stopped loop's record also names its write-stopped
run numbers and, for a local loop, the `deep-review/` paths `deep-review-orchestrate` copied them to.
For a cap handoff whose capped round's response names a pushed SHA (not `none` or `rejected`)
that is still the current head, write that record as an issue comment naming the head's SHA and
the word `certification`: that comment is what returns the head for `deep-review-orchestrate`'s
certification pass. Any other cap handoff keeps the unresolved-decision
record without that word, because certification only reads a head the capped round pushed.

`review-end-decision` decides how a cap ends, and its routes to `Ready to merge` start with that
certification. A certification pass of exactly the handed-back head that finds no must-address reviews it, once
any lesser findings are filed and its CI adds no failure outside the base's failing set, so that
head alone goes to the section 7 `Ready to merge` handoff.
A certification with a must-address finding, a head that moved after the handoff, and every other
capped or escalated head stay out of `Ready to merge`.

Decide which of those applies with `review-end-decision`, not by asking. It picks between the
certification handoff above, one extension round, and closing the PR and returning its owner to
`Ready` with a re-scoped issue, and it records the choice on the PR. Report and stop only for what
that skill lists under "What still needs a person".

An issue with an unmerged branch must never enter `Waiting for input`; retain active review
stewardship or make the safe `Needs review` handoff above.

### 10. Select the next review or monitor

After a single PR or full stack completes, return to section 2 and select the highest-priority
eligible review. When none exists, claim nothing and report the live dependency, collision,
unmerged-parent, or runtime reason. Report every `both` record waiting this way, since no single
reviewer can certify it.

Start or refresh the product-native subscription preferred by `steward-task-queue`; otherwise use
one inspectable persistent monitor at `cadence_minutes.reviewer` from the validated profile. Finish
the current tick and its writes before you re-arm the monitor. After each event, fetch live state
and repeat this workflow. While idle, never switch roles or invent eligibility. This reviewer
never stops while idle; it remains on the armed monitor after each refresh.

Before any intentional stop, re-read and reconcile Queue, Claim, exact `Touches`, and required
issue labels through the profile adapter. Record non-obvious escalation or handoff state, then
leave the corresponding monitor armed.

## One review per fresh worker

One `deep-review-orchestrate` loop can use most of a session's context, so a reviewer that keeps
one session across reviews soon has eligible work and no room to do it (#606). So this session is
a thin monitor. It runs sections 1 to 4 and 7 to 10, and each claimed review's sections 5 and 6
run in a fresh review worker that exits at the loop's clean stop or escalation.

**Identity.** The review worker acts under the monitor's validated session token and validates no
identity of its own. Every marker, response, and Claim check it makes names the monitor, which is
the session the live Claim names.

**The brief.** The review worker gets none of the monitor's context, so its brief carries:

- the repository, the owner issue number, the owner PRs, and the validated profile path;
- the active `Under review` generation and its lock ref `claude/review-<N>-<generation>`;
- the monitor's validated session token, and the `claim-replay` command that checks the Claim
  still names that token for that generation. Section 4's controller check applies to the worker
  and to every subagent it briefs: replay before the addressing pass, before every push, and before
  every marker or response post (and every `Decision:` or `Handover:` comment), and stop writing
  and return when the Claim names anyone else;
- the protocol hash the monitor recorded under section 1's **Pin the protocol** and the exact
  command it ran to get it, files in order. The worker, and every subagent it briefs to push or
  post, reruns that command verbatim before every push and every comment, and on a different result
  makes no further write and returns;
- every rule section 1 places on tracker access, such as the Cursor Cloud GitHub credential
  contract for a GitHub profile;
- sections 5 and 6 of this skill and the dependencies they use, read from this skill's directory;
- that it never writes `Queue`, `Claim`, a claim marker, or a generation ref, never closes the PR,
  and never hands off. When the loop escalates, it follows `review-end-decision` through every
  route that stays inside the loop (an adjudication either way, taking a finding it can neither
  reproduce nor refute, the extension round, a peer loop run by another session while the Claim
  still names the monitor, which makes this loop the worker's to continue) and returns at a `Decision:` whose next step is a
  close, `Ready`, or `Needs review` write. Those writes are the monitor's, made in section 9.
  A peer it cannot place outside this monitor's earlier workers is a sibling, so it returns rather
  than continues;
- what to return: the reviewed PR and its current head SHA; why it stopped, as one of a clean stop
  on that head, a `Decision:` (with its route), a `Handover:` (with its reason), a peer it cannot
  place (with both controllers' heads), a changed protocol pin, a lost Claim, or a blocker only a
  person can clear (with what it needs); the round count; and the paths of any write-stopped
  records. No review text, diff, or logs.

**Dispatch.** `deep-review-orchestrate` dispatches a fresh subagent every round, so the review
worker needs a subagent tool of its own. Choose the path from the tools this session actually has:

- **A subagent tool whose subagents can dispatch their own:** dispatch a new general-purpose
  subagent for each review, never a resumed one. Cloud agents reject `resume: "self"` (#58). Run it
  in the foreground, since a backgrounded worker ends the monitor's turn mid-loop.
- **A subagent tool whose subagents cannot dispatch** (Claude Code subagents cannot): run
  `deep-review-orchestrate` in this session with every addressing pass delegated, as its step 3
  allows, so each review round and each addressing pass runs in a fresh subagent and this session
  holds only their indexes, plus round 1's two full reviews, which it folds. Apply the
  context-limited rule below before every claim.
- **No subagent tool:** `deep-review-orchestrate` stops before round 1 without one, so claim
  nothing and report it. Run the role from a schedule that starts a fresh agent per tick, such as a
  Cursor Automation, only where those scheduled agents have a subagent tool. Each one validates its
  own session token, claims at most one review, takes it through section 7, and exits; the schedule
  is its armed monitor.

**When it returns.** Read the PR, its head, its markers and responses, and the Claim from the
provider rather than the worker's account of them. If the Claim no longer names this session,
take the lost-Claim route below whatever the worker reported. Otherwise route by why it stopped:

- a clean stop on the current head continues at section 7;
- a `Decision:` goes to section 9, where the monitor makes the close, `Ready`, or `Needs review`
  writes that decision calls for;
- a changed protocol pin goes to section 1's reload, which resumes the generation at section 5
  with one fresh worker while the Claim still names this session;
- a lost Claim takes `claim-task`'s losing path: no section 9 write, and select again;
- a blocker only a person can clear goes to section 9, which reports what that person must do and
  stops, as `review-end-decision`'s "What still needs a person" says;
- a peer it cannot place gets the check the next bullet makes, applied to this monitor's own
  earlier workers and their subagents only, since only those can be shown to have stopped. While
  one of them is still working there, the peer is that worker, so wait for it. Once none is, the
  peer is not this monitor's, and one fresh worker for the same generation is briefed so, which
  makes it a peer loop run by another session and the loop the worker's to continue. This counts
  as a stop under the next bullet's limit;
- a `Handover:` for context, or a worker that died mid-loop, gets one fresh worker for the same
  generation once no earlier worker or subagent of it is still working there, as
  `deep-review-orchestrate` requires before a resume, briefed to resume the loop from the PR; `deep-review-orchestrate` already resumes an
  unanswered marker. A peer-loop `Handover:` while the Claim still names this session misreads who
  owns the loop, so it gets the same one fresh worker, briefed that this session owns it. A second stop
  of any of these kinds in a row on one generation takes section 9's `Needs review` handoff instead.

**A context-limited monitor claims nothing.** Before each claim, the monitor needs room to select,
claim, brief a worker, read its result, and hand off; on the in-session path it also needs room for
a whole loop. When it lacks that, it leaves every eligible review unclaimed in `Needs review` for
another reviewer, reports which reviews were eligible and that it stopped for context, and stops
re-arming so a fresh session takes the role. This is not idling, so section 10's rule against
stopping while idle does not apply. Claiming anyway would hold `Under review`, with its files
locked, until the two-hour rule released it.

`steward-task-queue`'s **Replacing a heavy queue session** is the shared rule for the rest: the
outside signals that mark a heavy session (compactions, "prompt too long" errors, failed turns,
stalls on usage limits), the quiet point between tasks where the role may move, the handoff the
fresh session gets, and that this session stops once the fresh one is running. A monitor that sees
one of those signals in itself treats it as lacking room.
