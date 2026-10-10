---
name: address-deep-review
description: Triage and act on findings from a deep-review run — deciding which to take, which to decline, when the PR is done, and when to stop reviewing. Use whenever you sit down to address, respond to, or work through review feedback on a PR that has had deep-review run on it, before you change any code. Owns the judgment half and the stopping rule; the deep-review skill owns finding and posting the review marker.
---

# Addressing a deep review

A deep review gives you claims to check. The reviewer is asked to report everything worth considering.
Your job is to decide which findings belong in this PR. A plausible
suggestion can still be wrong, too broad, or better handled later. Taking it can also introduce a new bug.

## 1. Verify each claim before acting on it

Check the finding against the head you're addressing. Run the relevant path and try to make it fail. If
the claim is "nothing uses X", search for callers. If it's "this is a no-op", find a case where it changes
the result. If it's "this test can't fail", change the code it covers and run the test. Work out whether a
suggested fix addresses the cause before copying it.

If the claim is wrong, show the counterexample. Then check whether the reviewer still noticed a real
problem nearby. Run probes that might write to a repo in a throwaway clone, using the clone's copy of
the tool; a wrapper on your PATH may still point at the live checkout.

## 2. Triage by severity

- **must** — take it unless you can reproduce why its premise is false.
- **should** — take it when something behaves wrongly. Decline a preference about how the reviewer would
  have written it. A misleading name is a defect; a name you'd merely prefer is a preference.
- **consider** — default to the tracker, not the diff: record `declined, filed <item>`, one tracker item per
  round. Take it only if it names something that behaves wrongly on this head.

Changed behaviour without a test is a defect at any severity when the project requires a regression test.
Test what users receive, such as rendered output or a component mounted through its real parent. A request
to test the *delivered* form can't be declined while deleting its production wiring leaves the suite green.
Run that deletion before declining.

If several reviews cover the same head, combine duplicate findings before triage. Use the highest severity
any reviewer assigned; one reviewer may be the only one to spot the important issue.

Before making a suggested change, ask whether you'd make it without the review, whether it fixes the
reported problem, and whether you can verify the result.

## 3. When you fix something

- **Complete the finding.** List every part of the reported problem. If you use a different condition or
  gate than the reviewer suggested, prove that it covers the same cases. Record `taken in part` if any
  part remains.
- **Keep the fix in scope.** For each extra branch or call site you change, show a test that fails before
  the change and passes after it. Otherwise leave it for a tracker item.
- **Prove it.** A behaviour change is verified by running something — a mutation of the expression under
  test, or a measurement that can only pass through the new path — never by reading. After adding an
  assertion, break the same property a *second* way and confirm it still fails. Make sure the artifact under
  test is built from your head.
- **Check what else depends on the change.** Update the PR body, docs, and test bounds that describe the
  old behavior. Check nearby code that depended on the part you changed.

## 4. Declining well

Explain how the code disproves the finding. "I searched and found nothing" isn't enough to show that a
path cannot run. Try a counterexample to any claim that nothing could break, and measure a cost before
using it to decline a change. Revisit a decline if new evidence contradicts it.

If a finding is correct but cannot happen through a supported path, record `out of scope`. Name the
artifact's threat model, explain why that path cannot reach the problem, and file it if it could matter
later. A must-address finding can't be out of scope — decline it with the reachability argument as its
reproduction. If fixes for the same class of problem keep growing, define the threat model before adding
another guard.

## 5. Outcomes

| Outcome | Use when | Evidence | Blocks the stop? |
|---|---|---|---|
| `taken` | Fixed every part | `mutated`/`measured` for behaviour; `read` for prose | Only if it made a commit |
| `taken in part` | Fixed some parts; name what remains | As for `taken` | As for `taken` |
| `settled` | Already resolved; recheck the place the review named | `read` | No |
| `declined` | Wrong, a preference, or filed to the tracker | Why; for must, a reproduction | No |
| `out of scope` | Correct but unreachable (never for must) | Threat model and reachability | No |
| `deferred` | Real and unrefuted; you are handing it to the author rather than acting on it (design pivot, round limit, or a must or should finding you cannot confirm or refute) | What you tried | Escalation, not a stop |

