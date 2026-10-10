---
name: claim-task
description: Pick up the next piece of work in a repo where several agents work in parallel, without two agents taking the same task or colliding in the same files. Covers choosing from the queue, claiming a task so others can see it is taken, handing finished work off for review, claiming somebody else's work to review it, and reclaiming a task whose agent died. Use whenever you are about to start work in a repo that has the task-queue issue fields, when asked what to work on next, when you finish a task, or when you are asked to review another agent's PR.
---

# Claim a task

## When to use

Any time you're about to start work in a repo that carries the queue protocol, and any time you finish. If you're asked "what's next?", or you've opened a PR and want it reviewed, or you've been sent to review somebody else's, this is the protocol.

Standalone users must first read and follow `../steward-task-queue/SKILL.md` before any tracker
access. In Cursor Cloud, apply its GitHub credential contract to every queue read and write; the
installation credential does not carry issue-field access.

For a GitHub profile, validate the profile and derive `<claim-task-skill-dir>` from the path used
to read this `SKILL.md`. Resolve the bundled `issue-fields` first, then its installed command.
A local-config source checkout also carries it under its own `bin/` so a fresh checkout can run
before setup installs links. Fail closed when none exists:

```bash
issue_fields="<claim-task-skill-dir>/issue-fields"
if [ ! -x "$issue_fields" ]; then
  issue_fields="$(command -v issue-fields 2>/dev/null || true)"
fi
if [ -z "$issue_fields" ]; then
  repo_root="$(git rev-parse --show-toplevel)"
  issue_fields="$repo_root/bin/issue-fields"
fi
[ -x "$issue_fields" ] || {
  printf '%s\n' 'issue-fields command is unavailable' >&2
  exit 1
}

issue_fields_command=("$issue_fields")
if [ -n "${CURSOR_CLOUD_AGENT:-}" ]; then
  set +x
  : "${GH_JCLAW_LABS_ISSUE_TOKEN:?GH_JCLAW_LABS_ISSUE_TOKEN is required for GitHub queue traffic}"
  issue_fields_command=(env "GH_TOKEN=$GH_JCLAW_LABS_ISSUE_TOKEN" "$issue_fields")
fi
```

Do not call a separate `list_issue_fields` tool. After validating the session identity below,
run `"${issue_fields_command[@]}" list --profile "$profile"` before the first GitHub tracker mutation and
reuse its normalized output for selection. That command performs the repository-scoped field
preflight, including configured IDs and data types. Where GraphQL is refused (Claude Code cloud
sessions), it skips the definition check and checks the data type of every value it reads
instead; reads and writes use only `repos/{owner}/{repo}/...` REST paths. A failure means the queue is unavailable;
stop rather than improvising a parallel scheme out of labels or body prose.

After validating the GitHub profile, read its attribution once and use that exact value for
every protocol comment and replay:

```bash
comment_prefix="$(jq -er '.writes.comment_prefix' "$profile")"
```

## Session identity

A session token is nonempty and contains no colon, ASCII whitespace, `<`, or `>`.
The same grammar governs every caller, `--reviewer`, `implementation_authors`, claim marker, and nonempty Claim value on GitHub and Linear. An empty Claim value remains the scoped clear event, not an identity.

Fresh-read exactly one live worker or reviewer session identity at role startup and validate it
before tracker access, selection, or writes:

```bash
<claim-task-skill-dir>/task-queue validate-session --session <session-identity>
```

In a Claude Code cloud session (`CLAUDE_CODE_REMOTE=true`), the session identity is the harness's
`CLAUDE_CODE_REMOTE_SESSION_ID`, used as is. It holds `cse_<id>`, where `<id>` is the same one the
session's `claude.ai/code/session_<id>` URL and commit trailers carry. Read it from the harness
rather than the prompt, and fail closed when it is unset or doesn't start with `cse_`. Every Claude
Code cloud worker and reviewer uses this token. A task or review worker it dispatches inherits the
same variable, so it resolves to the monitor's token. A session keeps the one token it validated
at startup for its whole life, including every Claim it already holds, so one session never
carries two tokens: a session that started under another form, such as `session_<id>`, keeps that
form until it stops.

Missing or malformed identity fails closed. Do not select work, post a marker, change `Queue` or
`Claim`, create a generation ref, or encode the identity before this command succeeds. The
`task-queue` selection and settlement paths, `claim-replay`, and the Linear event reader/writer
enforce the same grammar again at their trust boundaries.

