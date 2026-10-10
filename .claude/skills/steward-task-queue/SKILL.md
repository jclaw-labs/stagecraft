---
name: steward-task-queue
description: Use when continuously triaging or monitoring a repository task queue backed by GitHub Issues or Linear, especially when maintaining Ready supply, auditing held work, reconciling reviews, or protecting stale-looking claims.
---

# Steward a task queue

Keep the queue truthful before keeping it full. Each tick starts from live tracker and
implementation state, uses the shared queue rules, makes only supported corrections, and
schedules the next tick only after the current one completes.

## References

- Profile contract: [profile.schema.json](profile.schema.json)
- Owner-wide GitHub Issues profile, used by every `jclaw-labs` repository including local-config: [profiles/owners/jclaw-labs.json](profiles/owners/jclaw-labs.json)
- Linear profile: [profiles/example-linear.json](profiles/example-linear.json)
- Substack Linear profile: [profiles/substackinc--substack.json](profiles/substackinc--substack.json)

## Ordered workflow

### 1. Resolve and validate the profile

Derive `<skill-dir>` from the path used to read `SKILL.md`; do not assume the current
working directory.

Use the profile path selected by the user. Otherwise resolve it with the sibling resolver, run
from the repository being stewarded:

```bash
profile="$(<skill-dir>/resolve-profile --output "$(mktemp)")"
```

It reads the `origin` remote as `owner/repository` (pass `--repository owner/repository` to
override) and prefers `profiles/<owner>--<repository>.json` beside this file. With no
repository-specific profile it instantiates the owner-wide `profiles/owners/<owner>.json` for
that repository, so every `jclaw-labs` repository resolves to GitHub Issues without a file of
its own. An owner-wide profile is a template and fails validation until it is resolved.

Run the sibling validator by that explicit path before any tracker read:

```bash
<skill-dir>/validate-profile "$profile"
```

Stop before tracker access if resolution or validation fails. Report the profile path and
validation error; do not infer missing mappings or capabilities. Before accepting a profile,
the validator also runs the sibling dependency-free schema checker. That checker implements
and audits every assertion keyword used by this bundled schema, including `oneOf` and
`additionalProperties`; it is not a general-purpose Draft 2020-12 implementation.

#### Cursor Cloud GitHub credential

In Cursor Cloud, disable shell tracing before expanding
`GH_JCLAW_LABS_ISSUE_TOKEN`, then guard each GitHub tracker request without terminating
independent work:

```bash
set +x
api_version="$(jq -er '.tracker.api_version' "$profile")"
github_queue_api() {
  set +x
  if [ -z "${GH_JCLAW_LABS_ISSUE_TOKEN:-}" ]; then
    printf '%s\n' 'github_queue_api: GH_JCLAW_LABS_ISSUE_TOKEN is required for GitHub queue traffic' >&2
    return 64
  fi
  GH_TOKEN="$GH_JCLAW_LABS_ISSUE_TOKEN" gh api -H "X-GitHub-Api-Version: $api_version" "$@"
}
```

The helper derives the API version from the validated profile and is the executable form of
`GH_TOKEN="$GH_JCLAW_LABS_ISSUE_TOKEN" gh api -H "X-GitHub-Api-Version: $api_version" ...`. Route
every Cursor Cloud GitHub queue read and write through `github_queue_api`; this includes
every GitHub queue API read and write. Cursor Cloud agents must not invoke provider operations such as
`list_issue_fields` or `list_issues`, because those provider tools cannot inherit this
command-scoped shell credential. Never print, trace, or persist the secret. If the secret is
missing, stop issue-side GitHub traffic for this tick; do not fall back to ambient `gh`
authentication, `GITHUB_TOKEN`, or another credential. Report the issue capability gap, continue
independent Git and PR probes, and recheck at the next stewardship tick. Classify a rejected
operation by the capability and throttle rules under Backend operations rather than treating every
`403` as loss of every queue capability.

This is only for GitHub queue traffic; local agents keep their existing authentication, and the
secret does not apply to Linear, git transport, branch pushes, or pull-request tools.

For a GitHub profile, retain the validated attribution for every comment write and replay:

```bash
comment_prefix="$(jq -er '.writes.comment_prefix' "$profile")"
```

For a Linear profile, inspect `writes.mutation_capability` before planning a write. A supported
profile explicitly acknowledges `cooperative-immutable-event-writers` and that hard-delete
detection is unsupported. It also requires `steward-only-two-phase` Queue transitions. If the
profile reports `supported: false`, or the environment cannot guarantee that every event-capable
integration follows both policies, report **Linear mutations unsupported** and perform no Linear
mutation. Read-only audit and normalization may continue.

### 2. Load the shared queue rules and backend protocol

