# PR review guidelines

Shared review rules for pull requests. Reviewers, human or agent, read this file with the repo's own `REVIEW.md` and the `AGENTS.md` / `CLAUDE.md` files from the root down to each changed directory; those rules outrank this one. Project repos get it as a vendored copy at `.claude/REVIEW.base.md`; edit it in local-config, in `repo-tools/dot-agents-base/REVIEW.project.md`.

## Review behavior

**Only leave actionable review comments**
Don't describe what the code does. Comment only on a concrete bug, a security or correctness problem, a user-facing problem, or a specific actionable improvement. Don't comment on what CI already catches: type errors, failing tests, lint, formatting.

**Judge the approach before the details**
Before line comments, ask whether the change fixes the cause or a symptom, whether a materially simpler change, an existing helper, or the codebase's usual pattern for this kind of change would meet the same requirement, and whether new code belongs somewhere shared. If the approach is wrong, say so once at the top as `must` or `should`, name the precedent or alternative, and skip details it would make moot. Don't treat what the description calls a placeholder or first pass as the headline defect.

**Grade every finding**
Start each finding with `must` (blocks merge: a bug, data loss, a security hole, or a test that can't fail), `should` (fix if a `defect`: a design choice that will cause friction), or `consider` (optional; never blocks: a judgment call), then `defect` (behaves wrongly, or changes behavior without a required regression test) or `preference` (how you'd have written it). When a finding is a way around a check, such as input that slips past validation or an auth guard, grade it by who could actually send that input: if no real user, caller, or attacker can, it is `consider` at most.

**Say how you know**
Say whether you established a finding by running code, searching, or reading. Phrase a claim you could only read as something to check, not as fact, and drop any number you can't reproduce. If you can run code, prove a finding before you write it: break the code under test, or build the input that breaks the claim. Never touch a shared database or production to do it.

**Don't repeat other reviewers**
Skip a finding another reviewer already made unless you add a reproduction or a refutation. A finding the author declined with a counterexample stays declined unless you refute the counterexample, and one declined and filed in the tracker stays declined unless the head changes what it's about.

**Check what the diff doesn't show**

- Follow every changed flag, option, signal, or registration to all of its call sites, including ones the diff doesn't touch.
- Trace each guard to where it actually runs (CI runner, worker, cron, client, fresh clone) and check the condition that holds there.
- In code the typechecker can't see (untyped JS, Python, SQL, config, shell), confirm every API, method, and option the diff calls exists in the installed version.
- Flag a test that would stay green if its subject were deleted or its condition flipped.
- Flag requirements the linked issue names that the code silently defers, and plan gaps: a race, a permission model, a migration path, a way to roll it back.

**On re-review, check the last round's fixes first**
Commits that answer earlier comments are the least-exercised code in the PR.

## Code

**Flag common LLM artifacts**

- Happy-path-only code: unhandled empty, null, boundary, timeout, or partial-failure cases.
- Almost-right logic: off-by-one bounds, inverted or incomplete conditions, a missing `await`, races between requests or jobs.
- Errors caught where convenient rather than where they can be handled.
- Defensive checks for states that can't happen, and fallbacks on a cutover that should work or fail loudly.
- Abstractions with one caller, and options nobody sets.
- Layered patches on an earlier attempt instead of a coherent rewrite.
- Comments that narrate the change or are written for the reviewer.

**Names match what the code does**
Flag a `get*` that mutates its input or has side effects, an `is*` / `has*` that isn't boolean, a name that describes the implementation instead of the intent, and anything exported only so a test can reach it.

**Stack-specific checks**

- TypeScript: type parsed JSON and external input as `unknown` and narrow it; model exclusive states as a discriminated union, not optional fields or parallel booleans; no `any` or `@ts-ignore`.
- React: derive values during render instead of copying them into state with `useEffect`; stable keys, never an index on a list that can reorder; effects clean up what they start.
- SQL: indexes match the new `WHERE`, `ORDER BY`, and joins; a deliberate `ON DELETE`; no N+1 loops; no transaction held open across a network call; migrations safe on a live table.
- Shell: quote expansions, check exit status, and don't assume a tool or flag the target machine may not have.

**Tests**
A test must exercise the delivered path (the route, or the component mounted through its real parent), not a parallel helper. A regression test fails without the fix.

## Pull requests

**Descriptions explain motivation and evidence**
A description explains why the change is made, not a recap of the diff. A change to what users see needs screenshots. Past about 400 hand-written changed lines, not counting generated files and lockfiles, name the seam it should be split along.

**Clean up what the change leaves dead; keep unrelated edits out**
Ask for removal of anything the PR makes dead, and flag unrelated edits, stray files, and documentation churn the change doesn't need.