For a validated Linear stewardship profile, use its Linear profile preflight instead of the
GitHub `issue-fields` preflight. Validate the profile, fetch its configured workflow states, and run the
stewardship skill's sibling `linear-adapter statuses` before the first mutation. Derive
`<stewardship-skill-dir>` from the path used to read `steward-task-queue/SKILL.md`, not from
the profile directory; `profiles/linear-adapter` does not exist. The profile maps native
statuses, priorities, inverse `blocks` relations, and `comments-log-v1` events into this
protocol; a missing mapping, unsupported mutation capability, or live-state mismatch stops
the claim. The capability must also guarantee steward-only two-phase Queue transitions.

Every Linear event write goes through
`<stewardship-skill-dir>/linear-adapter event`. Its `.input` is ready for `commentCreate` and
already contains the marker, version, fresh UUID, and exact event fields. Never hand-construct
that envelope. Fetch every replay page with `includeArchived: true`, select `archivedAt`, and
pass the cursor-linked `linear-comment-pages-v1` aggregate to the adapter; an archived marked
event or incomplete page chain stops the claim.

## The five GitHub fields

Under the GitHub profile, work items stay GitHub Issues. These sit on the issue as custom fields, so the queue is a query rather than a board somebody reads by eye.

| field | type | written by |
|---|---|---|
| `Queue` | single-select | agents, as work moves |
| `Priority` | single-select | whoever triages — `Urgent`, `High`, `Medium`, `Low` |
| `Blocked by issue` | text | triage — `"134 96"` |
| `Touches` | text | triage — space-separated paths |
| `Claim` | text | display/cache of the authoritative scoped Claim event |

`Queue` is `Triage` · `Waiting for input` · `Ready` · `In progress` · `Needs review` · `Under review` · `Ready to merge`.

There's no `Done` — closed is done. A field that can disagree with the issue's own state will.

**Only `In progress` and `Under review` have a holder**, so those are the only two states where the scoped Claim event should name anyone. The GitHub field mirrors that value for people, but replayed comments are authority when they disagree.