Read `claim-task/SKILL.md`, then locate its sibling `task-queue` executable. `claim-task`
owns queue eligibility, file locking, and claim settlement. This stewardship workflow owns the
two-hour observable-activity decision described below; settlement only arbitrates contenders
after a claimable generation exists. Run the executable instead of reimplementing eligibility or
settlement.

Use `claim-task`'s existing GitHub custom-field preflight only for a GitHub profile. For
Linear, use the profile's `linear-profile` preflight: fetch the configured workflow states
and run the sibling `linear-adapter statuses` command before the first mutation. The profile
explicitly maps claim markers, current Claim, and Touches from its comment event log into
`task-queue settle`. It maps pending `claim-cycle` intents and their
`claim-cycle-activate` commits to work or review generations; never treat a missing GitHub field
as a Linear capability check.

Pass `linear-adapter statuses` `{ "complete": true, "nodes": [...] }` with each configured
state's `id`, `name`, `type`, `team.id`, `team.key`, and `team.name`. It verifies the state
fields against the profile's canonical meaning and explicitly configured live name, and verifies
the full team identity against `tracker.team_id`, `tracker.team_key`, and `tracker.team_name`.

```bash
<skill-dir>/linear-adapter statuses --profile "$profile" --input "$states_file" --json
```

### 3. Fetch the complete live inputs

For GitHub, fetch the complete paginated REST-open issue set before any issue-field query. Exclude
pull requests returned by the issues endpoint. REST-open membership is the authoritative graph
boundary: GraphQL only enriches those issue numbers with queue fields, comments, blockers, and
implementation links. A GraphQL issue absent from REST-open membership cannot block work, hold
`Touches`, or count toward supply. Incomplete REST pagination fails the snapshot.

For Linear, fetch every open tracker item in profile scope and every comment page with `includeArchived:
true`, `orderBy: createdAt`, and each node's `archivedAt`, preserving the API's descending
server order and each request's `after` cursor. For a Linear profile whose
`project_id` is non-null, fetch all project items and then follow every incoming
`inverseRelations` edge whose native type is `blocks` to fetch each referenced same-team open
blocker, including blockers outside the configured project. Fetch every open
implementation change in scope, including
its owner item, head revision, review state, merge state, CI results, and complete changed-file
list. For review selection, also fetch each implementation's author or session identities and the
current review session identity. Also fetch merged changes needed to reconcile still-open owner
items.

Use available session transcripts, worktrees, processes, local diffs, and recent tracker
activity when checking whether a holder is still alive. Missing local visibility is an
unknown, not evidence of abandonment.

### 4. Normalize once

Produce the input shape documented by `task-queue`:

```json
{
  "number": 42,
  "title": "Describe the work",
  "queue": "Ready",
  "priority": "High",
  "claim": "",
  "blocked_by": [17],
  "stack_ancestors": [],
  "implementation_authors": ["worker-session"],
  "open_prs": [],
  "normalization_error": null,
  "touches": ["path/to/file"]
}
```

For GitHub Issues, `number` is the issue number. For Linear, restrict project work and every
mutation to `tracker.team_key`; when `tracker.project_id` is non-null, additionally restrict
project-work fetches and mutations to that project. Add every fetched same-team open blocker
outside the project to the normalized input with `"context_only": true`. A context-only item
exists only to keep the dependency graph closed: never value-triage, mutate, audit as project
work, or select it. An unresolved blocker reference or an other-team blocker fails closed and
holds its dependent item back; do not treat either as absent or closed. Use the positive numeric
suffix from the configured team's identifier. Split GitHub text fields such as blockers and
touches on whitespace as `claim-task` requires. Pass all GitHub cycle intents, activations,
markers, `claim-set`, and `claim-clear` comments through the claim skill's sibling
`claim-replay github` executable with the live Queue value; normalize Claim from the active visit
and apply its projection audit. Resolve Linear statuses, native priorities,
incoming `blocks` relations, and queue metadata through the profile's stable mappings. Run
`linear-adapter blockers` on each GraphQL-shaped issue response and `linear-adapter comments`
on each cursor-linked comment page aggregate; use the latter's active generation, scoped Claim,
Touches, generations, and marker array rather than interpreting comments again in prose.

Fill `open_prs` on every record, in-flight ones included, with the open PR numbers that implement
that issue, matched by the closing-keyword and head-branch rule `claim-task` gives. Under Linear,
match by head branch only, since a `#n` in a PR body names a GitHub issue. `next` warns about a `Ready` issue that already has an open
PR. Treat that warning as a stewardship finding: the issue's work is on a live branch, so find out
whether that PR should be adopted, verified, or moved along with its owner rather than implemented
again.

On a record-local replay or authorship failure, retain the issue in the complete input with a
nonempty `normalization_error` and preserve its live Queue and exact `Touches`, blockers, and stack
ancestry while repair runs; do not infer Claim, generation, markers, or implementation authorship
from the failed source. `task-queue` keeps that record ineligible and its files locked during the
repair, while valid siblings remain selectable.

