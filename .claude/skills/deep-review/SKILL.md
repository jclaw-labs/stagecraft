---
name: deep-review
description: Senior-engineer architectural review of a PR or branch. Goes beyond lint and correctness to evaluate whether the change is the right one, how it fits the codebase, and what it will cost later. Use when the user asks for a deep review, architectural review, senior-engineer review, thorough code review, or uses /deep-review, or asks to "really look at" or "think hard about" a PR. This skill owns finding and posting the review marker; the address-deep-review skill owns triaging findings and deciding when a PR is done, so read that one when you are acting on a review rather than writing one.
---

# Deep Review

Judge whether this change is set up to work and to last — not a checklist pass. The findings that
matter most come from running the code and from reading what the diff doesn't show.

`/deep-review` reviews the current branch against its base; `/deep-review 136` reviews PR #136;
`/deep-review [136] --return-only` returns the complete review to the caller without publishing it.

**`--return-only` and coordinators.** With `--return-only`, skip the authorship check, the marker, and
every comment write: don't post, edit, resolve, or reply, and don't ask whether to publish. Return the full
numbered report with the exact base, merge-base, and head reviewed, the caller's run ID if it gave one, your
evidence and its limits, and the another-round verdict. The review criteria don't change. When a
coordinator invokes you, review the committed snapshot it names and return findings; don't take over the
implementation, Git, or the PR, and run destructive probes only in a disposable checkout.

## 1. Gather context

- **The diff and the PR description.** If a coordinator named a snapshot, diff exactly that:
  `git diff <base>...<head>` (`gh pr diff` only shows the pushed head). Save the diff to a file and check its length before reading.
  The description carries intent the code can't: placeholders, planned follow-ups, accepted trade-offs.
- **The ticket trail.** If the PR names a Linear ticket, read it, then walk up its parents and linked
  tickets until you know what problem the code is meant to solve. Sub-tickets routinely omit the why. If a
  ticket can't be reached, say so in the review.
- **Changed files in full, at the reviewed head.** If your checkout isn't that head, read files through
  `gh api -H 'Accept: application/vnd.github.raw' repos/<owner>/<repo>/contents/<path>?ref=<sha>`. Never
  mutate a shared checkout to inspect a PR.
- **Beyond the touched files.** Callers of every changed signature, what it calls into, sibling code that
  already solves the same problem, and the existing tests. Most false "looks fine" verdicts come from
  reviewing a change in isolation. Delegate these questions to exploration subagents in parallel when you can.
- **The team's written rules.** `REVIEW.md`, plus the area `REVIEW.md` it lists for each directory the diff
  touches (not `REVIEW_INACTIVE.md`), `style-guides/`, `.cursor/rules/`,
  and every `CLAUDE.md` / `AGENTS.md` from the repo root down to each directory the diff touches — nested
  ones (a `frontend/CLAUDE.md`, a `db/migrations/CLAUDE.md`) carry rules the root doesn't, such as i18n. Some live only in Notion: search it
  when the diff touches an area likely to have a policy (known docs: "Pull requests", "Database
  Migrations", "SiteConfigs, envvars, Zuma secrets: Best practices for configuration"), and say so if it
  couldn't be reached. Other bots' comments on the PR often link the canonical docs. Read the rules fresh,
  cite the rule when a finding breaks one, and don't flag what they endorse.

## 2. Verify by execution

Before writing a finding, try to prove it by running something. Reading is a fallback, not the default.

- Probe the exact reviewed head in a disposable checkout or clone. Run the tests covering the property
  first, so you know the baseline.
- **Break the code and see what stays green.** Gut a function or flip a condition; a test that survives
  its subject being removed tests nothing. Confirm each mutation actually landed (diff it) before trusting
  a green run, and keep a positive control.
- **Construct the input that breaks the claim** — for "this is a no-op", "nothing reads that", "this can't
  happen".
- Reproduce every number you quote; withdraw one nobody can reproduce. If timing is too noisy, count the
  work instead (queries, subprocesses, requests).
- **Check that every API the diff calls exists** — the method, its options, and the installed version of the
  library. Hallucinated calls and options mixed across library versions read fine and fail at runtime.
- A suggested fix that is code gets run before you write it down, or is labelled unverified.
- Restore the tree afterwards and say so. If the suite won't start for an environment reason (a knex
  "migration directory is corrupt"), follow the repo's own test instructions; never roll back a shared
  database to make a branch pass. A runner that shares a test lease can queue for minutes, so start runs early.