**The holder is the controller, not just a name in a field.** While a generation is held, its holder is the only session that pushes to the owner's PR branches, addresses review findings on them, or posts review markers and responses there. In an unheld state nobody writes to those branches. A worker's handoff to `Needs review` ends its writes, and every other session that sees the PR, whether the implementation worker, a reviewer that lost settlement, or a session following PR events, observes it without pushing, posting a response, or re-running verification. Before each push and each marker or response post, re-replay the Claim and stop writing once it no longer names your session for the active generation. A claim that serialized only the issue fields let a second controller keep pushing and answering one loop for hours (#520).

There's no `Blocked` either, and no `Changes requested`; both are below.

`Ready to merge` is where agents stop. You can't approve or merge, so it means the work is finished and waiting on a human.

## `Waiting for input`

The other place agents stop, and the one that was missing. `Ready to merge` is work that is finished and needs a person; this is work that cannot **start** until a person does something — rules on a design question, runs a study with real respondents, changes a setting only they can reach.

Without it those issues park in `Triage`, where they are indistinguishable from an arrival nobody has sorted yet. Measured on a real board: every pickable issue read `Low` while all three `High`s sat in `Triage`, and not one of the three was untriaged — they were waiting on a ruling, a think-aloud with real respondents, and a design call the issue itself named as one. A reader seeing `Triage` reasonably concludes triage has not run. Here they see that it has, and that the answer was "not until you decide".

**It holds no files.** Nothing has started, so there is no branch, and its neighbours in that respect are `Triage` and `Ready` rather than `Ready to merge`. Both states wait on a person; only one of them has work behind it. This matters in one direction only, and it is the direction that does damage: **finished work goes to `Ready to merge`, never here**, because putting it here releases the files of a branch that is still out there. An agent that has opened a PR has no business in this state.

**An agent may move an issue here, and that is the point.** Pick something up, find that it turns on a question you cannot answer, and this is where it goes — with a comment saying what you need decided. That beats the two alternatives it replaces: leaving it `In progress` holds files for work nobody is doing, and putting it back to `Ready` hands the same dead end to the next agent. Do it only while you still have nothing to show; the moment there is a branch, the work is reviewable and belongs on the review path instead.

Before setting `Waiting for input`, append the scoped Claim clear for the current generation and
clear the GitHub projection. That event records that the visit was consumed, so replay can reject
an accidental direct return to `Ready`.

**A human records the decision, but a steward moves it out.** Once the thing it waited on has
happened, the human leaves that decision in the tracker and a steward performs the two-phase
transition into `Ready`. The human may close it when the answer is that the work should not
happen. A direct `Waiting for input` → `Ready` Queue write is outside the protocol and remains
unclaimable until an unheld repair establishes the new visit.

It earns a state where `Blocked` did not, and for the reason that section gives: a `Touches` collision is undirected and temporary, so a stored flag for it is stale minutes later. Waiting on a person is neither. It is as durable as `Blocked by issue`, it stays true until somebody acts, and nothing computes it — so there is nowhere else for it to live.

## Picking

Under GitHub, use the resolved `"${issue_fields_command[@]}"` command for every native issue-field read or
write. It owns API pagination, profile field IDs and types, normalized text fields, and verified
additive writes; do not hand-build `gh api` field requests in each worker or reviewer.

Fetch every open issue with its fields, add the live claim and stack data, and let `task-queue`
decide:

```bash
"${issue_fields_command[@]}" list --profile "$profile"
  + live PR/owner stack mappings
  → [{number, title, queue, priority, claim, blocked_by:[…],
      stack_ancestors:[…], implementation_authors:[…],
      open_prs:[…], touches:[…]}]
  → task-queue next --issues <file>
```

**`Blocked by issue` and `Touches` are single text fields, so splitting them on whitespace is the normaliser's job** — `"134 96"` becomes `[134, 96]`, not `["134 96"]`. Forgetting is the likeliest bug in this step, so `task-queue` reports an entry that still carries a space rather than reading past it. Replay GitHub's scoped Claim comments and normalize the active event's value into the queue record; use the custom field only to audit and repair its projection. For settlement, pass the complete active scoped Claim event rather than that field.

When the caller can list open PRs, set `open_prs` on every record, in-flight ones included and not only `Ready` ones, to the open PR numbers that implement that issue, matched the way `task-queue snapshot` matches them: a PR whose body has a closing keyword (`close`, `fix` or `resolve` in any tense or case) followed by `#n`, or whose head branch is `claude/issue-<n>` or `claude/work-issue-<n>`, alone or followed by `-` and a suffix. `next` then sorts a `Ready` issue with an open PR after every `Ready` issue without one, tells the worker to adopt or verify that PR rather than implement again, and warns about it as a stewardship finding. An in-flight record's `open_prs` is what keeps a second worker off a branch it already holds, so filling only the `Ready` records misses that hold. A record without the field is read as having no open PR, exactly as before the field existed. `task-queue snapshot` below fills it from the PRs it maps.

For review selection, derive `stack_ancestors` from the complete live PR graph and owner
mappings. It contains every open owner issue below that issue in its stack, bottom-first or in
any other stable order. Every `Needs review` record must carry the field. Use `[]` only when the
live graph proves there is no unmerged owner ancestor; an omitted record is ineligible, and
malformed or cyclic ancestry stops selection. A descendant waiting in `Needs review` cannot
block its ancestor, while its ancestry keeps it behind the bottom. Descendants in `In progress`,
`Under review`, or `Ready to merge` retain their file locks, as does every unrelated in-flight
issue. The default `Ready` selection remains backward-compatible and does not require stack
ancestry.

Before selecting `Needs review`, fresh-read the review session identity and every candidate's
implementation author or session identities. Normalize each candidate with
`implementation_authors` as a unique, nonempty array of session tokens, and pass the validated
reviewer session token only through `--reviewer`. The executable derives self-review
exclusion by exact membership, and caller-supplied `review_excluded` is ignored. It reports
self-authored exclusion, keeps excluded records as file-lock holders against implementation picks
(like any unclaimed review, they hold nothing against another review pick), and lets canonical ordering
or `--prefer` choose only among eligible non-self-authored records.

Each candidate also carries `runtime_target`, the runtime target its implementation PR's agent
context records (`cloud`, `local`, `either`, `both`, or `null` when there is none), and the
reviewer passes its own runtime as `--runtime cloud` or `--runtime local`. A record that runtime
cannot certify is ineligible but holds its files exactly like a self-authored one; `review-task-queue`
owns how the target is read, from the owner's bottom unmerged PR.

Under GitHub, one command does that whole fetch for `Ready` selection:

```bash
<claim-task-skill-dir>/task-queue snapshot --profile "$profile"
```

It lists the issues through `issue-fields`, maps every open PR and its files to an owner issue,
replays each `Ready`, `In progress`, `Needs review` and `Under review` issue through
`claim-replay github`, and runs `task-queue next`. When strict replay fails for any reason, such
as an edited protocol comment or a duplicate activation, it retries once with `--recover-root`
and keeps claim-replay's `recovery` when an activated root fenced the earlier history. It prints
one line naming the next issue that is both eligible and claimable, and the path of a JSON file holding the normalized input, the
replays, the PRs, and the full `next` verdict; open the file only for a reason or a warning. It
applies the Cursor Cloud credential contract itself. A record whose replay fails carries that
failure as its `normalization_error`. It does not build review selection's `stack_ancestors`,
`implementation_authors` or `runtime_target`; review selection still normalizes those as below.

`task-queue` sits beside this file. Run it rather than reasoning it out yourself — two agents waking seconds apart have to reach the same answer, and the only way that holds is one implementation. `task-queue why <issue>` explains a single one.

An issue is pickable when its `Queue` is `Ready`, every `Blocked by issue` is closed, and its `Touches` don't overlap anything in flight. Highest `Priority` wins, then lowest issue number — an unset or unrecognised priority sorts last, and an unrecognised one is reported, because a scale nobody declared is not a scale.

`Queue` is read case-insensitively too, so `In Progress` is that state rather than a typo for it. A value outside the seven holds its files anyway and is reported: a typo that serialises work costs throughput, while one that frees a lock puts two agents in the same file. `Blocked by issue` is a text field, so `task-queue` takes its numbers written either way; anything it genuinely can't read it refuses by name rather than reading past.

**Two kinds of blocked, and only one is stored.** `Blocked by issue` is directed and durable — B needs A's output, and that's true regardless of what anyone's doing right now. A `Touches` collision is undirected and temporary — neither task needs the other, they just can't run at once, and whoever claims first holds it. So `Blocked by issue` is a field and the collision is computed. There's no `Blocked` status, because it would be stale minutes after it was set.

**Everything from `In progress` onward holds its files.** The branch is unmerged in all four states, so a second agent branching off the default branch would collide at merge instead of at pick time. `Ready to merge` is the one that looks safe and isn't — the work is finished, and the branch is still out there. `Triage`, `Waiting for input` and `Ready` hold nothing, being the three with no branch behind them: two `Ready` issues naming the same file are both genuinely pickable, and whichever is claimed first locks the other out at that moment rather than in advance.

A queue that stalls because a finished PR is waiting on a human is telling you something true. Unblock the human; don't model the branch as though it had landed.

## Claiming

Under GitHub, claim with one command rather than writing the steps out:

```bash
<claim-task-skill-dir>/task-queue claim <issue> --profile "$profile" --session <session-identity>
```

Add `--review` to claim a `Needs review` visit into `Under review`. It validates the session,
requires the live Queue and `transition.claimable: true`, then runs steps 1 to 4 below and the
**Rejected generation-ref protocol**, converging Claim on a loss exactly as they describe. Only a
422 from the refs API counts as a rejection, and it runs the protocol at most three times. Claude
Code cloud's proxy refuses that API outright, so on any other refusal it pushes the ref with a
create-only lease from the current directory when that is a checkout of the repository. Only a
push that creates the ref is a win: a lease refusal, or a push git accepts because the ref already
exists at that commit, is a rejection too. It exits 0 on a win, 3 on a loss or an unclaimable
visit, 4 when the issue is held in your name but the ref could not be created, and 1 on a failure,
and prints one line with the generation, the ref, and the path of a JSON file holding the
settlement and replay. On exit 4 the claim is yours and nobody else will take it until it goes
stale, but don't work until the ref exists. Rerun the same command with `--resume` to retry it: it
skips the claim writes, refuses unless replay shows your session holding the active generation, and
then creates the ref exactly as above. Don't create the ref by hand; if `--resume` can't either,
report the held claim to the steward. `--resume` is only for the exit-4 `held-without-ref` case,
when the ref doesn't exist yet. It reads an existing ref as a disagreement and exits 1 with "do
not work or review", even for the session that holds the generation (where the ref can't be
created at all, as in Claude Code cloud outside a checkout, it exits 4 again instead), so don't
rerun it after it has created the ref or use it to reload a claim you already hold. When you can't
tell whether an earlier run created the ref, read the ref first and run `--resume` only if it is
missing: `gh api repos/<owner>/<repo>/git/ref/heads/claude/<issue|review>-<n>-<generation>`, where
only a 404 means missing. If it exists and you never saw that run exit 0, or its `--out` file
record `outcome: won`, treat it as the disagreement: don't work, and report the held claim to the
steward.
The rest of this section is what it does, and the procedure under Linear.