Fail the whole normalized snapshot on incomplete pagination or tracker coverage, duplicate JSON
object keys, duplicate issue numbers, invalid normalized field types, unresolved blocker identity,
other-team blockers, or a stack cycle. A strict per-issue `claim-replay` or `linear-adapter
comments` error is an immediate queue-integrity repair for that issue, not permission to weaken
validation or discard the rest of a complete snapshot.

Repair every parser error or incomplete visit in `Ready`, `Needs review`, `In progress`, or
`Under review` before using the item as supply:

1. Run strict replay first. On GitHub, `task-queue` already retries any strict failure once with
   `claim-replay github --recover-root`, so a replay error it reports means recovery failed too,
   except `cannot read the comments of #<n>`, a read failure to retry rather than repair. When you
   ran `claim-replay github` yourself, rerun it with `--recover-root` after a strict failure.
   On Linear, run the backend recovery yourself after a parser failure:
   `linear-adapter comments --recover-root` for Linear. Only the executable may fence a malformed
   pre-root prefix. A recovery that succeeds with `transition.status` `ready` or `held` is the
   issue's verified repair: count it as supply and skip steps 2-5. Any other status, such as
   `incomplete`, still needs the repair from step 2 on, replayed with `--recover-root`.
2. If replay establishes a trusted activated predecessor, append a successor intent, write its
   unheld Queue state, append activation, and replay. The earliest activated sibling wins.
3. If no predecessor is trustworthy, append and activate a root repair. A selected-root or
   post-root malformed record remains fatal; only a newer valid root repair may fence it.
4. Rebuild held work through its unheld precursor: a fresh `Ready` visit for `In progress`, or a
   fresh `Needs review` visit for `Under review`. Never fabricate a held generation. If the
   activity policy preserves the holder, use the ordinary marker, held Queue write, settlement,
   and winner projection from that verified unheld visit.
5. End with a complete reread and strict replay, or the root recovery step 1 accepts when the
   repair fences earlier history. Require Queue, transition, Claim projection, and
   sibling fields to match the winner. Keep locks and report the fatal defect if repair cannot be
   verified.

For every `Needs review` record, normalize the fresh implementation identities into a unique,
nonempty `implementation_authors` array of session tokens: each is nonempty and contains no colon,
ASCII whitespace, `<`, or `>`. Pass the validated current review session token to
`<claim-skill-dir>/task-queue next --queue "Needs review" --reviewer <review-session-identity> --runtime <cloud|local>`,
with each record's `runtime_target` normalized and `--runtime` taken from the authoritative
source exactly as `review-task-queue` describes.
The executable derives self-review exclusion by exact membership; caller-supplied
`review_excluded` is ignored. Missing or malformed authorship becomes a record-local
`normalization_error`; duplicate-key input fails the whole snapshot. Do not fabricate
`implementation_authors`. Preserve the owner's locks during repair, then move it through a fresh
`Ready` generation so a worker can adopt or verify the existing PR and later create a truthful
`Needs review` handoff. Exclusion changes review eligibility, not file ownership.

An owner PR whose agent context block `agent-provenance body-record` cannot read keeps a
record-local `normalization_error` and its locks. No transform rewrites a missing or malformed
block, and an existing PR never gains creation context afterwards, so neither is repairable here.
Leave that record in `Needs review` and report it on every tick as a decision for the user, naming
the PR and quoting the `body-record` error, rather than starting a replacement or a rewrite.

```bash
<claim-skill-dir>/claim-replay github --input "$comments_file" \
  --queue-state "$queue_state" --comment-prefix "$comment_prefix" --json
<skill-dir>/linear-adapter blockers --profile "$profile" --input "$issue_file" --json
<skill-dir>/linear-adapter comments --profile "$profile" --input "$comments_file" \
  --queue-state "$queue_state" --json
```

The blocker input includes the issue's `id`, `identifier`, `team`, and one complete
`inverseRelations` connection whose `pageInfo.hasPreviousPage` and `pageInfo.hasNextPage` are
both false. A first, middle, or final partial page is not a complete history and fails closed.
The comments input is a `linear-comment-pages-v1` object with `includeArchived: true`,
`orderBy: "createdAt"`, and a nonempty `pages` array. Each page records the request's `after`
cursor, the raw `nodes`, and all four `pageInfo` fields. The first page uses `after: null`,
each later page's `after` equals the prior `endCursor`, and only the final page has
`hasNextPage: false`. `hasPreviousPage` must be a boolean but is not completeness evidence for
a forward traversal and may remain false on every page. Raw first, middle, or final pages and
contradictory forward cursors or `hasNextPage` flags fail closed.
Each node includes `id`, `body`, `createdAt`, `updatedAt`, and `archivedAt`.

