---
name: address-deep-review
description: Triage and act on findings from a deep-review run — deciding which to take, which to decline, when the PR is done, and when to stop reviewing. Use whenever you sit down to address, respond to, or work through review feedback on a PR that has had deep-review run on it, before you change any code. Owns the judgment half and the stopping rule; the deep-review skill owns finding and posting the review marker.
---

# Addressing review feedback

A deep review arrives as a numbered list of well-argued findings. Working down it in order and
fixing each one is the wrong default, and it is the default almost every agent falls into —
because each finding, read alone, looks reasonable.

**The reviewer's job is to surface everything worth considering. Yours is to decide.** A review
that produced 18 findings is not a list of 18 defects; it is a list of 18 claims, some wrong, some
right but not worth the change, and some that matter more than the rest of the PR combined.
Sorting them is the work. Skipping the sort is how a PR grows a commit of naming churn per round,
and how a reviewer's speculative suggestion becomes shipped architecture.

The asymmetry is structural, so guard against it deliberately: `deep-review` tells the reviewer
there is no cap on findings and never to trim real ones. Nothing tells you to trim. One side is
instructed to maximize and the other is uninstructed, and the result drifts one reasonable-looking
acceptance at a time.

## Internal composition

`/address-deep-review --return-only` accepts a complete `deep-review --return-only` report from the caller, including its target base/head, run ID, and numbered findings. Use that report directly; a GitHub marker comment is not required. Read any supplied earlier reports and dispositions for unresolved findings, and verify them against the current target. If the report or target is missing or ambiguous, return a blocker rather than substituting an unrelated PR comment.

This mode changes delivery, not permission to edit code or the triage and stopping rules. The coordinator owns authorized fixes, verification, commits, and pushes. Return the complete disposition table and taken/settled/declined counts, acceptance rate, resulting head, and unresolved work to the caller, keeping the original report intact. Do not post, edit, resolve, or reply to PR comments, ask whether to post, or run the marker-comment workflow below. Default invocations retain their existing behavior within runtime permissions.

## The one number that tells you you've stopped deciding

**State your acceptance rate in every response.** If you have taken every finding in two
consecutive rounds, you are no longer triaging — you are complying, and from the inside that is
indistinguishable from diligence.

This is not a rule against a high rate. Early rounds legitimately run high: the first review of
unreviewed code finds real defects. It is a rule about *noticing*. In one four-PR stack, declines
ran ~8% across rounds 1–2 and then **0 declines across 38 findings in every round from 3 on** —
the collapse was invisible until someone asked. When the rate hits 100% and stays, stop and re-read
the round asking what you would have written unprompted. Usually at least one is a naming
preference, a speculative guard, or a change you could not verify.

**100% across two rounds is not the only trigger, and on its own it is too coarse.** Also stop when
the round had `consider` findings and you took all of them — the default there is not to take them.
That needs the floor, or it fires on any round where nothing was filed as minor.

**One exemption, and it is narrow.** A finding that corrects a statement in your own PR body, which
you measured and found false, is not a preference, and taking every such finding doesn't trip either
trigger. Say in the response that you used the exemption and what you measured. It doesn't cover a
reviewer's suggestion about the code, however cheap. A round made up entirely of body corrections is
worth a sentence of its own: a body that keeps being wrong is a tooling problem, not a review outcome.

**A `consider` finding defaults to the tracker, not the diff.** The reviewer filed it as optional and
it almost always is, so the question isn't whether to resist it, it's where it goes. File it in the repo's tracker (its GitHub issues or Linear team) and record the row `declined` with
`filed <item>` in the note (or `out of scope` when the finding is correct but unreachable, Step 5), naming the item the way the tracker does: `filed #NNN`, `filed SPON-123`. A round's filed findings go in one item, a `- [ ]` line each, and every
row names that item. It earns a place in the diff only when it names a defect, something that behaves wrongly on this
head (or a coverage gap Step 2 counts as one), and "it's one line" is not that: a one-line change
is exactly the shape of a defect an addressing pass injects, measured at two addressing rounds in
four on PR jclaw-labs/local-config#222 and again on PR substackinc/substack#73178. A `consider`
preference goes to the tracker however right it is: being right that it's an improvement doesn't
change this, because
an addressing pass can't review its own commit and a `consider` finding is by construction not worth
a round of review. This is the rate discipline above expressed as a rule you can follow rather than a
bias you have to notice: four rounds of one loop noticed it in writing and took the findings anyway,
because cheapness is a reason the changes are harmless, not a reason they were wanted.

Whether you declined any finding the reviewer filed as a *defect* is worth reading alongside the
rate, but it does not work as a trigger on its own. Measured over every round of two review loops,
most of them declined no defect finding at all — including the round with the lowest acceptance rate
of the lot, at 64% with four declines, all of them preferences. A first review of unreviewed code
legitimately finds defects that are all real, so treat this as colour on the rate rather than a
verdict of its own. What it is good for is the opposite reading: a long run of rounds where no defect
claim was ever refused, while the rate climbs. (Don't restate that as a count of rounds. Written as
one, it goes stale inside the loop that is editing it, because the loop keeps adding rounds to its
own denominator.)