No tracker write here is compare-and-swap, so two agents can both set `In progress`. Don't pretend otherwise — resolve it instead.

Each visit to a claimable unheld state has one activated generation in a predecessor chain.
A cooperative transition has three ordered writes:

1. Append a pending cycle intent with the selected generation as predecessor, or `root` for a
   fresh chain or legacy repair.
2. Change Queue to `Ready` or `Needs review`.
3. Append an activation naming that intent.

A pending intent is never authoritative. A writer that crashes before Queue leaves the current
visit unchanged. A writer that crashes after Queue leaves a visible
`transition.status: "incomplete"` result that is not claimable until an unheld repair completes
all three writes. Among sibling intents, the earliest server-ordered activation wins. A delayed
activation for another sibling cannot replace a generation that already has a holder.

Under GitHub, post
`"$comment_prefix <!-- claim-cycle:<unheld-state>:<predecessor-or-root> -->"`, use its numeric server-created
comment ID as the candidate generation, change Queue with
`"${issue_fields_command[@]}" set --profile "$profile" --issue "$issue" --value "queue=<unheld-state>"`, then post
`"$comment_prefix <!-- claim-cycle-activate:<generation> -->"`. Under Linear, render and post
`--kind claim-cycle --state <unheld-state> --predecessor <generation-or-root>`, change Queue,
then render and post `--kind claim-cycle-activate --generation <candidate-generation>`.
Never activate before the Queue write succeeds.