State per finding how you established it: measured, mutated, grepped, or read. A claim you could only read
is phrased as something to check, not as fact.

**On a re-run, suspect the last round's fixes first.** They are the newest, least-exercised code on the
branch. Re-run the probes behind the previous findings and check what the fixes touched. Find the previous
run by listing `issues/<n>/comments` and matching `<!-- deep-review-marker -->` on a comment's first
non-blank line. In `--return-only` mode, use the previous reports and dispositions the caller supplies
instead; those runs posted no marker.

## 3. Is this the right change?

Ask this before judging how it's built.

- **Honor the author's stated intent.** Hold every candidate finding against the description and ticket.
  Something the author called a placeholder, temporary, or first pass is not your headline defect; if you
  still think it's wrong, raise it as a cost.
- **Problem or symptom?** Does the change address why the failure happened?
- **What's the simplest thing that would work?** Sketch it and compare. If it meets the same requirements,
  the burden is on the extra machinery to justify itself.
- **Is there a materially different approach?** A different shape, not a variation: at write time instead of
  read time, in the database instead of the application, in a subsystem that already exists.
- **How does the codebase already solve this?** When a diff widens shared code — a base class, plugin,
  schema layer, middleware — to add a capability, grep what sibling consumers already declare for the same
  problem. Three files solving it one way beat a fourth way. If an existing hook makes the change a
  one-liner at the call site, say so.
- **Smaller, or nothing?** Size the problem: who hits it, how often, what they see. Drop speculative parts;
  sometimes config, deletion, or leaving it alone beats new code.
- **Right place?** Layer, service, repo.

Most changes pass. Say nothing then. When one should pivot, that outranks every other finding.

## 4. Review the build

Skip what doesn't apply, but don't skip what's merely subtle. The team's written rules outrank everything
below; flag against them, not against this list.

**Design and complexity.**

- Abstraction boundaries at the right level: premature abstraction over two cases is as bad as a 700-line
  function. Each module has one reason to change, and narrow interfaces that don't leak implementation.
- Patterns with one implementation (a factory that builds one thing, a strategy with one strategy), and
  similar-looking code merged into a "universal" abstraction stuffed with conditionals — worse than the
  duplication it replaced.
- Error handling that exists only "just in case" or to satisfy a linter; failures caught where convenient
  rather than where they can be handled.
- A data model shaped around today's UI or query instead of the domain; implicit constraints that should
  be explicit; a model already too tight for the next two or three known requirements.

