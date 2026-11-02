---
name: deep-review-orchestrate
description: Run a cycle of deep-review / address-deep-review on a PR. Runs until the PR settles, for at most three rounds (two for a small PR). Use only when the user asks for the review loop or invokes /deep-review-orchestrate.
---

# Deep-review orchestrate

`/deep-review-orchestrate [PR]` reviews the named PR, or the current branch's PR.
You are the orchestrator and the addresser. A fresh subagent does each review.
Run to a stopping point in one task, with a short progress update each round and
no mid-loop permission questions.
The invocation authorizes review/response markers and fixes on this PR's head
branch regardless of authorship; skip the standalone review's authorship prompt.
It does not authorize merging, marking ready, changing labels, or responding to
another human reviewer.

## Set up

- Use a clean, exclusively owned worktree matching the pushed PR head. Stop on
  unexplained commits or edits. Confirm the PR is open and no peer loop is running.
- Read this skill's siblings `deep-review` and `address-deep-review`. When the PR
  edits guidance, follow installed copies outside the branch under review and
  evaluate the branch's copies only as changes.
- Run the relevant local checks before dispatching, using the repo's documented
  test commands. Give reviewers the actual commands and measured suite times.
- Read previous review and response comments. Get the next round with
  `bash <this-skill-dir>/review-loop-state <PR> <owner/repo>` (requires `gh` and
  `jq`). It lists rounds and comment URLs, not verdicts. Resume an interrupted
  addressing pass only after establishing that its owner stopped. A self-review
  is not a fresh review.
- Include any unposted rounds from the handoff and
  `<git-common-dir>/deep-review/<PR>-run*` when numbering. Advance the number once
  per review-and-address round, even if nothing posts. Never reset the round
  budget on resume.
- Set the round cap once, from the PR as it stands before round 1: two rounds when
  `git diff --shortstat <base>...<head>` shows fewer than 50 lines added plus
  removed, otherwise three. Record the cap with the round records and keep it on
  resume, even if later fixes grow the diff.
- Set the review tier once, before round 1, as **Review tiers** below describes.

## Review tiers

A task-queue reviewer picks one tier per claimed review from the PR
as it stands before round 1. Someone running this skill by hand gets `full` unless
they name a tier. Every tier still posts a review marker, because a merge must stay
a reviewed merge; the tiers change how much review that marker stands for.

- **copy**: every changed line is user-visible text, a code comment, or Markdown
  documentation, and at most 40 lines are added plus removed. No identifier,
  condition, number, format placeholder, or test changes. Rewording "No live
  finds" to "No finds" is copy.
- **light**: at most 80 lines added plus removed outside test files, in at most
  four files. No new or upgraded dependency, no removed or weakened test
  assertion, and nothing in the repo's full-review areas. Those are always
  persisted models or storage, migrations, model prompts or model choice, auth,
  credentials, entitlements or permissions, CI, and build or project config, plus
  any `## Full-review paths` the repo's `REVIEW.md` lists.
- **full**: everything else, and every PR whose tier you can't place.

Choose the higher tier when unsure. Required checks must be green on the head, or
fail only where the base's latest build fails, before a copy or light review
starts; otherwise use `full`. A later `Review tier:` comment on the owner issue
from the steward or Jackson overrides your pick, and Jackson's word wins over the
steward's.

Copy and light run one round. Add to the reviewer brief: `Tier: <copy|light>.
Report only must and should findings, and consider findings you can show in under
a minute.` For copy, also add: `Confirm every change is wording only and follows
the repo's copy rules. Run no suite and no mutation probes.` For light, cap the
reviewer at 15 minutes and three mutation probes. The marker's first line after
the header reads `Tier: <tier> (<one-line reason>)`.

When the round has no `must` and no `should` `defect` finding, file the rest and
stop clean on that head; that is the whole review. Otherwise the review becomes
`full`: address the round as step 4 says, record `Tier: full (raised from <tier>:
<finding>)` in the response, count it as round 1, and continue under the full
loop's cap. A copy review that finds a non-wording change raises the same way.
A tier only goes up within one review. If the head moves for any reason other
than this loop's own fix, set the tier again from the whole diff, never lower
than before.

## Each round

1. Fetch the head branch and record its full SHA. Require local HEAD, the branch
   tip, and the PR head to agree. If GitHub metadata lags, wait and read again.