The GitHub attribution prefix is part of the supported write shape. Nothing else may precede
or follow the marker; marker-only comments remain readable as legacy history. Write only the
profile's `comment_prefix`. `claim-replay` reads protocol comments that start with either known
agent prefix, `[Agent]` or the retired `[Cursor]`, as attributed history whichever one the
profile names, so generations opened before the profile moved to `[Agent]` keep replaying and a
session that read `[Cursor]` before the change still replays `[Agent]` comments.

GitHub replay is executable, not prose. Fetch all issue comments with numeric `databaseId`,
`createdAt`, `updatedAt`, and `body`, add the current Claim field as `claim_projection` in a
`github-claim-comments-v1` input, and run:

```json
{
  "format": "github-claim-comments-v1",
  "claim_projection": "current field value or empty string",
  "comments": [
    {
      "databaseId": 123,
      "createdAt": "server timestamp",
      "updatedAt": "server timestamp",
      "body": "complete comment body"
    }
  ]
}
```

```bash
<claim-skill-dir>/claim-replay github --input "$comments_file" \
  --queue-state "$queue_state" --comment-prefix "$comment_prefix" --json
```

The shared helper sorts equal times by numeric comment ID, validates the two-phase predecessor
chain, and audits the Claim projection. Linear's `linear-adapter comments` validates its
pagination and event envelope, then passes the same backend-neutral records through that helper;
pass the live Queue value with `--queue-state`. Both paths reject missing predecessors,
activations before their intent, malformed or duplicate records, and markers or Claim events
that predate activation.

This guarantee covers cooperative Queue writers only. Direct human Queue changes are unsupported:
humans record decisions and a steward performs the protocol transition. A manual or interrupted
re-entry stays unsupported until a steward repairs it while it is unheld by appending an intent,
writing the current unheld Queue value, and activating the intent. Racing repairs converge on the
earliest activation. A generation with any scoped Claim set or clear is already visited, so moving
from `Waiting for input` back to `Ready`, or re-exposing `Needs review`, cannot silently reuse it.
Legacy or corrupt history uses activated `root` repair candidates. A malformed pre-root prefix, or
any other strict failure before an activated root, may be fenced only by
`claim-replay github --recover-root`; malformed selected-root or post-root
history stays fatal until a newer valid root repair creates a boundary. Never append a repair
directly inside `In progress` or `Under review`: reconstruct held work through its unheld precursor,
`Ready` or `Needs review`, and then run the ordinary claim protocol.