**Naming and readability.** Make a dedicated pass over every name the diff introduces or renames, and
for each function compare the name with what its body actually does: does it mutate an argument, have a
side effect, or return something other than the name promises (a `get*` that sorts its input in place, an
`is*` that isn't boolean)? Name anything that exists only so a test can reach it. Beyond that, the problem
is rarely generic names like `data`; it's names that sound specific but are vague on a second look, and
names that describe the implementation instead of the intent. Check file order too: entry point before helpers, related functions
together, new code where a reader would look for it rather than appended at the bottom.

**AI-code pitfalls.** Most of these diffs are written by agents, and their failures are characteristic:

- Ignoring the codebase: reimplementing a utility that exists, adding a dependency for something an
  existing one already solves, fighting the project's data-access, error, or module conventions.
- Happy-path-only logic: missing nulls, empty collections, boundaries, timeouts, partial failures,
  concurrent access; generic catch-and-log; missing auth checks or unsanitized input.
- Massive, unfocused diffs: new services, workers, or full suites where a ten-line fix was needed; scope
  beyond the description; refactoring mixed into feature work.
- "Almost right" code: off-by-one, a condition inverted or missing a case, a missing `await`, a race.
- Style drift across files (`userProfile` / `user_profile`), and tests that don't match the project's own.
- Layered patches on earlier agent iterations instead of a coherent rewrite; magic numbers; hidden
  dependencies that make code hard to test.

**Stack-specific.** Agents repeatedly ship these; flag them when the diff touches that part of the stack.

- TypeScript: no `any`, `as any`, or `@ts-ignore` — use `@ts-expect-error` when a suppression is truly
  needed. Values at trust boundaries (parsed JSON, `catch`, external input) are `unknown` and narrowed.
  Discriminated unions over optional-field soup or parallel booleans. Generics that constrain something.
  `satisfies` for literal config; `as` rare and load-bearing. Branded IDs only where the project already
  uses them.
- React: derive state during render, don't sync it with `useEffect`; event responses go in handlers.
  `useMemo`/`useCallback` only when identity matters. Stable `key`s, never an index on a reorderable list.
  State at the right level. Effects clean up. `"use client"` at the smallest leaf; no client fetch
  waterfalls. Suspense and error boundaries at meaningful units.
- Postgres: indexes match the new `WHERE`/`ORDER BY`/joins. Migrations safe on a live table (no
  `ALTER COLUMN TYPE`, `NOT NULL` without default, or `CREATE INDEX` without `CONCURRENTLY` on hot tables).
  Constraints in the schema, with deliberate `ON DELETE`. Transactions neither too wide (held across
  network calls) nor too narrow. `timestamptz`, money in `numeric`, JSONB only for truly schemaless data.
  No N+1 loops. No implicit casts in `WHERE` that disable an index.

**PR hygiene.** A PR too big to hold in your head gets rubber-stamped: detection drops past ~200 lines of
hand-written change and is near zero past ~400. Recommend splitting along natural seams (refactor apart from
feature, data model / backend / UI), held to the `stacked-pr-rules` skill. Generated files and lockfiles
don't count, but say when they bury the diff. A visible UI change needs screenshots. A description that
narrates the diff instead of giving intent, decisions, and review focus is a finding.

**Easy to miss:**

- **Follow every changed flag, signal, or extension to all of its call sites and registration paths** —
  including the ones neither the diff nor the previous round touched. List them, then check each passes or
  registers the new thing. A fix that threads a value through three paths and misses a fourth, or an
  extension defined but never registered where the app actually builds it, reads correct everywhere you look.
- **Trace every guard to where it actually runs.** Authors write the situation they pictured — "must be on
  `master`", a check on a branch name — rather than the condition that has to hold. Name what is true at
  the real call site: a local checkout, a CI runner, a fresh clone.
- **Look for what the diff doesn't do yet.** Requirements the ticket names that the code silently defers;
  plan gaps (a race, a permission model, a migration path, a rollback story); assumptions about
  environment, flags, or ordering that nothing enforces; and whether the next likely change — follow-ups
  the description names — will be easy or will need shotgun surgery.

## Output format

Always deliver the complete review in the chat reply. The PR comment is a record, never a substitute; a
failed or interrupted post must not, by itself, keep the full review out of the final chat response.
**A caller's index request is the one exception.** When the prompt that invoked you asks for an index to
the posted marker instead of the review, and your marker posted, the marker is the delivery: return the index the caller asked for and don't paste the review again. If the marker didn't post, the caller's own rule for that case decides what your final message carries.

- **Summary** — one paragraph: overall quality and the single most important thing.
- **Different approach** — only when §3 says pivot or shrink; omit otherwise. It sits above the findings
  because a pivot filed under "Must address" reads like a bug report and gets triaged like one.
- **Must address** — bugs, data loss, tests that don't test their property.
- **Should address** — design choices that will cause friction.
- **Consider** — judgment calls.
- **What's working well** — non-obvious good decisions.
- **Forward-looking risks** — only if any.
- One line: **whether this PR warrants another review round**. Say plainly when it doesn't.

Number findings sequentially across all sections, never restarting, and lead each section with its most
impactful item. For each: the file, the concern, why it
matters, a concrete alternative, and how you established it. **Tag every finding `defect` or
`preference`**, independent of severity: a defect behaves wrongly, or is changed behaviour without the
regression test the project's own rules require; a preference is how you'd have written it.

**Rate a bypass by who can reach it.** When a finding is a bypass or an adversarial input, say what the artifact defends against and who its adversary is, then rate the finding's reachability under that model. A bypass nobody can reach is `consider` at most, never must-address.

Report every finding worth the author's time, and only those. Dense, no preamble.

## Post a marker comment on the PR

Skip this section entirely in `--return-only` mode.

**Authorship.** On your own PR, post. On someone else's, deliver in chat and ask first — unless the
prompt contains `MARKER-POST-AUTHORIZED: <owner>/<repo>#<number>` naming exactly this PR. That grant covers
only this run's marker on that PR. With no PR, skip the comment and say so. Posting doesn't replace the
chat delivery: the user gets the full review in both places, unless a caller asked for an index and the post succeeded.

Write the body in one overwriting write, to a path named for this run and head:

```bash
cat > /tmp/deep-review-marker-<number>-run<run>-<short-sha>.md <<'EOF'
<!-- deep-review-marker -->
<!-- Agent addressing these findings: read the address-deep-review skill first -- it owns which findings to take, which to decline, and when this PR is done. Record what you addressed in a NEW comment of your own, per that skill's "Recording what you did". Don't edit this one: it is the permanent record of what this run found, and it stays that way. One exception, and it is a reviewer's to make rather than yours: an accidental duplicate run on this same head gets folded into this comment instead of posting a second. -->
<sub>[Agent] 🔍 <b>deep-review</b> ran on <commit-sha> — <N> findings (<M> must-address). Full review below.</sub>

<details>
<summary><sub>Full review</sub></summary>

<the complete review, exactly as delivered>

</details>
EOF
```

Check it holds exactly one review; it exits non-zero otherwise, and then you rewrite the file:

```bash
awk '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "") } NF && !seen++ { first = $0 } fence == "" && match($0, /^(```+|~~~+)/) { fence = substr($0, 1, RLENGTH); next } fence != "" && $0 ~ ("^" fence "+$") { fence = ""; next } fence == "" && /^<!-- (address-)?deep-review-marker -->$/ { n++ } END { exit !(first == "<!-- deep-review-marker -->" && n == 1) }' /tmp/deep-review-marker-<number>-run<run>-<short-sha>.md
```

Then post in its own call, in exactly this shape with nothing chained, because the reply guard allows only
this line:

```bash
DEEP_REVIEW_SKILL=1 gh pr comment <number> --repo <owner>/<repo> --body-file /tmp/deep-review-marker-<number>-run<run>-<short-sha>.md
```

If a guard denies it, or the credential can't write, use the harness's sanctioned comment tool or say the
marker didn't post. Don't retry with another shape or a personal token.

- Use the SHA you were handed; otherwise the head you actually read.
- Re-runs post a new marker ("deep-review re-ran (run 2) on <sha>"), with one line on how the last run's
  findings resolved and the another-round verdict. Never edit an earlier marker, except to fold an accidental
  duplicate on the identical head below its `</details>`, without the duplicate's marker line.
- Replace Cursor-only ` ```start:end:path ` citations with SHA-pinned permalinks.
- Never open the marker with `<!-- address-deep-review-marker -->`; automation classifies on the first line.
