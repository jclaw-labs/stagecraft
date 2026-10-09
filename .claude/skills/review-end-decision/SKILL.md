---
name: review-end-decision
description: Decide for yourself what happens to a PR when a deep-review loop ends without a clean stop: at the round cap with an unreviewed head, with a must-address declined or deferred, on a pivot verdict, on a must- or should-address finding you can neither reproduce nor refute, on red CI outside the diff, on a peer loop, or on running out of context. Use whenever deep-review-orchestrate or review-task-queue escalates, or whenever you are unsure what to do at the end of a review.
---

# Deciding how a review ends

A review loop that doesn't stop clean used to hand the PR back to a person with a question:
merge it, review it again, or drop it. **Make that call yourself.** The person who would have
answered has no more information than you do. They would read the same review and responses on
the PR, and they would get to an answer more slowly. Parking a PR on a question also holds its
files, so everything that touches them waits too.

What doesn't change: **an unreviewed head never merges.** Every route below ends in one of three
places:

- a head that a fresh reviewer read and passed;
- a closed PR whose owner issue records what the loop learned, or, where you may not close it, a
  recommendation to close that you record and report ("Close and re-scope", below);
- one of the few blockers only a person can clear ("What still needs a person", below).

When a caller follows this skill, it overrides three lines in `address-deep-review`: guard 2's
"Past five, stop and hand the state to the author", its definition of `deferred` as a finding
"you are handing it to the author rather than acting on it", and "A finding that would pivot the
design → it belongs to the author. Surface it and stop." A `deferred` row still marks a finding as
real and unrefuted, but this skill decides what happens to it, and a pivot goes through "Pivot
verdicts" below. `address-deep-review` is shared with Substack and can't name
this skill, so the override is stated here.

## Record every decision on the PR

Each decision goes at the end of that round's response comment, as prose under a line that reads
`Decision:`. Never use a `|` row; `address-deep-review` says why. If the round's response is
already up, put the decision in a new top-level comment instead. Write it as a few sentences:

- what fired;
- which branch of this skill you took;
- the evidence that chose it;
- what happens next.

That record is the ruling `deep-review-orchestrate` looks for when it asks whether an escalation
has been answered. The next session reads it instead of re-deciding, so a decision without one
gets made twice.

A record that makes no decision, such as running out of context or standing down to a peer loop,
goes under a line that reads `Handover:` instead, in the same place and the same prose form. A
`Handover:` record rules on nothing, so it never answers an escalation. Only a `Decision:` record
does.

## At the cap with an unreviewed head

This comes up most often. The capped round took fixes and pushed them, so nobody has read the
head. Start by reading the unreviewed delta:

```
git diff <last reviewed head>..<current head>
```

Also read the finding counts across the PR's rounds. Then take the first branch that matches.

1. **Same-class repetition: treat it as a pivot.** This applies when the same predicate, parser,
   classifier or invariant took a patch in three or more rounds, the cap round included. The
   retros show this pattern doesn't converge. Each patch closed one input and the next review
   found another: PR #285 hit this with heredoc parsing, PR #270 with one classifier, and PR #238,
   PR #384 and PR #496 with others. Don't certify a fourth patch. Go to "Pivot verdicts" below.

2. **Certify everything else.** Return the head for `deep-review-orchestrate`'s certification
   pass:
   - From a queue, use `review-task-queue` section 9's `Needs review` handoff, with the comment
     naming the head's SHA and the word `certification`.
   - Outside a queue, run the certification pass yourself in a fresh session, or dispatch it as a
     fresh reviewer.

   The certification pass is one read-only review and costs about a round, which makes it the
   cheapest way to make the head reviewed. A capped head with a prose-only or test-only delta
   still gets certified; it simply has less to find.

3. **What a certification result means.** Before you treat any result as clean, run
   `deep-review-orchestrate` step 4's CI comparison on the certified head against the base's
   failing set. A failure that is red on the base too doesn't block. A failure that is the
   head's counts as a must-address finding below. A job the profile's CI exception covers takes
   the local fallback under "Red CI outside the diff" instead.
   - **Clean:** the head is reviewed and goes to `Ready to merge` as usual.
   - **Findings, none of them must-address:** certification has still reviewed that head, so this
     is a clean stop. File each finding in the tracker as `address-deep-review` routes it. Their
     rows in the certification response stay `deferred`, as `deep-review-orchestrate` records
     them before this skill runs. The `Decision:` record names the filed item for each and says
     the stop is clean. The head may then go to `Ready to merge`. `review-loop-state` still
     reports `stopped_clean: false` for a certification response with finding rows, so the
     `Decision:` record is what answers it.
   - **A must-address finding,** from certification or from the CI comparison: take the extension
     round below if it is available, and close and re-scope if it isn't.