Before claiming, require `transition.claimable: true` from replay. A missing activation, a
generation for the wrong unheld state, a visited generation exposed again, or a current marker
without that generation fails closed. Markers before a repaired boundary belong to prior history.

1. Under GitHub, comment `"$comment_prefix <!-- claim:<session-id>:<state>:<generation> -->"` on the issue, where `<state>` is the state you're moving it into — `In progress` to work it, `Under review` to review it. Under Linear, render the comment input with `<stewardship-skill-dir>/linear-adapter event --profile "$profile" --issue-id "$issue_id" --kind claim-marker --session "$session" --state "$state" --generation "$generation" --json`, then pass its `.input` unchanged to `commentCreate`.
2. Set Queue to that held state and append a scoped Claim event. Under GitHub, set Queue through `"${issue_fields_command[@]}"`, post `"$comment_prefix <!-- claim-set:<session-id>:<state>:<generation> -->"`, then project the session with `"${issue_fields_command[@]}" set --profile "$profile" --issue "$issue" --value "claim=<session-id>"`. Under Linear, render `--kind claim --value "$session" --state "$state" --generation "$generation"` and pass its `.input` to `commentCreate`.
3. Re-read through the same executable replay path with the current held Queue state, then let `task-queue` settle the tie. GitHub runs `claim-replay github`; Linear fetches the complete comment page chain and runs `linear-adapter comments --queue-state "$queue_state"`. The selected `generation`, scoped `claim`, and `markers` outputs are authoritative. The GitHub Claim custom field is a projection/cache because its value cannot carry a generation atomically; apply replay's `projection` repair when `write` is true. Write a scenario JSON with the issue number, your session as `caller`, the target state, the scoped Claim event object or `null`, the active generation's `id`, current ISO timestamp, `stale_after_seconds: 14400`, and every claim marker as `{session,state,generation,created_at,order}` (where `order` is the stable chronological position). Then run:

   ```
   task-queue settle --scenario <file> --json
   ```

   The executable owns the rules: only markers for the target state and active generation enter the tie; a marker is ignored only when it is both stale and unbacked; earliest timestamp and then stable comment order wins.

   **Always converge Claim to `desired_claim_event` when `write_claim` is true**, whether your outcome is `won` or `lost`. Under GitHub, post `"$comment_prefix <!-- claim-set:<session-id>:<state>:<generation> -->"` from that object and project its value through `"${issue_fields_command[@]}"`. Under Linear, render the object's value, state, and generation through the event writer. A loser clearing its own late write can erase the winner's projection; appending the scoped winner event restores authority. **Never change `Queue` on a loss.**

   **Won?** Go to step 4.

   **Lost?** Pick something else. Don't re-pick this issue: the board hasn't changed and `task-queue` is deterministic, so you'd be handed it again.
4. Create the ref for the state and generation you claimed: `claude/issue-<N>-<generation>` to work it, `claude/review-<N>-<generation>` to review it. Creating a ref is genuinely atomic — racers sharing a generation derive the same name, while a later cycle gets a fresh lock. If creation is rejected, run the protocol below.

### Rejected generation-ref protocol

A rejected generation ref does not establish who won. Fresh-read Queue, the active generation,
the authoritative scoped Claim, every marker, and whether the deterministic ref exists, then
rerun `<claim-skill-dir>/task-queue settle` from that fresh snapshot. Do not invent or require a
ref owner.

If fresh settlement names another winner, converge Claim to `desired_claim_event` when required
and take the normal loss path: leave Queue unchanged, do not work or review, refresh the complete
inputs, and select again.

If fresh settlement still names the caller and the ref exists, authority and the ref disagree.
Fail closed: do not change Claim or Queue, do not work or review, report the disagreement, and
monitor until a fresh read and settlement recover agreement.

If fresh settlement still names the caller and the ref does not exist, retry atomic creation of
the same deterministic ref. Another rejection restarts this protocol from a fresh read.

**Why a reviewer creates a different ref.** A review claim uses the `review` prefix and its active generation, while work uses `issue` and its active generation. Each lock is a pure function of issue, state class, and generation. The reviewer still commits to the PR's own branch; this ref is only the atomic lock.