Write the normalized full open-item set to a temporary file and run:

```bash
task-queue next --issues "$issues_file" --json
```

For a GitHub profile, `<claim-skill-dir>/task-queue snapshot --profile "$profile"` performs the
GitHub half of section 3 and this normalization for `Ready` selection, under the Cursor Cloud
credential contract, and runs `next`. Its JSON file carries each replay's `transition` for the
Effective Ready count, every open PR with its owners and changed files, and each failed replay
as that record's `normalization_error`. A replay that succeeded only through root recovery
carries `recovery` (fenced comment IDs, root generation and activation). When its `transition`
is `ready` or `held`, count it as supply, since the root is already its verified repair, and
report it as an audit note once, when it first appears or its root changes, rather than
repairing it again; any other transition still needs step 1's repair. It repairs nothing and
does not fetch merged changes, CI, or review-selection fields, so those audits still read the
tracker directly.

Treat warnings as audit findings. Do not read past malformed snapshot data or mutate an issue
whose record-local normalization failed.

### 5. Run a full first tick, then the tick contract

The first tick is always a full audit. Ignore handoff counts, cached blocker status, profile
hints, and earlier monitor output.

Every tick:

1. Probe each previously unavailable capability once under the Backend operations recheck
   contract, then process its deferred work immediately if it recovered.
2. Refresh every open item and open implementation change with changed files.
3. Normalize the full item set and run `task-queue`.
4. Repair queue-integrity defects, then recompute durable blockers and live `Touches` collisions.
5. Process every item with an unset queue or `Triage`.
6. Audit held states, `Ready to merge` handoffs, merged changes, stale claims, and
   implementation changes with no represented owner item.
7. Recheck the profile's `ready_audit_batch` oldest Ready items whose value review is no
   longer recent.
8. Apply supported corrections and finish value-triaging the current candidates.
9. After repairs and current claims, count Total Ready, Nominal Ready, and Effective Ready from
   the active backend's authoritative open set: REST-open GitHub issues or open in-scope Linear
   items. **Total Ready** is every record in that set with live Queue `Ready`; **Nominal Ready** is
   the Total Ready subset that `task-queue` marks eligible; **Effective Ready** is the Nominal Ready
   subset whose replay has `transition.status == "ready"` and
   `transition.claimable == true`. Effective Ready drives refill.
10. When Effective Ready is below `target_minimum`, inspect the highest-impact lock holders first,
   then select unblocked candidates in the queue's existing priority order and promote candidates
   that pass the value test until Effective Ready reaches `target_maximum` or no eligible
   candidate remains. Report a shortfall only after repairs and valuable candidates are exhausted.
11. Report each mutation, then re-arm the cadence.

### 6. Apply the value test before Ready

An item may enter or remain Ready only when all five checks pass:

1. The problem is still present on the current default branch, and no other open item or open
   change already covers it: it is not a duplicate.
2. It causes concrete current or recurring harm or cost, reproduced or cited rather than assumed.
3. The proposed behavior is desirable.
4. The benefit justifies implementation and maintenance cost.
5. Acceptance and verification criteria are concrete and credible.

Run the test on every move into `Ready`, not only refill. There are three routes in, and each one
gets a fresh test against live state:

- **New triage:** an unset-queue or `Triage` item (section 5 step 5), a refill candidate (step
  10), or an item a person has answered in `Waiting for input`.
- **An umbrella owner going back to `Ready`** after one of its items ships (section 8's umbrella
  reconciliation). Test what is left: the remaining items, not the umbrella as first filed.
- **A cleared blocker:** an item that becomes eligible because its blocker closed, whether it
  waited in triage or already sat in `Ready` (a blocker makes an item ineligible without changing
  its Queue). The blocker's change may have fixed it, made it a duplicate, or changed what it
  should ask for, so test it before it counts toward Effective Ready.

An item that fails gets one of three outcomes, never a silent `Ready`:

- **Narrow it** when part of it passes: rewrite the body to the part that does, with its own
  acceptance criteria, and test that part.
- **Route it to `Waiting for input`** when only a person can settle the failing check, such as a
  product choice or whether the cost is worth it. Record the exact question and its alternatives.
- **Close it** otherwise. Close completed work and duplicates with the matching supported
  resolution. Close preferences, one-off friction, speculative hardening, cosmetic cleanup,
  implausible mutations, and negative-value maintenance as not planned when the backend supports
  it.