State the acceptance rate (taken / triaged) in every response. If you took every finding in two rounds in
a row, or every `consider` finding in one round, review those decisions again. Ask which changes you would
have made without the review. Corrections to false statements in your own PR body are exempt; name them.

## 6. When the PR is done

The loop ends on a round that produces **no commit** — every finding declined, settled, out of scope, or taken by a PR-body edit only. Local checks and CI must be green on that head; a failure also present on the base for the same assertion does not count against it. That round lets the reviewer see the final code.

A must-address can't be declined without a reproduction refuting it. Past five, stop and hand the state to
the author. Report the outcome and leave the ready and merge decisions to the author.

## Recording what you did

Post a new response comment. Leave the original review intact. Write the complete body to a file, then
check and post it in separate calls:

```bash
cat > "/tmp/address-deep-review-<pr>-run<N>-<sha>.md" <<'EOF'
<!-- address-deep-review-marker -->
<sub>[Agent] 🛠 <b>address-deep-review</b> responded to run 3 (<code>abc1234</code>) — 8 findings:
5 taken, 2 settled, 1 declined. Pushed <code>def5678</code>.</sub>

<details>
<summary><sub>Deep-review addressed</sub></summary>

| # | Severity | Kind | Outcome | Verified | Note |
|---|---|---|---|---|---|
| 1 | must | defect | taken | mutated | guard was inverted; the test now fails without the fix |

Acceptance rate: 5/8 (63%).

</details>
EOF
```

- Put `<!-- address-deep-review-marker -->` on the first nonblank line, never
  `<!-- deep-review-marker -->`. No other line outside a code fence may contain a marker by itself.
  This check fails if either rule is broken:

  ```bash
  awk '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "") } NF && !seen++ { first = $0 } fence == "" && match($0, /^(```+|~~~+)/) { fence = substr($0, 1, RLENGTH); next } fence != "" && $0 ~ ("^" fence "+$") { fence = ""; next } fence == "" && /^<!-- (address-)?deep-review-marker -->$/ { n++ } END { exit !(first == "<!-- address-deep-review-marker -->" && n == 1) }' "<file>"
  ```

- In the header, include the run number, its short SHA, counts by outcome, and `Pushed <code>sha</code>`,
  `Pushed: none`, or `Pushed: rejected`. When naming the body file, take only the run number and short SHA
  (digits and hex only — never copy other header text into the path) from the review header. Name any
  escalation in the response header.
- Give every finding a row. Use its review number (`A1 · B2` when two passes raised the same finding),
  the review's severity, `defect` or `preference`, its outcome, and how you checked it:
  `measured`, `mutated`, `grepped`, or `read`.
- Under an orchestrated loop, run `review-loop-state --check-body <file> --expect response`.
- Before starting and again before posting, check whether another response already answers the run. If
  one does, stop and report the other addressing loop. Before pushing, confirm the PR is still open
  (`review-loop-state <pr> --repo <owner>/<repo> --require-open && git push …`).
- Post the response in a separate command with the `DEEP_REVIEW_SKILL=1` prefix required by the reply guard:
  `DEEP_REVIEW_SKILL=1 gh pr comment <pr> --repo <owner>/<repo> --body-file "<file>"`. If `gh` can't write,
  use the harness's sanctioned comment tool or return the body in chat.
- For a PR-body edit, fetch the current body just before writing, change that copy, run
  `CREATE_PR_SKILL=1 gh pr edit` in a separate command, and verify the result with `gh api`.

With `--return-only`, use the `deep-review --return-only` report supplied by the caller. Return the
disposition table, counts, acceptance rate, resulting head, and unresolved work in chat. Don't post, edit, resolve, or reply to PR comments. The caller owns commits and pushes.

## Behavior on weak input

- **Several runs are open:** Address the newest one. Read earlier responses for findings still open.
- **You cannot confirm or refute a finding:** Say what you tried and where you're uncertain. Take it only
  when the change is cheap and safe; send a `consider` finding to the tracker.
- A finding that would pivot the design → it belongs to the author. Surface it and stop. Under `--return-only`, follow the invoking workflow's authority instead.