**Why a loser writes the winner and never reverts `Queue`.** Both contenders write the same Queue value, so it is already right. Claim is different: a rival can append its own value after the winner settled, then discover it lost. Appending `desired_claim_event` restores the winner for that generation. Reverting Queue to `Ready` would also release the files of active work. The executable and its interleaving suite enforce both halves.

**Why the tie is read this way, and what it still costs.** The filter has to ignore dead markers without ignoring live ones. Keying it on the active Claim event alone can't: at most one marker would survive and "the earliest wins" would become latest-write-wins. So the filter needs both halves, and a marker minutes old is never ignored however the active Claim event reads.

What remains is a state the board can reach and no rule here undoes on its own. A claimant that dies at step 1 leaves a marker that keeps winning ties, and the next agent to try will have moved `Queue` into a held state at step 2 before losing to it. The issue is then in flight, holding its files, with no authoritative Claim event and nobody working — until the stale window passes and someone reclaims it. That is worse than the wasted picks it replaced, and it is still the right trade, because the alternative is a loser reverting `Queue` out from under a live winner.

What makes it survivable is that it is **visible**: replay exposes no active Claim event and the field projection can be repaired to empty. An issue in that shape is waiting for the reclaim rule below, not for another ordinary claimant.

**The marker goes first, and the lock name uses only protocol identity.** Dying after step 1 leaves a marker the stale half of the tie-break can clear. Dying after the held-state write with no marker would leave a lock with no clock. Issue number and generation are shared protocol values, unlike a caller-invented slug, so all racers derive one valid ref.

## Finishing, and review

Under GitHub, hand off with one command once the draft PRs are pushed:

```bash
<claim-task-skill-dir>/task-queue handoff <issue> --pr <number> --profile "$profile" \
  --session <session-identity> --note-file <file> --touches "<paths>"
```

Repeat `--pr` for every PR in the stack. It refuses unless replay shows your session holding the
active `In progress` generation and every PR is open and either names the issue (a closing keyword
or a `claude/issue-<N>` or `claude/work-issue-<N>` branch) or is stacked on or under a PR in the
list that does. It then writes
`Touches` (omit `--touches` to leave them, pass `""` to clear them), posts the note with the
profile's prefix, and runs the clear, intent, Queue write, activation and projection clear
described next, in that order. It ends with a replay that must show an unheld, claimable `Needs
review` visit, and prints one line with the new generation and the path of its JSON file.

Open the PR as a draft, then append `"$comment_prefix <!-- claim-clear:<state>:<generation> -->"` for the work
visit under GitHub, or render a Linear Claim event with the work state, work generation, and empty
value. Append the pending review intent from the active predecessor, set `Queue: Needs review`,
then append its activation. Only the earliest activated sibling becomes the next review
generation. Clear the GitHub Claim projection after the scoped clear. A delayed work clear remains
scoped to the old work generation, so it cannot erase a reviewer in the new generation. **Don't
review your own work** — leave it and pick something else.

Under GitHub, clear that projection with
`"${issue_fields_command[@]}" clear --profile "$profile" --issue "$issue" --field claim`; never clear the
whole values collection or pass a raw field ID.

The scoped clear and the state say different necessary things: the old work visit has no holder, and the issue is ready for a reviewer. The field projection should be empty in `Needs review`, but a delayed projection write never changes authority; replay of the selected review generation repairs it.

Reviewing is a claim like any other, and "like any other" means **run all four steps above** with
`Under review` as the `<state>`. Pass the complete normalized live issue set to
`<claim-skill-dir>/task-queue next --queue "Needs review" --reviewer <review-session-identity> --runtime <cloud|local>` and
claim only its selected issue, then run the review. Before selection, include the live
`stack_ancestors` derived from PR owners, normalized `implementation_authors`, and `runtime_target`; the executable
derives self-review exclusion by exact membership and caller-supplied `review_excluded` is ignored.
A review nobody has claimed holds no files against another review pick; a claimed one
(`Under review`) still does. Each review commits only to its own PR branch, so overlapping reviews
collide at merge rather than in a shared tree. Two reviewers picking from the same snapshot can
therefore each claim one of two overlapping issues; accept that, since the cost is a merge
conflict. Stack ancestry still keeps a descendant behind its bottom owner. The exclusion also prevents self-review. `In progress`, `Under review` and
`Ready to merge` keep their locks, and the executable applies the same blocker, priority, and
tie-break rules as the default `Ready` selection. During
active stack continuation, `--prefer <issue>` may put the next owner first only when its normalized
record is fully eligible; otherwise the command falls back to canonical priority order. Skipping
the marker is what makes the next paragraph false.