## Step 1: Verify before you accept

Every finding is a claim about the code. Reproduce it before acting on it. Prefer the reviewer's
own strongest technique: **run the code and break it**, rather than reading it. If the round has
more than one review, dedupe the lists first — Step 2 has that case.

- **Numbers:** re-measure, and do it on the head you are answering. Never copy a figure out of a
  review into a document or a test — and don't carry your own earlier measurement across a commit
  either. One response said a mutation failed 3 tests when it failed 2 on that head; the 3 was real,
  measured a head earlier, on a different mutation. Every commit invalidates the whole table.
  When the machine is too noisy to time, follow `deep-review`'s "When timing is noise, count the
  mechanism instead" rather than quoting what the clock says. A figure you can't re-measure is
  withdrawn, not left standing.
- **"Nothing reads X" / "no consumer":** grep for it.
- **"This is a no-op" / "no behaviour change":** construct the case where it isn't.
- **"This test can't fail":** mutate the code it covers and run it. If it still passes, the finding
  is right and important; if it fails, say so with the assertion output.
- **A suggested fix:** re-derive it. When a finding hands you replacement wording, that sentence
  carries no evidence — the reviewer was describing a fix, not reproducing a defect — and it is more
  persuasive than a finding precisely because it arrives already written. Execute the mechanism it
  names before you paste it.

**Probe in a throwaway clone whenever the code under test writes to a repo it can find by itself.**
A tool that resolves its own repo root will find the real one from wherever you run it, so a probe
that looks read-only isn't. Verifying one finding meant running a worktree-creating script from the
review checkout, and it created a worktree and a branch inside the live repo. Reviewers get this rule
from whatever dispatches them; whoever is addressing usually hasn't been given it.

The clone is only half of it, because what decides the target is **what you invoke, not where you
stand.** A wrapper on your `PATH` is usually a symlink into the live checkout, and a script that
derives its root from its own location acts on that checkout from any directory — standing in the
clone changes nothing. Invoke the clone's own copy, or point the tool at the clone with whatever
root override it honours.

Reviews carry wrong claims at a rate worth planning for. Real examples from one stack: a premise
about what a downstream PR already did; a measured median attributed to the wrong fixture; a
finding reported as unaddressed that had been declined in writing a round earlier; and a review
whose central praise — "this window is calibrated to those anchors exactly" — was arithmetically
wrong, and wrong in a way that hid a real defect, because the check as written forbade the very
schedule the design document specified.

That last one is the pattern to internalize: **a wrong claim in a review is often attached to a
real problem.** Refuting the claim is not the end of the work. Ask what the reviewer was looking at
when they got it wrong.

A particular shape to watch for, because it survives a mechanism check: **a review can be right about
the mechanism and wrong about whether it fires.** One traced a token to a log line correctly at every
step and missed that the logger elides at a shallower depth than the token sits. And a reviewer's own
"I watched it happen" can be an artifact of its harness rather than of the code — that one's
reproduction was its mocking library echoing the request back in an error message. Rebuild the shape
and measure it yourself.

When a finding turns out to be wrong, **say so with the reproduction**. A review that carries a
wrong claim forward costs the next round more than it saves.

## Step 2: Triage by severity, not by list order

**Must address** — take it, unless verification shows the premise is false. Correctness, data
loss, a test that doesn't test its property, a citation attached to behaviour that isn't the
source's.

**Should address** — take it when it names a defect. Decline when it names a preference. The
question that separates them: *does something behave wrongly, or does something read differently
than the reviewer would have written it?* A misleading name is a defect; a name you'd have chosen
differently is a preference. A request to test the delivered form is the exception: Step 4's
"Verify against the delivered artifact" decides that decline, not this paragraph.

