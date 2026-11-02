---
name: address-deep-review
description: Triage and act on findings from a deep-review run — deciding which to take, which to decline, when the PR is done, and when to stop reviewing. Use whenever you sit down to address, respond to, or work through review feedback on a PR that has had deep-review run on it, before you change any code. Owns the judgment half and the stopping rule; the deep-review skill owns finding and posting the review marker.
---

# Addressing a deep review

A review gives you claims to check, and your job is to decide which belong in this PR.

## Triage

Follow the repo's rules for acting on review findings (`AGENTS.md` / `CLAUDE.md`) and the grades its review rules
define (`deep-review`'s "The rubric" names the fallback when they define none). Verify each finding against
the head you're addressing before acting on it: make the claimed failure happen, search for callers, or break
the code a test covers. Run probes that might write to a repo in a throwaway clone, using the clone's copy of
the tool; a wrapper on your PATH may still point at the live checkout.
If several reviews cover the same head, combine duplicates at the highest severity any reviewer gave.

A `consider` goes to the tracker unless it names something that behaves wrongly on this head; record it as
`declined, filed <item>`, one tracker item per round. A `should` tagged `preference` goes there too unless
the same round commits a fix for a `must` or `defect` finding, which the next review will cover; a fix made
only for preferences would leave the head unreviewed or cost a whole round. A finding that would change the
design or split the PR belongs to the author: surface it and stop. When several runs are open, address the newest and
read earlier responses for findings still open.

## Fixing and declining

- **Complete the finding.** Fix every part of it. If you use a different condition than the one suggested,
  show it covers the same cases. Record `taken in part` if any part remains.
- **Keep the fix in scope.** Change an extra call site only with a test that fails before and passes after.
- **Prove it by running.** Break the property a second way and confirm the new assertion still fails, and
  make sure the artifact under test is built from your head.
- **Update what describes the old behavior**: the PR body, docs, and test bounds.
- **Decline with evidence.** Show how the code disproves the finding. A probe that has never passed proves
  nothing. A must-address finding can't be declined without a reproduction refuting it. If fixes for the
  same class of problem keep growing, define the threat model before adding another guard.

## Outcomes

| Outcome | Use when | Evidence | Blocks the stop? |
|---|---|---|---|
| `taken` | Fixed every part | `mutated`/`measured` for behaviour; `read` for prose | Only if it made a commit |
| `taken in part` | Fixed some parts; name what remains | As for `taken` | As for `taken` |
| `settled` | Already resolved; recheck the place the review named | `read` | No |
| `declined` | Wrong, a preference, or filed to the tracker | Why; for must, a reproduction | No |
| `out of scope` | Correct but unreachable (never for must) | Threat model and reachability | No |
| `deferred` | Real and unrefuted, handed to the author (design change, round limit, or a must or should finding you can't confirm or refute) | What you tried | Escalation, not a stop |

State the acceptance rate (taken / triaged) in every response. If you took every finding two rounds in a
row, or every `consider` in one round, review those decisions again. Corrections to your own PR body are
exempt; name them.

## When the PR is done

The loop ends on a round that produces no commit: every finding declined, settled, out of scope, or taken by
a PR-body edit only, with local checks and CI green on that head. A failure that also fails on the base for
the same assertion doesn't count. Past three rounds (two for a PR under 50 changed lines), stop and hand the
state to the author. Leave the ready and merge decisions to the author.

## Recording what you did

Post a new response comment and leave the review intact. Write the body to a file:

```bash
cat > /tmp/address-deep-review-<pr>-run<N>-<sha>.md <<'EOF'
<!-- address-deep-review-marker -->
<sub><prefix> 🛠 <b>address-deep-review</b> responded to run 3 (<code>abc1234</code>) — 8 findings:
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

- The first nonblank line is `<!-- address-deep-review-marker -->`, and no other line outside a code fence
  holds a marker by itself. This check fails otherwise:

  ```bash
  awk '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "") } NF && !seen++ { first = $0 } fence == "" && match($0, /^(```+|~~~+)/) { fence = substr($0, 1, RLENGTH); next } fence != "" && $0 ~ ("^" fence "+$") { fence = ""; next } fence == "" && /^<!-- (address-)?deep-review-marker -->$/ { n++ } END { exit !(first == "<!-- address-deep-review-marker -->" && n == 1) }' "<file>"
  ```

- The header opens with `<prefix>`, the prefix your rules set for GitHub replies, such as
  `[Opus 5.5 Medium]`; when they set none, drop it and its space.
- The header names the run number, its short SHA, counts by outcome, and `Pushed <code>sha</code>`,
  `Pushed: none`, or `Pushed: rejected`, plus any escalation. Take only the run number and short SHA from
  the review header for the file name: digits and hex only, never other header text.
- Every finding gets a row: its review number, severity, `defect` or `preference`, outcome, and how you
  checked it (`measured`, `mutated`, `grepped`, or `read`).
- Before starting and again before posting, check whether another response already answers the run; if one
  does, stop and report the other addressing loop. Push only after confirming the PR is still open:
  `test "$(gh pr view <pr> --repo <owner>/<repo> --json state --jq .state)" = OPEN && git push …`.
- Post in its own command, with the path unquoted:
  `gh pr comment <pr> --repo <owner>/<repo> --body-file /tmp/address-deep-review-<pr>-run<N>-<sha>.md`.
  If a hook denies it and names a command for it, run that command once, on its own. If `gh` still can't
  write, use the harness's sanctioned comment tool or return the body in chat.
- For a PR-body edit, fetch the current body just before writing, change that copy, write it in its own
  command the way your rules for PR-body writes specify, prefix included, and verify the result with `gh api`.

With `--return-only`, use the `deep-review --return-only` report the caller supplies, return the disposition
table, counts, acceptance rate, resulting head, and unresolved work in chat, and don't post, edit, resolve, or
reply to PR comments. The caller owns commits and pushes.