The configured Ready minimum is the critical-shortfall threshold, not the refill trigger.
Replenish whenever supply is below `target_minimum`, stopping at `target_maximum`. Maintain that
supply only with items that pass the value test; never create, split, or promote weak work to
improve the count. If eligible candidates run out before the target range is reached, report the
shortfall and leave the truthful lower count in place.
Before every transition into `Ready`, append a pending work-cycle intent through the selected
backend, change Queue, then append its activation. Re-read through executable replay and use only
the earliest activated sibling for the active predecessor. Re-entering Ready starts a new
generation. A fresh or legacy issue uses a root intent. A pending intent is not authority, and a
manual or interrupted re-entry is unsupported and unclaimable until an unheld repair repeats the
three-step transition.

### 7. Protect stale-looking claims

Only `In progress` and `Under review` carry a nonempty Claim. On every tick, check observable
activity in tracker, session, PR, worktree, or process sources. Fresh activity in any source
within two hours preserves the Claim and locks. Missing visibility is a reportable gap, not fresh
activity.

After more than two hours with no activity in any observable source, release the held visit
through the generation protocol. If implementation evidence exists, clear the scoped Claim and
create a fresh `Needs review` generation. If no implementation exists, clear it and create a
fresh `Ready` generation. An issue-owned PR, corroborated branch or worktree, or associated local
diff is implementation evidence. Never move directly from one held generation to another and
never invent authority. `task-queue settle` arbitrates claims; it does not decide inactivity.

A Claim whose owner issue carries a `Needs a person:` comment that no person has answered is
exempt from this release, whatever its activity: only a person's answer can release it. Keep its
Claim and locks, and name the issue in every report until a person answers. Once a person answers,
release the held visit to the generation their answer names (`Ready` for remaining work, `Needs
review`, or closed), not by the evidence rule above. Release it on the tick that sees the answer,
even though the answer is itself fresh activity. This is the one rule for such a Claim; the role
skills and `claim-task` point here.

For Linear settlement, use `<skill-dir>/linear-adapter event` to render a `claim` event with an
empty value for the active held generation and pass its `.input` unchanged to `commentCreate`.
Render the fresh `Ready` or `Needs review` intent with that generation as its predecessor, write
Queue, then render its activation. Re-fetch the complete comment page chain and verify the new
unheld generation through `linear-adapter comments --queue-state "$queue_state"`. The next ordinary
claim settles only inside that fresh generation by feeding its validated generation and `markers`
to `task-queue settle`. Converge Claim with another rendered `claim` event; never hand-construct an
envelope, edit an earlier event, or delete one.

### 8. Verify held states and review coverage

Everything from `In progress` through `Ready to merge` holds its touched files. Check that:

- `In progress` and `Under review` have the right holder metadata.
- `Needs review` and `Ready to merge` have no Claim.
- Every implementation change maps to an owner item and its live changed files agree with
  `Touches`.
- A merged change closes its owner item and releases its locks.
- `Ready to merge` has an implementation change and a final review of the exact current head.

Reconcile merged changes before refill. For one owner with several PRs, keep the owner open and
derive `Touches` from remaining unmerged work; close it only after the final PR merges. For an
umbrella owner, fresh-read its body and update only the completed item, decided tally, and
governing title suffix, preserving unrelated text; close it only when every item is decided. An
umbrella owner that goes back to `Ready` for its remaining items passes section 6's value test
first, like any other move into `Ready`.

Audit every open PR without an open owner in two classes: **no owner** when no mapping exists, and
**closed owner only** when every mapped owner is closed. Correct only through profile-supported
operations; otherwise report the capability gap. Do not reopen an issue, invent ownership, or
change PR labels.

When Effective Ready is exhausted, rank the highest-impact lock holders by the priority and count
of valuable blocked issues and live file collisions they would release. Use the ranking only to
order investigation; the activity gate and value test remain authoritative.

A commit after the final review invalidates the handoff even when CI is green: append the pending
review intent, move the item back to `Needs review`, then append its activation. If
the implementation change is missing, use the same two-phase sequence for a work-cycle successor
before returning the item to Ready.
Surface deferred findings from capped review as a human decision when no dedicated decision
state exists.

### 9. Revalidate hints and CI exceptions

Profile hints are search leads, not cached truth. Freshly read the referenced tracker item,
change, field, and default branch before using a hint to classify or mutate anything.

Apply a profile CI exception only after the live run matches its recorded condition. A
zero-step GitHub Actions failure caused by an account-level billing block is external: report
it and judge the code from valid local or other evidence. It is not evidence that the
implementation needs rewriting, and it does not authorize spending changes.

`work-task-queue` and `review-task-queue` apply the same exception through the rule below, so
it is written once here.

**Recognizing a billing-blocked job.** The exception is a condition each run has to show, not a
standing fact about the repository. A failed job matches only when both hold on the live run:

- it ran no steps: `repos/{owner}/{repo}/actions/jobs/{job_id}` returns an empty `steps` array,
  usually seconds after it was queued; and