The `<state>` in the marker is what keeps this honest: your tie is with other reviewers, not with the agent who did the work and whose `In progress` marker has been on the issue since it started. And a lost review claim leaves `Queue` alone like any other, because the winner is moving it to `Under review` too. Putting it back to `Needs review` would be worse here than on the work path: that state is the unlocked pool, so it advertises a live reviewer's issue as free.

**Reviewing and fixing are one claim, not two.** The reviewer runs the whole loop — review, address the findings, re-review — until a round comes back clean, then appends a scoped clear for the review generation, sets `Ready to merge`, and clears the field projection. That's why there's no `Changes requested` state: "the reviewer found something" is the exit condition of a round, handled inside the loop, and no other agent ever needs to see it. A state nothing rests in is noise on the board.

If the reviewing session dies mid-loop the issue sits at `Under review` and the stale-claim rule below takes it. That rule covers the two states an agent holds while working, `In progress` and `Under review`, and only those. `Needs review` recovers differently — it is nobody's claim, so the next reviewer simply takes it from the pool — and `Ready to merge` deliberately recovers not at all, because it is waiting on a human rather than stalled.

## Reclaiming a dead task

Containers die mid-task and leave held work behind. Stewardship determines inactivity from
observable tracker, session, PR, worktree, and process activity. Fresh activity in any source
within two hours preserves the current Claim and generation. Missing visibility is reported but
does not count as activity. A Claim under an unanswered `Needs a person:` comment on its owner
issue is never released this way: `steward-task-queue` section 7 owns that exemption.

After more than two hours with no activity in any observable source, do not claim within the dead
held generation. Clear its scoped Claim and reconstruct through an unheld precursor:

- with implementation evidence, append and activate a fresh `Needs review` generation;
- without implementation evidence, append and activate a fresh `Ready` generation.

An issue-owned PR, corroborated branch or worktree, or associated local diff is implementation
evidence. Every recovery uses intent, Queue write, activation, complete reread, and strict replay, or
`--recover-root` replay on history a root repair already fenced.
The next worker or reviewer then claims normally and `task-queue settle` arbitrates its generation.
Settlement does not establish inactivity.

If a `Needs review` record has an existing PR but implementation authorship cannot be recovered,
do not fabricate `implementation_authors`. Preserve its locks during repair, return it through a
fresh `Ready` generation, and let a worker adopt or verify the existing PR before creating a
truthful `Needs review` handoff.

## Writing `Touches` well

This is where the system is won or lost, and it's a triage job rather than something you can infer while working.

GitHub writes the configured text field. Linear passes every current path with repeated
`--touch` arguments to `<stewardship-skill-dir>/linear-adapter event --kind touches`; use
`--empty-touches` for an intentional empty array. The latest valid event in server order is
authoritative.

**Name files, not directories, wherever you can.** Two issues in `scripts/checks/rules/` editing different rule files are genuinely independent. Glob the directory and you invent a collision that serialises work that could have run side by side.

**Don't list docs.** Every PR in a busy repo touches the same changelog or notes section. Put it in `Touches` and nothing ever runs in parallel. Append-only prose conflicts textually and resolves by keeping both paragraphs; source conflicts semantically. Only the second is worth a lock.

**No brace expansion.** `rules/{a,b}.mjs` is read as one literal path and matches nothing. List the two files.

A trailing `/**` or `/*` is stripped, and the rest is matched as a path prefix on segment boundaries — so `packages/core` reaches `packages/core/x.ts` and not `packages/core-web/x.ts`.

## Priority

Priority is set at triage, not by the agent picking work up. If something is unset it sorts last, so forgetting to set one can't promote a task to the front.

What decides it, roughly in the order it applies: what unblocks the most goes first; a narrow `Touches` beats a broad one, because a broad one stops everything else; a check that's green but blind outranks new surface; a decision outranks the code it gates; anything with a real expiry outranks anything without one.

Four buckets can't express a full sequence, and that's accepted rather than overlooked. The dependency graph carries the important half — "what unblocks the most goes first" *is* the `Blocked by issue` edges, and those are enforced hard, so what priority decides is only the order among issues that are all genuinely pickable right now. Getting that order wrong costs throughput, not correctness.