**Consider** — the default here is **not** to take it: file it in the tracker instead, as "The one
number" above says. Take one only when it names a defect, something that behaves wrongly on this head. A coverage gap
deep-review tags `defect` counts too: changed behaviour with no test, where the project's rules ask for a
regression test, is a defect even though the code is correct, so its test goes in the diff with the change it
protects, under `should` and `consider` alike. So is a request to test the delivered form whose
wiring-deletion run stays green (Step 4's "Verify against the delivered artifact"). A rename of a private
function, a blank line in an import block, a restructured paragraph — these cost a commit, a push,
and on a stack a re-render of every downstream diff. The reviewer filing it as minor is telling you
they know. The default covers `consider` only: a `should` that names a defect stays in the diff, and
a `consider` finding that is wrong is declined with a reason, not filed.

### When a round has more than one review

Two sessions can have reviewers in flight on the same head — a resuming session is structurally
blind to that, because the re-review guard keys on a head *it* recorded. Absorb the race rather than
trying to prevent it; preventing it needs a cross-session lease, which then has its own stale-lock
failure.

**Dedupe before Step 1 verifies anything**, or you will prove the same claim several times before
noticing it was one claim. Then key each finding by which pass raised it, and take **the highest
severity any pass assigned**. One round of three reviewers on byte-identical code gave 23 raw
findings and 14 unique, and one pass's `must` was right where two others had said `should`.

The fact that makes the severity rule matter: **the most important finding of that round appeared in
only one of the three passes.** Agreement across passes is not a proxy for importance, so a
consolidation that weighted confirmed findings higher would have buried the best one.

Promoting a severity costs you something, and it is worth paying knowingly: a `must` is one Step 6
forbids declining without a reproduction, so a lone pass's `must` raises both your acceptance rate
and your evidentiary burden. Pay it rather than falling back on the majority's reading — the pass on
its own was the one that was right.

**Pass-qualify the row ids** — `A1` for a finding one pass raised, `A1 · B2 · C3` for one all three
raised — because each pass numbers from 1 and the ledger's `#` column is round-scoped. Expect plenty
of composite rows: half of them were, on the round this comes from. Two distinct findings both
filed as `1` collapse into a single entry in the parse that reads declined must-address rows back off
the PR, so a response declining three of them reports two.

**A folded duplicate is a second pass.** When `deep-review` folds an accidental duplicate run below
the original's `</details>`, read the marker comment to its end and treat the duplicate as pass `B`.
The original's `<sub>` header is the only must-address count `review-loop-state` reads, so the
stopped-clean check can't see a must-address finding only the duplicate raised; it reaches the
response only if you carry it there.
Two separate marker comments naming the run you are answering, when no other session is addressing
it, are the same case: treat the second as pass `B`, and expect `review-loop-state` not to report a
clean stop on that run until the second is folded into the first as `deep-review` describes, with
its separate comment deleted.

**State the rate on unique findings, and carry the raw count as well.** The round this section comes
from put the pass count in its header and the rate in the body below, but left the raw total out —
and that is the number that makes the rate comparable to a single-review round. All three belong
together:

```
responded to run 4 (a84838b) — three reviewer passes ran on the same head; consolidated to
14 unique findings from 23 raw: 10 taken, 1 settled, 3 declined. Pushed 3a9bc13.

Acceptance rate 10/14 (71%).
```

## Step 3: The over-engineering tests

Run these on anything you're about to build because a review suggested it.

1. **Would you have written this unprompted?** If no, and the finding is in "consider", that is
   usually the whole answer, except for a regression test the project's rules require (test 3).
2. **Does it fix the thing it was proposed for?** Check literally. A proposed rule matching on
   *names*, offered as a fix for a defect that was a wrong *section reference*, would not have
   caught the defect that motivated it. That is not a smaller version of the right fix; it is the
   wrong fix wearing its clothes.
3. **Is the invariant it guards one anybody has broken?** A property test for a property the
   reviewer already swept and found solid is a cost with no incident behind it. A regression test
   the project's rules require is exempt; the rule is the incident.
4. **Can you verify the change?** If a fix touches a pipeline you cannot run against an input you
   do not have, decline until someone can run it. A disclaimer is not a substitute for a test.

## Step 4: Sweep the second order

**This is the step that gets skipped, and it produces the next round's must-address finding.**

Fixes introduce defects. Measured across one stack, roughly one addressing round in five shipped a
new defect that only the following review caught — including a fix that re-created the exact bug
the PR had originally been opened to fix, in a commit whose own comment asserted that could not
happen.

So when a fix changes behaviour, or the mechanism or dependency behind it, find everything that
quotes the old one before committing. In PR jclaw-labs/local-config#302, a fix swapped a permissive JSON5 parser for a
strict JSONC one, and the PR body went on describing the old parser as the approach. A dependency
swap counts even when it changes no output.

- figures in decision records and design docs
- numbers in the PR body
- the PR title and body's account of how the change works: the approach, the dependencies it
  names, and its operational claims
- test bounds and assertions
- doc comments and labels stating a threshold or a frame

Ask **"which documents and tests quote this?"**, not "which paragraph am I editing?". The durable
fix is to make the quoted figures the tests' assertions, so the build fails next to the prose that
went stale.

**Write a PR body change as snapshot, write, verify.** Taking a finding with a body edit is common,
and so is a sweep that finds stale body text. Either way, fetch the body with
`gh pr view <n> --json body --jq .body` in its own command right before the write, edit the text you
fetched, write it with `CREATE_PR_SKILL=1 gh pr edit` on its own, then verify through `gh api`. A hand-rolled
`gh pr edit … && gh pr view …` trips two guards at once. A body-only edit leaves the reviewed head
unchanged, so it is not a commit for the stopping rule: record the row `taken`, and a round whose
only changes were to the body still reports `Pushed: none`.

**Sweep the code the fix touches too, not only what quotes it.** Before you move or remove anything
a finding points at, name what it is load-bearing for. In the two rounds this comes from, both
defects sat one line from the fix, and neither was a stale quotation.

Severity is no guide to what a line holds up. A low-severity finding can name a line that carries a
correctness property, and satisfying it literally is how you remove the property. One round took a
preference-grade note that drag handles stayed disabled for an extra round-trip, moved the latch
release as asked, and removed the only interlock against a second drag racing a stale refetch.

**Then re-run the probe that found the finding.** If a mutation exposed it, re-apply that mutation
and confirm it now fails. Two of the three injected defects in that stack would have died here.

**Then break the same property a different way.** Re-running the finding's own mutation passes by
construction, because you wrote the assertion against it. After adding an assertion, make a
second, independent mutation of the same property and confirm the assertion fails on that too: move
the marked element, drop an ancestor the selector relies on, or break the other direction of a
round trip. On PR substackinc/substack#73450, rounds 2 to 4 each shipped an assertion that the next
round broke this way. Each covered the half the fix had just made true, and each missed the half an
unrelated edit could break.

**If the fix reaches past the surface the finding named, each extra branch needs its own failing
test, or it doesn't ship.** If you'd write "has no test of its own" in your response, you're
describing the next round's must-address: on PR substackinc/substack#78407 a fix for one preload
also opted out two other call sites, said so, and round 2's must-address was one of them. Either
pin each extra call site with a test that fails when its branch flips, or leave it out and file it
as a follow-up.

**Aim each mutation at the expression under test, not at a value flowing into it.** Replacing an
argument with a constant can produce the same observable as breaking the code that computes it, so
a failing test proves only that the plumbing reaches the assertion. If the finding is about
`f(g(x))`, break `g`. One mutation proves the dependency it changed, not the whole test.

**Check that the fixture's actor is the weakest one that should pass.** A fixture well inside a
boundary cannot detect that the boundary narrowed: a publication owner satisfies contributor,
editor, and admin predicates, just as a value ten times over a threshold survives several wrong
thresholds. Put the fixture at the passing edge, then mutate toward it.

**Make each mutation as its own visible edit and confirm it landed before running.** Read the
mutated line in `git diff`; the writer's exit status proves nothing about whether an anchor matched.
An ad-hoc sweep script also hides which edit applied and can restore away uncommitted fixes. If the
set is large enough to automate, use a tested helper that requires one exact anchor, verifies the
file changed, restores from a backup rather than Git, and isolates each parallel run in its own
checkout. Re-run prior-round mutations only when the current fix touches their target files.

**Record which assertions fail under which mutation, and read the map by assertion: no assertion
should fail under a mutation that has nothing to do with the property that assertion pins.** Two
different ways of breaking the same property landing on the same assertion is that assertion doing
its job, however far apart in the code they sit, and most of the suite failing under nothing at all
is normal in a targeted sweep — neither is what you are looking for. Pass/fail counts hide all of
this: a count-only sweep shows "1 failure" for each mutation and invites you to assume each is its
own. What caught a defect in one round's *new* assertion was that it failed
under three mutations having nothing to do with the guard it covered — it targeted a fixture that
earlier tests in the same file reclaim, so it passed only by luck of ordering. That pattern means
either the assertion is order-dependent or the mutation isn't isolated, and both are worth knowing
before you commit.

**A uniform mutation map is suspicious, not proof that the sweep measured nothing.** First
prove every mutation edit landed, then re-run the unmutated baseline. An unchanged edit or a baseline
that fails because of the environment makes the map degenerate. Passing both controls doesn't
validate it, though: each mutant must reach an assertion attributable to the property it intended to
break. A parse, load, setup, or harness failure before that assertion makes the mutant invalid or
unresolved, not evidence of coverage. Repair or replace it before reading the map. One sweep reported
the same single failure for three unrelated mutations because a variable a previous `source` had
leaked into the shell was still set. When the controls pass and each mutant reaches its property
assertion, uniformity can be valid: independent mutations of the same property can land on the same
assertion, and the assertion is doing its job.

**Keep one identifiable property per failure, because the map is read at assertion level.** Assertion
messages and assertion locations can distinguish unrelated properties inside one test; separate
tests are required only when the framework cannot tell those failures apart. Strengthen assertion
messages or locations, or split tests as needed. One round put a response-shape assertion inside an
existing self-scoping test whose failure named only the test, so two unrelated mutations landed on
an indistinguishable row.

Run the mutations in parallel if the sweep is slow, but give each one **its own checkout**. Per-run
fixtures are not the isolation that matters here: a suite that resolves the tool under test through
the checkout it lives in re-reads that file on every assertion, so a second mutation written into the
same checkout mid-run surfaces as a failure in the first run — which looks exactly like the
order-dependence you are sweeping for. And if the suite has a load-sensitive flake in it, fix that
before parallelising rather than reading its failures as findings.

### Prove the fix engaged, not just that the symptom moved

A fix that skips work — a cache, a short-circuit, an early return — is verified by showing **the new
code path ran**, not by showing the number got better. Those are different claims, and the second
one is satisfied by any change in conditions at all.

The case this is written from: a negative cache meant to stop an offline run retrying at every call
site was verified by timing a `check` against `127.0.0.1:9` and finding it instant. It was instant
because that port *refuses* the connection in 5ms. Against a black-holed host, which is what a real
outage looks like, the run still took two minutes — the cache had never executed once, because the
marker was written with `touch` and the freshness test opened with `[[ -s ]]`. The measurement was
real and meaningless, the round reported it as fixed, and only the next review caught it.

So before writing "measured" next to a fix like that:

- **Pick an input that can only pass through the new path.** A fast failure and a skipped fetch look
  identical from the outside; make the slow case slow.
- **Observe the mechanism directly** — the file it writes, the request it doesn't make, the branch it
  takes — and not only the elapsed time.
- **Check the second run differs from the first.** A cache that never fires is indistinguishable from
  one that always hits until you compare them.
- **Then write the assertion**, because a mechanism nobody can see from the outside is exactly the
  kind the suite will let rot. One test here would have failed the commit.

### The evidence a row needs

Every outcome in the response is a claim, and three of them keep getting made without the evidence
they need.

**A decline on cost needs a measured cost.** If the decline rests on a number — providers to wire,
files to touch, minutes to write — get the real one by starting the work, not by reading about it.
One round declined a test as needing "three providers, an exported internal component, and analytics
side effects". The component was already exported, the providers were already imported in the same
test file, and the next round's reviewer wrote the test and saw it pass first try. The addresser then
wrote it in about ten minutes, and it caught the mutation the declined half was about. If you can't
measure the cost, decline on something else or take the finding.

**A taken behaviour change can't be verified as `read`.** If the fix changes what the code does, its
`Verified` cell is `mutated` or `measured`, from a run on the head you push that exercises what the
changed line was load-bearing for. Re-running the finding's own probe is not enough on its own. That
holds at every severity, preference rows included. `read` fits a taken change to prose or structure,
and a settled row. Two consecutive rounds shipped a defect inside a fix they took, because each
changed the line the finding named without running what that line held up. In the latch round above,
the finding's own probe would have passed, because the handles really did re-enable a round-trip
sooner.

A decline carries whatever evidence its own rule asks for: Step 1 for a refuted premise, this
section and Step 5 for cost, Step 5 for nothing left to catch, Step 6 for a must-address, and the
delivered-artifact rule below for a request to test the delivered form. It is `read` only when that
rule asks for no run.

**Verify against the delivered artifact.** When the code under test has an intermediate form and a
delivered one — a document body and the rendered email, a helper and the mounted component — at
least one assertion or probe has to reach the delivered one. Mutation testing inherits the blind spot
instead of exposing it, because every mutation you think of perturbs the form you are already
watching. Four rounds stayed green on one PR because every test asserted against `post.body`, while
the defect lived in what the renderer delivered. On another, a helper test passed while the editor
never mounted the feature at all.

That binds a decline as well, at any severity, `consider` included. A request to test the delivered
form can't be declined as plumbing or as a preference while a mutation that deletes its production
wiring leaves the suite green. Run that mutation before you decline or file it: if the suite fails,
the wiring is covered, so the decline can stand on its own reason and is `mutated`; if it stays green,
take the finding. On PR substackinc/substack#77268 the addresser declined a
real editor-path test twice as presentational plumbing, and the round that finally rendered the
editor found the feature never mounted.

**The delivered artifact has to be built from the head under test.** This is the opposite failure:
the test does read the delivered form, but that form predates your edit, so a mutation to the source
never reaches it. When a test loads a prebuilt bundle, rebuild it before you read any mutation
result. One addresser mutated the source, watched 12 tests stay green against a bundle an hour older
than the edit, and concluded that a good assertion was worthless.

## Step 5: Decline well

A decline is a first-class outcome, and it needs to survive someone reading the thread later.

- **Name the mechanism, don't report a failed search.** "I searched and nothing sets that" is how
  you talk yourself into dismissing a true finding. "A trailing slash restricts the pattern to
  directories, and a symlink is not a directory to git — here is the `git status` transcript" is a
  refutation.
- **"There is nothing left to catch" is a universal claim, so build the counterexample before you
  write it.** Step 1's own technique refutes claims like that by construction, and it takes two
  minutes. One decline argued that precedence made a parenthesisation cosmetic, so a full-string
  assertion had nothing to catch. The precedence was right and the conclusion was wrong: the next
  round produced three single-token mutations that each left the suite green, one of which silenced
  the feature entirely. If your reason is that no counterexample exists, go try to build one.
- **Give the reason in the response.** A finding recorded as declined with a one-line reason reads
  as decided; the same finding left unmentioned reads as ignored, and comes back next round. Record
  it as declined, not settled — settled is for findings resolved another way, and folding declines
  into it zeroes out the decline count Step 6 leans on.
- **A finding can be correct and still out of scope.** When it is true but no supported call path
  reaches it under the threat model the artifact actually has, record it `out of scope` rather than
  taking it or declining it: the finding isn't wrong, and a plain decline doesn't record why no
  supported path reaches it. On a `consider` row, `out of scope` replaces the default's
  `declined, filed <item>`. The outcome is decided and nonblocking only when the row's note records all four of
  these: the intended adversary or threat model, in a sentence; that the finding itself is correct;
  why no supported call path reaches it; and a tracker item (`filed <item>`) when the boundary might
  need to expand later, or a line saying it won't. A row missing any of them is an undecided
  finding, not an out-of-scope one. It counts against your acceptance rate like a decline, because
  you did not take it. Stating the threat model is the part that does the work: it
  asks the question once, and it gives the next round something to check a finding against instead
  of rediscovering the class.
- **A must-address finding can't be recorded out of scope.** Arguing that one is unreachable disputes
  its severity, since `deep-review` rates an unreachable bypass `consider` at most. Record it
  `declined` with the reachability argument as the mechanism; it then holds the clean stop like any
  must-address decline, and the decision that ends the review loop settles it.
- **A complexity tripwire forces the threat-model question.** Before you add a third guard on one
  predicate, or once the fixes have roughly doubled the implementation they patch, stop and state
  what the artifact defends against before taking the next finding in that class. This is a
  tripwire, not a size limit: if the class is in scope, keep going, and compare a different
  enforcement layer before patching the same boundary again; if it isn't, record the rest
  `out of scope` as above. On PR #285 nobody asked the question in six rounds, and a fifteen-line
  widening became an 800-line shell lexer whose every fix exposed the next case.
- **A `settled` row has to be earned by re-reading the location the finding named.** Declines stay in
  the ledger and settled rows leave it, so a wrong `settled` is invisible forever — the one asymmetry
  here with no check under it. One was recorded by reading a neighbouring sentence that had been
  rewritten, while the sentence the finding actually named sat untouched in a file loaded into every
  session. Check the place the reviewer pointed at, not the fix you think covers it.
- **Declining on cost is legitimate once you have measured any work estimate it rests on** ("The
  evidence a row needs", above), and so is "this is unverifiable from here." The fixed cost Step 2
  names for a `consider` finding (a commit, a push, a re-render on a stack) needs no measuring.
- **Taking half a fix by accident is not taking it.** A suggested fix often has more than one
  clause. Restate the clauses before you start and check each one off in the response row, because
  the half you drop is invisible afterwards: the half you shipped reads as the whole thing. A clause
  left unchecked makes the row's outcome `taken in part`, not `taken`. On a must-address row
  automation reads only the outcome (see "Recording what you did"), and on any row the outcome is
  what the next reader scans, so a tick in the note changes nothing. One round was
  told to mount a bridge "at the post render root, gated on the same server-side signal". It shipped
  the mount and gated it on a URL parameter instead, which was worse than the defect being fixed.
  Shipping a different predicate from the one the finding named is the same failure, so treat that
  substitution as the claim to verify. Another round guarded a data-loss path on `!existingSub` where
  the finding's condition was `canJoin === false`, a strictly larger set, and its response argued in
  writing that the two were the same.
- **Half-declines are common and worth stating.** Taking the accessor but not extending it to
  three other ids is a decision; say which half you took so the other half isn't re-filed.
- **Reverse a decline when it acquires a counterexample.** A decline is a judgment under evidence,
  not a position to defend. When the failure you said wouldn't happen happens, say so plainly and
  build the thing.

## Step 6: When the PR is done

This is the stopping rule, and it is the part that makes an unattended review loop safe.

**Two tempting criteria are both wrong, and the data says so.**

- *"Stop when the review finds nothing."* Findings decay but do not reach zero — 18 → 12 → 7 → 5
  across four rounds on one PR, 16 → 12 → 8 → 6 on another. A loop waiting for an empty review
  never terminates.
- *"Stop when there are no must-address findings."* Not monotone. One PR ran 4 → 2 → 0 → **1**: a
  must-address appeared at round 4 after round 3 was clean.

**The sound criterion is that the reviewer has seen the final state.** You cannot certify your own
work, because addressing injects defects and only the next review catches them. Any round that
produces a commit invalidates the review that prompted it.

Which gives a rule that is mechanical and terminates:

> **The loop ends on a round that produces no commit** — every finding was declined, already
> settled, or taken by an edit to the PR body alone — with local checks and CI green on that head.

A round produces no commit only when the head the reviewer just examined *is* the final head. That
is the certification, and it comes from the reviewer rather than from you.

**"CI green" means the head adds no failure of its own.** A check that is red on the base too, for
the same suite and assertion, doesn't block the stop: compare the head's whole failing set against
the latest base run, down to the failing suite and assertion where the logs show them, and name the
base run in the response. Any failure outside the base's set is the head's, and the round doesn't stop on it.

Note what this does to the acceptance-rate discipline above: **an agent that takes every finding
with a commit can never terminate.** Every round produces a commit, which requires another round, forever. That
is the point — it converts over-compliance from a silent quality problem into a visible
non-termination, and it is why the acceptance rate belongs in every response.

Three guards, so the rule can't be gamed or run away:

1. **A must-address finding may not be declined without a reproduction refuting its premise.**
   Otherwise "decline everything" is a one-round exit.
2. **Budget the rounds.** Past five, stop and hand the state to the author with what's outstanding
   and why, rather than continuing. Diminishing returns are real: late rounds on that stack cost
   ~100 lines of churn for ~8 findings, of which about one was a genuine defect.
3. **Green is necessary, not sufficient.** Local checks and CI pass on the final head, and every
   finding from every run has an outcome.

**Stopping is not merging.** Report that the criterion is met and hand the merge decision to the
author — a repo that makes marking a PR ready a separate act means that separation is deliberate.
Do not mark ready, do not merge, and do not keep iterating because another round is available.

## Recording what you did

In `--return-only` mode, return the same run identity, counts, resulting head, and per-finding evidence in chat; skip the publishing instructions and marker below.

**Post your own comment. Never edit the review's.**

The review comment records what was found; yours records what was done about it. Keeping them
apart means neither can destroy the other, and it makes your response something a script can find
rather than a mutation buried inside somebody else's comment. It also replaces a convention that
did not work: half the surfaces that run this skill have no tool that can edit a comment at all,
and across one four-PR stack the marker was successfully edited **once in fourteen rounds**.

Open with `<!-- address-deep-review-marker -->`, and **never put `<!-- deep-review-marker -->` on
that first line**. Automation classifies a comment by the marker its first non-blank line carries,
so a record that opens with the review marker is counted as a review round — inflating the count
and making a later re-review skip a head it should have read. Quoting either string further down
the body is fine; naming the run by number and short SHA is still the clearer way to refer to it.
`deep-review` carries the mirror of this rule.

Style it like the review: small text, detail collapsed.

Keep the `DEEP_REVIEW_SKILL=1` prefix — the same one `deep-review`'s marker carries. Some setups
run an agent hook (`guard-no-reviewer-reply.sh`) that denies a bare `gh pr comment`, so an agent
can't answer a human reviewer on your behalf; that prefix is the guard's one sanctioned exception,
and it covers both a review marker and this response. Without the hook it is an inert env var, so
it is safe either way — but don't reuse it on any other comment.

Write the response after the final tree, head, and outcome checks, in its own tool call (run the
body check below only once that write's result is back), to
`/tmp/address-deep-review-marker-<number>-run<N>-<short-sha>.md` — naming the run you answer and
its short SHA — as one overwriting write: the harness's file-write tool or the truncating `cat >`
below. Never append to it, and never use a patch tool's "add file" on a path that may already
exist: a reused path is how a new body ends up in front of an old one and posts both.

```bash
cat > /tmp/address-deep-review-marker-<number>-run<N>-<short-sha>.md <<'EOF'
<!-- address-deep-review-marker -->
<sub>[Agent] 🛠 <b>address-deep-review</b> responded to run 3 (<code>abc1234</code>) — 8 findings:
5 taken, 2 settled, 1 declined. Pushed <code>def5678</code>.</sub>

<details>
<summary><sub>Deep-review addressed</sub></summary>

| # | Severity | Kind | Outcome | Verified | Note |
|---|---|---|---|---|---|
| 1 | must | defect | taken | mutated | guard was inverted; the test now fails without the fix |
| 2 | should | preference | declined | read | the alternative loses the ordering §4 requires |

Acceptance rate: 5/8 (63%).

</details>
EOF
```

Check that it holds exactly one response — first non-blank line is the response marker, and no other
line outside a code fence is a marker alone; marker text quoted in prose or a fenced block is fine.
Rewrite the file if this exits non-zero:

```bash
awk '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "") } NF && !seen++ { first = $0 } fence == "" && match($0, /^(```+|~~~+)/) { fence = substr($0, 1, RLENGTH); next } fence != "" && $0 ~ ("^" fence "+$") { fence = ""; next } fence == "" && /^<!-- (address-)?deep-review-marker -->$/ { n++ } END { exit !(first == "<!-- address-deep-review-marker -->" && n == 1) }' /tmp/address-deep-review-marker-<number>-run<N>-<short-sha>.md
```

Under an orchestrated review loop, also run `review-loop-state --check-body <file> --expect
response`. It applies the parse the loop's stopping rule reads, so it also refuses a numbered row
whose Severity isn't `must`, `should` or `consider` (copy the review's own, never the finding's kind),
a header that counts more findings than the table's rows, and a header without `Pushed <code>…</code>`,
`Pushed: none` or `Pushed: rejected` written exactly (prose like "then pushed" doesn't count).

**Before you start addressing, and again right before posting, check that nobody has answered this
run already.** Read the PR's comments (under an orchestrated review loop, `review-loop-state <number>
--repo <owner>/<repo> --json` reports it as `latest_run_responded`, but only for the run numbered
`rounds_complete`, so trust it only when that equals the run you answer) for a comment opening with
the response marker that names this run. If one exists for the same run and head, another session is
addressing this review: before addressing, don't start; before posting, don't post yours. Stop and
report a peer loop, with both sessions' pushed SHAs if they differ.

**Right before you push, check that the PR is still open.** A merge deletes the head branch, so a
push after it re-creates the branch as a new ref with no PR, and git reports success. Under an
orchestrated review loop, chain the check into the push:
`review-loop-state <number> --repo <owner>/<repo> --require-open && git push …`. Any non-zero exit
means don't push: 3 means the PR isn't open, and 1 means its state couldn't be read. The chain
narrows the window between check and push, but can't close it. Elsewhere, read the PR's `state` from
the REST API. If the PR is merged or closed, or its state can't be read, don't push and don't post:
report your commit's SHA and the PR's state, or the error when it couldn't be read, instead.

Then run the posting command alone, in its own shell call sent after the body and peer checks' results
are back (not in the same parallel batch, where it can run first) — no `cd` before it, nothing chained
after it:

```bash
DEEP_REVIEW_SKILL=1 gh pr comment <number> --repo <owner>/<repo> --body-file /tmp/address-deep-review-marker-<number>-run<N>-<short-sha>.md
```

**The header line carries the state**, because it is what a reader or automation needs
without opening anything:

- **Which run this answers**, by number and the short SHA from that run's header. A PR with five
  rounds has five of these, and only the SHA says which is which.
- **The counts**, as taken / settled / declined, plus taken in part or out of scope when any row is,
  and deferred on a round that escalated. Put the
  decline count where it cannot be missed: in the stack this convention comes from, declines fell to
  **zero across 38 findings** in the late rounds, and the collapse into compliance was invisible
  until someone asked about it directly.
- **What you pushed**, as a short SHA — or **`Pushed: none`** when the round produced no commit.
  That is the whole stopping condition: a round that changes nothing means the head the reviewer
  examined is the head that will merge. It belongs in the header, not only in the table. When you
  committed fixes but the push was refused, write **`Pushed: rejected`**: that is an escalation,
  not a stop, because the fixes are real and the reviewed head doesn't carry them.

**Every finding gets a row**, by the number the review gave it — taken, taken in part, settled,
declined, out of scope, or deferred. A finding with no row reads as missed. Per row: severity, `defect` or `preference`, the
outcome, and how you verified it (`measured` / `mutated` / `grepped` / `read`). A taken row that
changes behaviour is never `read`. For a **declined
must-address**, the note carries the reproduction that refutes the finding. A decline without one
is an opinion, and it is the one thing a reviewer cannot check on your behalf.

A `consider` finding routed to the tracker is `declined`, with the item in the note (`filed <item>`).
It is a decision about this diff, and recording it as `deferred` would read as an escalation.

**`deferred` is the escalation outcome; `declined` is a decision.** A finding is deferred when it is
real and unrefuted and you are handing it to the author rather than acting on it — a pivot verdict,
the round cap, a must- or should-address finding you can neither reproduce nor refute (a `consider`
one goes to the tracker as `declined` instead). Lead the outcome cell with the
canonical result — `taken`, `taken in part`, `settled`, `declined`, `out of scope`, or `deferred`
— so callers and automation do not have to infer it from explanatory prose. Name an escalation in the header, so
`Pushed: none` is not mistaken for a clean stop, and state the acceptance rate over the findings you
actually triaged or say it does not apply.

A half-take is not a hand-over. Record a partly-refused must-address once as `taken in part` or
`half-taken`, and state which part remains unresolved. A later mention of the same finding is only a
clue, not a ruling — the caller still decides whether the author settled it.

Keep the posting command exact and standalone. If `gh` cannot write because the runtime uses a
read-only or scoped credential, do not retry with a personal token. Use the harness's sanctioned
PR-comment write tool with the same body and markers when one exists; otherwise retain the complete
response in chat and report that the response comment could not be posted.

## Behavior on weak input

- **"Address the review"** with several runs open → address the newest, and read the previous
  round's own response comment for findings recorded as unsettled.
- **A finding you can't reproduce and can't refute** → say exactly that, take it only if cheap and
  safe (a `consider` one goes to the tracker), and flag the uncertainty. Don't assert either way.
- **A finding that would pivot the design** → it belongs to the author. Surface it and stop.
  Under `--return-only`, follow the invoking workflow's authority instead. In `prepare-for-review`,
  a supported, in-scope internal redesign that preserves the accepted contract is the
  coordinator's decision. Surface changes to accepted scope, behavior, external contracts, rollout,
  or other unresolved consequential choices to the author.