### The extension round

You may grant one round past the cap, and only one per PR. Grant it when a must-address finding
is open at the cap, either because certification or its CI comparison found it or because an
adjudicator upheld it (below), and both of these hold for the must-address findings that
motivate the extension:

- they are local to lines this PR already touches, with no design change. For a must-address
  from the CI comparison, local means caused by this PR's lines and fixable without a design
  change, even when the fix lands in a test or file the PR doesn't otherwise touch;
- none of them repeats a class the loop has already patched twice.

Lesser findings don't bear on these conditions. They are filed as in step 3.

An extension round is one addressing pass followed by a normal new review run, N+1, of the head it
pushes. The addressing pass doesn't post a second response to the certification run. The
`Decision:` record that grants the extension names the findings it takes and the SHA it pushes.
Run N+1 then gets its own marker and its own response, numbered with `review-loop-state` as
usual. Treat it like any round: a clean stop on that head is a reviewed head, and anything else
closes and re-scopes. Never grant a second one. The cap exists because late rounds cost more than
they find, and the extension is the single exception to the cap. It is also the only case where
certification leads to an addressing round.

Without an extension, a must-address finding means the PR can't merge as is, so close and
re-scope (below).

### Close and re-scope

You may close a PR only when it is queue-owned work: it owns an issue in a repo with a validated
task-queue profile, and this session holds that issue's review claim. The owner issue must also
have exactly one open PR, with no PRs stacked on it.

Everywhere else, close nothing. That covers any PR outside such a queue, including a Substack PR,
and an owner with several open PRs or a stack. Write the close you recommend, and why, as the
`Decision:` record, and report it to the person who started the loop.

When you may close, close the PR with a comment that links the `Decision:` record. Then comment
on the owner issue so the next attempt starts from what this loop learned:

- the invariant the loop kept failing to state;
- the findings still open;
- the approach to avoid.

Don't edit the issue body. Then return the owner issue to `Ready`, clearing the review claim
before the Queue moves, as `review-task-queue` section 8's `single-owner-multiple-PRs` path and
`claim-task` do:

1. Append the scoped `Under review` Claim clear, and clear the Claim projection as `claim-task`
   directs.
2. Then run the profile's two-phase transition: append the pending intent for a new `Ready`
   generation, perform the `Queue write` to `Ready`, and append its activation.

Its next worker starts from the default branch. A closed branch is not lost work. It
stays on the remote for the next worker to read, and the issue comment records why it didn't land.

## A must-address declined or deferred

The worry is that one session wrote the refutation and also graded it. Fix that with a second
reader rather than a person:

1. Dispatch a fresh subagent as adjudicator. It must be neither the reviewer nor the addresser.
2. Give it the review comment and the response comment verbatim, with their URLs, plus the
   reproduction both sides cite, the repo path and the head SHA. Never give it the addresser's
   summary of either side, because that brings back the framing a second reader is there to
   remove.
3. Ask it to run the reproduction both sides cite and rule **upheld** or **refuted**. It must not
   edit anything.

Act on its ruling:

- **Refuted:** record the ruling and continue. The escalation is answered.
- **Upheld:** take the finding. That makes the round commit-producing, so the loop continues. At
  the cap, take it through the extension round if that is available, and close and re-scope if it
  isn't.
- **The adjudicator can't run either side:** treat the finding as unreproducible (below).

## Pivot verdicts

A reviewer's pivot verdict is a claim like any other finding. Verify the mechanism it rests on
before acting on it, as `deep-review-orchestrate` already says. Run the tests below as soon as the
verdict lands, before `deep-review-orchestrate` stops without addressing and before it records
any finding as `deferred`. In PR #238 the reviewer said to defer the pivot and run another round,
and the loop escalated anyway, giving up a +8/−1 fix the reviewer had recommended. The retro held
that the escalation was right under the rule as written, and that the rule couldn't tell "this PR
should not ship in this shape" from "a better approach for the next change".

The pivot is **real** when same-class repetition holds, as above, whatever the reviewer
recommends. PR #238 is that case: three rounds patched one predicate, and a third patch to one
predicate is a pivot.

Otherwise run these two tests against the code. The pivot is real when either of them holds:

- the reviewer names an invariant the design can't express, and the code confirms it;
- the fix the reviewer would need contradicts the issue's own acceptance criterion.