- its check-run annotations (`repos/{owner}/{repo}/check-runs/{check_run_id}/annotations`, where
  the check run's ID is the job's) say the job was not started because recent account payments
  failed or the spending limit needs to be raised.

A job that ran any step, or failed for any other reason, is ordinary CI and gets the usual
failing-set comparison. Once jobs run real steps again, the exception stops applying by itself;
there is nothing to switch off. Outside a profile's CI exception, `deep-review-orchestrate` step 4's
looser zero-step read applies instead.

**What replaces CI for a matching job.** Don't re-run it, root-cause it, or hold a handoff, a
clean stop, or a merge on it. Run the suites that cover the change locally instead, and record
what ran and its result where the CI result would have gone: the PR body's checklist for a worker,
the review response or final report for a reviewer. Name the blocked job and say it never started.
A suite that needs a tool the container lacks gets it installed rather than skipped: local-config's
slot suites need zsh, so a cloud container runs `apt-get install -y zsh` first. When a local
suite already fails on the default branch, compare before and after rather than counting it
against the change.

### 10. Report, then re-arm

For each mutation, report the item, old and new state, and short live-evidence reason. Also
report repairs and replay failures; stale claims recovered and preserved; Total, Nominal, and
Effective Ready against the configured range; merged-owner and umbrella reconciliation;
no-owner and closed-owner-only PR findings; Git/default-branch capability, `gh`/PR capability,
and issue-token capability separately; top lock holders; and external CI conditions. Keep
no-change ticks concise, but always include all three supply counts and integrity failures.

Re-arm only after the tick, writes, and report complete. Prefer a product-native recurring
monitor. Otherwise use an inspectable persistent terminal sleeper. Use the profile's
`cadence_minutes.steward`; never schedule a successor before the current tick finishes.

**A context-limited steward starts no tick.** A tick needs room for a full audit, its repairs and
writes, and the report. When the steward lacks that room, or shows a signal under **Replacing a
heavy queue session** below, it starts no new tick and makes no write. It reports that it stopped
for context, with the last tick's supply counts and open findings, and stops re-arming so a fresh
steward takes the role. A tick cut off mid-write is worse than a skipped one: the next steward's
full first tick finds and repairs a skipped tick's work, but a half-written transition needs a
replay repair first.

## Replacing a heavy queue session

The steward, worker, and reviewer roles all run as long-lived monitors, and each one fills its
context over time. `work-task-queue` and `review-task-queue` stop a context-limited monitor before
a claim, and section 10 stops a context-limited steward before a tick. This section says how
someone outside the session notices, and how the role moves to a fresh session. All three skills
use it.

**Signals.** A session is heavy when it shows any of these: its context has been compacted or
summarized, a turn failed with "prompt too long" or a similar context error, turns are failing or
ending without doing their work, or it is stalled on usage limits. Each is visible from outside
the session, in its transcript or event list, so a session that can't judge its own room still
gets caught.

**Who watches.** Whoever started the queue roles, such as a coordinator session or the user, checks
each role's session about once an hour for those signals and starts the replacement. A role
session that sees a signal in itself stops as its own context-limited rule says, and reports why,
so the watcher has something to act on.

**When to swap.** Only at a quiet point between tasks: the role has no dispatched worker running
and no write half done. A worker or reviewer monitor that holds a Claim finishes or hands off that
task first, through its own handoff or put-down path, and claims nothing new meanwhile. A Claim
held under `Needs a person:` doesn't hold up the swap: section 7 exempts it from the two-hour
release, so the handoff lists it and the old session stops as usual. Never swap
mid-tick or mid-claim to save time: the held Claim names the old session's token, and a fresh
session can't write under it.

**The handoff.** Start the fresh session for the same role and repository with a brief that
carries:

- the role, the repository, and the validated profile path;
- the current state: the last tick's report or selection result, every PR it is waiting on and
  why (a `Ready to merge` handoff waiting on its merge, a stack parent, a blocker), and the
  monitors it has armed;
- each Claim it held and how that task was handed off or put down;
- the standing rules the old session was given beyond the skills, word for word.

The fresh session validates its own session token and starts from its role's section 1 with a full
first tick or fresh live inputs. Nothing in the handoff replaces a live read. Once the fresh session
is running, with its token validated and its monitor armed, the old session ends its subscriptions
and monitors and stops. Two sessions in one role overlap only for that moment.

## Backend operations

| Operation | GitHub Issues | Linear |
|---|---|---|
| Queue | custom field value endpoint | configured workflow status |
| Priority | custom field | native priority |
| Blockers | configured text field | incoming native `blocks` relations |
| Touches / Claim projection | configured fields | append-only comment events |
| Claim authority | scoped `claim-set` / `claim-clear` comments | scoped `claim` events |
| Claim cycles | pending intent + activation comments | pending `claim-cycle` + activation events |
| Claim markers | generation-scoped issue comments | generation-scoped comment events |
| Change files | open PR files | linked implementation PR files |
| Close | supported close reason | terminal update or native duplicate relation |