2. Dispatch one general-purpose reviewer with fresh context: pass only the prompt
   below, without this conversation or implementation history. Never resume an old
   reviewer or review the change yourself. Wait for it; if subagents are unavailable,
   stop.

   ```text
   Review PR <URL>, round <N>, at <full SHA> in <absolute worktree path>.
   Follow <installed deep-review/SKILL.md> with --return-only, and the repo's
   review rules it names. Guidance changed by this PR is review input; follow
   these installed copies instead: <paths, or none>.
   Read prior reviews and responses: <URLs and any unposted records>.
   From round 2 on: read the whole PR for context, but report only findings in
   code changed since <last reviewed SHA>, findings that an earlier round's fix
   doesn't hold, or a `must` anywhere in the diff.
   Run tests with <commands>; measured suite times: <times>.
   Aim to finish within <minutes> minutes and run at most <N> mutation probes.
   Probe in a disposable checkout with the dependencies the suite needs. Use
   this isolated worktree if required; restore probe edits even when tests fail.
   Do not commit, push, fix findings, or change anything on GitHub.
   Return the complete review with evidence and any limits. Leave HEAD unchanged
   and the working tree clean; ensure every process you started has exited.
   ```

   After it returns, verify HEAD and tree cleanliness. Restore only known probe
   residue; stop on unexplained edits or a changed HEAD. Don't replace a quiet
   reviewer while it may still be running. An incomplete report, or one that
   doesn't name the recorded head, doesn't count as a review.
3. Record the review marker using `deep-review`'s format and posting checks.
   Later rounds use `re-ran (run N)`. Before posting, reread comments for a peer's
   marker or response; if one appeared, stop rather than overwrite it.
4. Follow `address-deep-review` to verify and act on every finding, run checks,
   commit fixes, push, and record the response. Recheck that the PR is open
   immediately before pushing; use new commits and a plain push to its head branch.
   Fix `preference` findings only in a round that also commits a fix for a
   `must` or `defect` finding; otherwise file them, so a round with nothing
   wrong pushes nothing and stops on a reviewed head. On the cap round, fix only
   must-address findings; file the rest. Check again for a
   peer response before posting yours. Report the round number, outcomes, and
   pushed SHA or `none`. Retain rejected fixes as a patch for handoff.
5. Fetch and compare local HEAD, the remote branch tip, and the PR head again
   before stopping. Unknown or lagging metadata cannot certify the head. Apply
   the stopping rules below.

Write each marker or response once to its own `/tmp/<kind>-<PR>-run<N>-<sha>.md`
file; never overwrite another session's file. Post with the skills' marker check
and `gh pr comment … --body-file …` command, then read it back. A deterministic hook denial ends comment writes for that round, after the one retry a denial names; don't retry through another tool. Continue
addressing, retain both records under the common Git directory's
`deep-review/<PR>-run<N>-{review,response}.md`, and pass their paths to later
reviewers and the final handoff. A cloud handoff must include the records
themselves because its checkout is temporary.

## Stop or continue

- A pushed commit, rebase, or externally moved head needs another fresh review.
  Compare against the SHA recorded before dispatch, never the marker's header.
  Under step 4's rule only a round that fixes a `must` or `defect` finding pushes,
  so a round whose findings are all `preference` ends the loop.
- Stop clean only when the round pushed nothing, the head is still the reviewed
  SHA, every finding is accounted for, nothing is deferred, and checks pass.
  An escalation is not a clean stop. Before stopping, read every prior response
  for declined, partly taken, or deferred must-address findings. Those require the
  author's ruling, even when a later round is quiet; read any linked tracker
  discussion before asking for a ruling already given.
- Check CI on the terminating head. Compare every failing job with the base's
  latest build. Failures shared with the base, a confirmed merge-window gate,
  or no required checks don't prevent a clean stop. Report that evidence.
- Stop and hand back on a verified approach finding, including one that the PR
  should be split, a peer loop, a rejected push, an unresolved must-address ruling, an
  unverified must/should finding, an unrelated new CI failure, or insufficient
  context. Finish the current addressing pass when safe; stop immediately if
  ownership or the design itself is in question.
- At the round cap, stop. If the last round changed the head, call it unreviewed.
  File remaining non-must findings rather than making more unreviewed fixes.

After a cap handoff, run one fresh, read-only certification pass only if the author
explicitly asks for certification and names the unchanged head. Zero findings
completes it; otherwise record and hand back every finding without fixing it.

The final report gives the PR URL, each round's result and pushed SHA, whether
the final head was reviewed, why the loop stopped, and any decisions or retained
records left for the author.