The reviewer's another-round line only breaks a tie, when neither test clearly holds or clearly
fails. It tracks the defects left, not the pivot, so prefer the reviewer's own words about the
pivot when they say "for this PR" or "for the next change". Failing those, another round means
the pivot is not real, and no further round means it is.

On a real pivot, close and re-scope. Don't rewrite the issue's acceptance criterion or edit the
issue body. Record the pivot and what the loop learned as a comment on the issue. If the pivot
changes what the product should do, that is a question for a person ("What still needs a person",
below).

Otherwise the pivot is **not real**. Address the round normally, answer the pivot in that round's
response as a declined finding with the evidence, and let the loop continue. When the mechanism
the pivot rests on held, file the pivot in the tracker and record it as declined with that item,
so the next change can still take it. Among pivot verdicts, only a real one stops the round
without addressing it.

## A finding you can neither reproduce nor refute

This covers a must- or should-address finding. A `consider` finding you can neither reproduce
nor refute goes to the tracker as `declined`, as `address-deep-review` says, and never holds the
loop.

For a must- or should-address finding, decide by which mistake costs less:

- **Before the cap, when the fix is small and local:** take it. The next review reads the fix,
  and an unneeded guard costs little.
- **At the cap, or when the fix is large:** file it in the tracker with the exact reproduction you
  tried and what blocked it. Record it as `deferred` with the `Decision:` record, and treat the
  loop as you would any capped state above.

## Red CI outside the diff

Compare the whole failing set against the base's latest run, job by job.

- **A job blocked by the profile's CI exception:** when the validated profile lists one, check each
  red job against it first, by `steward-task-queue` section 9's recognition test. A GitHub Actions
  job refused for an account billing problem ran zero steps, and its check-run annotation says
  recent account payments failed or the spending limit needs raising. Every job is red in that
  state, on the base too, so there is no failing set to compare and nothing to re-run or file.
  Run the suites that cover the change locally on the head and use their result in place of the
  comparison, here and in step 3's certification check. Name the blocked job and the local run in
  the `Decision:` record. A job that ran steps gets the comparison below.
- **Every failure also fails on the base:** this is the clean stop `deep-review-orchestrate`
  already allows. Name the base run you compared against.
- **Not on the base:** any failure that isn't red on the base is the head's, as
  `deep-review-orchestrate` step 4 says, even when the head also fixes one of the base's. Re-run
  once. If it fails again, file it or add a sighting to the open issue, and treat it as this
  head's must-address finding: it goes back through the loop. At the cap it is the must-address
  that step 3's CI comparison finds, so it takes the extension round if that is available, and
  closes and re-scopes if it isn't.
- **A missing secret or a permission the job lacks:** this needs a person; see "What still needs
  a person".

## A peer loop

The rule is one controller per PR. For queue-owned work, the current Claim holder owns the loop:
the session the live scoped Claim names for the active generation, as `claim-task` defines the
holder, however early another session marked or claimed. Outside a queue, the controller whose
earliest marker or claim came first owns the loop. Any other controller:

- stops;
- doesn't push;
- posts nothing on the PR beyond a `Handover:` record naming both controllers and the SHA each
  one pushed.

If the owning controller's session is gone, its claim's normal stale-release rules decide whether
you can take over. Don't decide that from how quiet it has been.

## Out of context or budget

Hand over the loop's state with no decision. Write a `Handover:` record, not a `Decision:` record,
that says the session ran out of context or budget, names the last reviewed head and the current
head, and says no decision was made. Inside a task queue, when you still can, then release the
claim through `review-task-queue` section 9's intentional `Needs review` handoff before stopping, so
the next reviewer can claim the loop without waiting out the stale rule. Otherwise leave the claim
and the queue state as they are, so the next session picks the loop up from the PR and makes the
decision.

## What still needs a person

Report only these and stop. Everything else in this skill is yours to decide.

- **Access.** A rejected push, a missing secret, an org or repo setting, or a permission the token
  lacks. Hand over the patch or the exact setting.
- **Merging, where you aren't authorized to merge.** The reviewed head is ready, and the merge
  belongs to whoever holds that authority.
- **Another human's review comment.** The global rules forbid acting on it, so surface it.
- **A product question that neither the issue, the PR nor the repo's docs answer, where both
  answers ship different behavior to users.** Prefer the default the issue implies and say so in
  the PR body. Ask only when no default is defensible.

A person can still overrule any decision. The `Decision:` record is what makes that cheap,
because they can read your reasoning without reconstructing it.