Use only transports and writes declared by the validated profile. If credentials, local
evidence, or a required mutation capability are unavailable, report the exact gap instead of
routing around it.

For every GitHub field mutation, fresh-read the issue's current field values first. Set one
or more values with `POST` to
`/repos/{owner}/{repo}/issues/{number}/issue-field-values`, using the request body key
`issue_field_values`; this operation has additive semantics and must not be treated as a
replacement of unspecified values. Clear only one configured field with `DELETE` to
`/repos/{owner}/{repo}/issues/{number}/issue-field-values/{field_id}`. Never clear the
collection or an unconfigured field. After either write, re-read and verify the intended field
changed while sibling fields stayed intact; this is the single-field clear or additive-set
readback. Then reread comments and require strict replay, or on fenced history a `--recover-root` replay that
succeeds. A protocol write is an exact marker-only
comment containing only `$comment_prefix` and the generated marker or event envelope. Put any
explanation in a separate attributed comment. If a concurrent repair produced an earlier
activated sibling, accept that winner, converge projections, and do not extend the losing branch.
Use the profile's `2026-03-10` API version when that is the selected profile. Start body
replacements from a fresh-read and use a body file, and leave PR labels unchanged unless governing
instructions allow that write.

Treat org-wide field discovery as optional when the validated profile supplies canonical field
IDs and a live per-item read verifies Queue plus every configured field. A discovery-only `403`
is a reported gap, not loss of operational access. Operational per-item reads, comments, and each
required write still fail closed when unauthorized. Use these pressure fixtures:

- `{"comments":200,"discovery":403,"per_item_read":200,"required_write":200}` → **continue**
- `{"comments":200,"discovery":200,"per_item_read":403,"required_write":200}` → **stop operational work**
- `{"comments":200,"discovery":200,"per_item_read":200,"required_write":403}` → **refuse mutation**
- `{"comments":200,"discovery":403,"per_item_read":200,"required_write":403,"throttle_signal":"Retry-After"}` → **sequential delayed retry**

A `403` is throttling only with a secondary-limit signal, `Retry-After`, or an exhausted reset.
Wait for the stated delay or reset and retry sequentially from a fresh read; never launch parallel
retries. A bounded tick that remains throttled reports the deferred mutation without changing
authority. An authorization denial has no throttle signal: fail closed for the affected
operational read or write and never retry with another credential.

An authorization failure is a tick-scoped capability gap, not a terminal conclusion. Track three
independent capabilities: **Git transport / default branch**, **`gh` CLI / PR API**, and
**issue token / issue API**. At every subsequent `cadence_minutes.steward` tick, probe each
unavailable capability once with its existing credential. Do not retry before the next tick, do
not tight-loop, and do not switch credentials. Failure of Git transport or `gh` does not block
issue-side stewardship; issue authorization remains fail closed for the affected mutation.

When a probe recovers, consume it in the same tick. Git recovery runs deferred default-branch
validation immediately. `gh` recovery runs the deferred PR/owner/review audit immediately. Issue
recovery resumes deferred issue work only after its normal fresh reads and authorization checks.
Probe each independently and report Git/default-branch capability, `gh`/PR capability, and
issue-token capability separately; success or failure of one is not evidence about another.

On Linear, use the configured MCP or GraphQL transport and stable IDs. Before any mutation,
fetch the configured queue and close states and run `linear-adapter statuses`; require every
ID to match its declared live name and workflow-state type, and require every state's team ID,
key, and name to match the configured team.
When `writes.close` has `supported: true`, use status updates only for `completed` and
`not_planned`. Duplicate closure requires a canonical issue: render
`linear-adapter duplicate --issue-id "$duplicate_id" --canonical-issue-id "$canonical_id"`,
pass its `.input` to `issueRelationCreate`, and do not write the Duplicate status. Linear moves
the issue into its system-managed Duplicate state. Re-fetch the issue's complete outgoing
relations and state, then run `linear-adapter verify-duplicate` with both IDs; both the
duplicate-to-canonical relation and state must validate. When close is unsupported, do not
infer an operation. Treat native `completed`, `canceled`, and `duplicate` workflow-state types
as terminal when normalizing blockers.

```bash
<skill-dir>/linear-adapter duplicate --profile "$profile" \
  --issue-id "$duplicate_id" --canonical-issue-id "$canonical_id" --json
<skill-dir>/linear-adapter verify-duplicate --profile "$profile" \
  --issue-id "$duplicate_id" --canonical-issue-id "$canonical_id" \
  --input "$issue_file" --json
```

Create a Linear blocker with native relation type `blocks`, `issueId` set to the blocker, and
`relatedIssueId` set to the blocked issue. Read blockers only from the blocked issue's incoming
`inverseRelations`. An unresolved direction, incomplete relation connection, or other-team
open blocker fails closed.

Linear queue metadata uses `encoding: "comments-log-v1"`. Render every event with the
executable; do not construct the marker, version, or event ID in prose:

```bash
<skill-dir>/linear-adapter event --profile "$profile" --issue-id "$issue_id" \
  --kind claim-cycle --state Ready --predecessor "$predecessor_or_root" --json
<skill-dir>/linear-adapter event --profile "$profile" --issue-id "$issue_id" \
  --kind claim-cycle-activate --generation "$candidate_generation" --json
<skill-dir>/linear-adapter event --profile "$profile" --issue-id "$issue_id" \
  --kind claim-marker --session "$session" --state "$state" \
  --generation "$generation" --json
<skill-dir>/linear-adapter event --profile "$profile" --issue-id "$issue_id" \
  --kind claim --value "$claim" --state "$state" \
  --generation "$generation" --json
<skill-dir>/linear-adapter event --profile "$profile" --issue-id "$issue_id" \
  --kind touches --touch "$path_a" --touch "$path_b" --json
```

Use `--state "Needs review"` for a review-cycle boundary and pass the selected active generation
as its predecessor; use `root` only for a fresh chain or an unheld legacy repair. Its returned
`event_id` is a pending candidate generation, not authority by itself. Send that input unchanged,
write the requested Queue status, and only then append the generated `claim-cycle-activate`
event. Re-read and use the earliest activation among siblings. Every Claim set or clear carries
that selected generation and its held state. For an intentional empty Touches value, use
`--empty-touches`. The command generates one fresh UUID, the exact version-1 JSON envelope, the
configured marker, and an `.input` object ready for `commentCreate`. Pass only nonblank, unique
paths to a Touches event; the writer rejects duplicates.

Fetch and cursor-link every comment page in descending server `createdAt` order and run
`linear-adapter comments --queue-state "$queue_state"`. It proves the aggregate starts at
`after: null`, follows every
`endCursor`, and terminates only where `hasNextPage` is false. It derives current Claim and
Touches from the latest valid event for the selected active visit, returns the predecessor-chained
active generation, and emits claim markers in chronological order for `task-queue settle`.
Pending intents are ignored. Activated candidates sharing one predecessor are ordered by
activation server time and stable event ID; only the earliest activation extends the selected
chain. Equal timestamps sort by stable event ID before marker order is assigned, so reversing
equal-time input cannot change the result. A Queue state without its matching activated generation,
or an already visited generation re-exposed as unheld, returns `transition.status: "incomplete"`
and `claimable: false`.
An incomplete or contradictory page chain, misordered history, edited event, duplicate
comment or `event_id`, repeated marker, malformed JSON, unknown field, wrong value type, blank
Touches path, or archived marked event must fail closed without a write. A marker without the
active generation also fails closed; a Claim event outside the active state and generation
cannot set or clear the current holder. Legacy events become prior history only after an unheld
state gets a new root repair. Ordinary comments without the marker are ignored.

This guarantee is deliberately limited to cooperative immutable event writers and steward-only
two-phase Queue transitions. Fetching archived comments makes archival detectable, but a
hard-deleted comment is intrinsically undetectable without an external anchor. The profile
acknowledgement does not change that fact. If the environment cannot enforce both cooperative
policies, report Linear mutations unsupported rather than claiming fail-closed history safety.
Direct human Queue mutation is unsupported; humans record decisions and the steward performs the
transition. The protocol never reads or rewrites issue-description metadata, so human description
edits cannot erase queue state.

## Pressure-test checks

Before completing a tick, confirm:

- Every Ready item passed the five-part value test, duplicate check included, on its way in by
  any route (new triage, a returning umbrella owner, or a cleared blocker); a failing item was
  narrowed, routed to `Waiting for input`, or closed; supply counts did not create or promote
  weak work.
- Every held item with activity in any observable source within two hours was preserved; every
  item beyond two hours with no observable activity was released through the correct fresh
  unheld generation, except a Claim under an unanswered `Needs a person:` comment, which was kept.
  A `Needs a person:` hold a person has answered was released where the answer says, on the tick
  that saw the answer, whatever its activity.
- Every `Ready to merge` review covers the current head, not an earlier commit.
- Every applied hint or CI exception was revalidated against live state.
- External zero-step CI did not trigger a code rewrite or an unauthorized spending change.

## Common mistakes

- Reading only the visible queue page instead of every open item and implementation change.
- Treating an absent blocked item as closed without checking normalization warnings.
- Releasing `Touches` before the implementation branch merges.
- Using profile notes, old review state, or tracker silence as current evidence.
- Re-arming the monitor before a tick's mutations and report finish.
