---
name: deep-review
description: Senior-engineer architectural review of a PR or branch. Goes beyond lint and correctness to evaluate abstraction design, modularization, data model fitness, TypeScript / React / Postgres craft, AI-code pitfalls, and forward-looking risks. Use when the user asks for a deep review, architectural review, senior-engineer review, thorough code review, or uses /deep-review. Also trigger when the user asks to "really look at" or "think hard about" a PR, or wants to know what they're missing. This skill owns finding and posting the review marker; the address-deep-review skill owns triaging findings and deciding when a PR is done, so read that one when you are acting on a review rather than writing one.
---

# Deep Review

A review through the lens of someone who has seen hundreds of production systems succeed and fail — not a checklist pass, but a judgment call on whether this code is set up to thrive.

## Arguments

`/deep-review` — review the current branch diff against the base branch
`/deep-review 136` — review PR #136

## Step 1: Gather context

1. **Get the diff.** If a PR number was given, use `gh pr diff <number>` (file list: `--name-only`; there is no `--stat` — use `git diff --stat <base>...HEAD` in a checkout). Otherwise, detect the base branch and run `git diff <base>...HEAD`. Write it to a file (`gh pr diff <n> --patch > /tmp/pr<n>.patch`) and check `wc -l` before reading — anything past a couple thousand lines exceeds the file-read tool's character limit, and you want to page it deliberately rather than discover the truncation halfway through.
2. **Read the PR description** if one exists (`gh pr view <number>` or the most recent commit messages). The description often contains intent that the code alone doesn't reveal — planned follow-ups, constraints, trade-offs the author already considered.
3. **Follow the ticket trail.** If the PR description, branch name, or commits reference a Linear ticket (e.g. `ENG-1234` or a `linear.app/...` URL), fetch it through the available Linear integration or the Linear REST API with `LINEAR_API_KEY`, and read the intent, acceptance criteria, and discussion. Then walk *up* the tree — the ticket's parent, its parent's parent, any parent initiative, and any linked/blocking tickets — until you've reconstructed the full intent the code is meant to satisfy. A sub-ticket routinely omits the "why" and the constraints that live only in the parent or initiative, and those are exactly what tell you whether the diff actually solves the problem or just a symptom. If Linear is unavailable or a referenced ticket can't be reached, note that in the review output rather than silently skipping.
4. **Read the changed files in full** (not just the diff hunks). Reviewing only the diff leads to missing how changes interact with surrounding code. If a file is very large, read at least the full module/class containing the changes. First confirm whether the current checkout is the reviewed PR head. If it is not, fetch the PR's copy through the available SCM tool or `gh api -H 'Accept: application/vnd.github.raw' repos/<owner>/<repo>/contents/<path>?ref=<headRefOid>`. Ask for the raw media type rather than base64-decoding `.content`, which comes back empty over 1MB. Do not mutate a protected or shared checkout just to inspect the PR; use the API or a disposable checkout.
5. **Read beyond the touched files.** The diff and its own files are never enough to judge whether a change fits. Pull the surrounding code: the callers of every changed function or signature (do they still hold?), the implementations it calls into, sibling modules that already solve the same problem, the types/schemas it depends on, and the existing tests for the area. Use `ast-grep` (or `rg`) to hunt for prior art and parallel patterns before judging an abstraction as novel, a utility as missing, or a convention as established — reviewing a change in isolation is the single biggest cause of false "looks fine" verdicts.

   This sweep is both the most context-hungry and the most delegable part of the review, so when code-exploration subagents are available, dispatch them in parallel — one per concrete question ("which endpoint feeds this UI?", "what gates this render path?", "does any existing code write this column?") — and ask each for file paths, line numbers, and short quotes. Reading the surrounding modules yourself costs a large share of the context you need for the analysis, and the findings that matter most are usually the ones that only appear when you look at a consumer the diff never touches.
6. **Check for related context.** Look at recent commits on the branch, open issues or PRs that reference similar areas, and any TODO/FIXME comments near the changed code.
7. **Load the team's review guidelines.** Many teams codify rules that outrank general judgment. Those documents are the single source of truth — this skill deliberately doesn't restate any of their rules, so read the relevant ones fresh each review rather than trusting memory or any summary. Sources, in order:
   - **In the repo:** `REVIEW.md` holds the active PR review rules — ignore `REVIEW_INACTIVE.md`. Also `style-guides/` (read the ones matching the diff's languages), `CLAUDE.md` / `AGENTS.md` at the repo root and in the app the diff touches, and `.cursor/rules/`.
   - **In Notion:** some guidelines live only there. If a Notion integration is available and the diff touches an area likely to have a written policy, search for it. Known docs: "Pull requests", "Database Migrations", and "SiteConfigs, envvars, Zuma secrets: Best practices for configuration". If Notion should have been checked but couldn't be reached, say so in the review output rather than silently skipping — the reader should know the review ran without those rules.
   - **Via other bots:** if the PR already has AI-reviewer comments (Greptile, Cursor, etc.), skim them — they sometimes link to the team's guideline docs, which tells you where the canonical rules live.

   When a finding violates a written rule, say so and point at the document — file and rule name for in-repo docs, page title and link for Notion. A finding sourced to the team's own rule lands differently than an unsourced style opinion. Conversely, don't flag style that the team's guides explicitly endorse.

## Verify by execution, not by reading

Do this before writing a finding, and prefer it to any amount of careful reading. Across four
PRs and fourteen review runs, every finding that changed the shape of the code came from running
something rather than from inspecting it — and the strongest ones came from deliberately
breaking the code and watching what failed to notice.

- **Run probes against the exact reviewed head in a disposable checkout.** Confirm the SHA before
  changing anything. If the current checkout is both disposable and already at that head, use it;
  otherwise create an isolated worktree or clone. Mutating the base branch proves nothing about the
  PR, and mutating a shared checkout risks somebody else's work.
- **Run the tests that cover the property first**, so you know the baseline you are perturbing.
  Run the whole suite only when the claim spans suites or is about the suite itself.
- **Gut a function and see what stays green.** Replace a body with a constant or an empty
  collection, re-run, and note what passes anyway. A test that survives its subject being deleted
  is testing nothing, and no amount of reading finds that. Keep a positive control: do the same
  surgery somewhere you expect a failure, to prove the suite runs at all.
- **Confirm the mutation actually landed before you believe a green run.** A `sed` that
  silently matched nothing, an anchor that had already changed, a patch applied to the wrong
  copy — each leaves the code untouched and the suite green, which reads exactly like "the test
  doesn't cover this" and is the opposite conclusion. Assert the edit (diff it, or use a tool
  that fails when its anchor is missing) rather than inferring it from the exit status.
- **Reproduce every number you are about to quote.** Do the arithmetic yourself. A review whose
  praise rests on a miscalculation is worse than one that says nothing, because it certifies the
  bug.
- **Withdraw a figure nobody can reproduce.** When neither you nor the author can re-derive a
  number in the PR body or in a finding, it comes out, and the review says why. A figure left
  standing because nothing can check it reads as checked: an unverifiable "8 of 8 sampled sessions"
  survived a whole review round that way.
- **Construct the input that breaks the claim.** For "this is a no-op", "nothing reads that", "the
  parser would fail on a bad row" — build the case and run it.
- Restore the working tree afterwards and say in the review that you did.
- **If the suite never starts** because knex says `The migration directory is corrupt, the following files are missing`, first treat it as an environment mismatch rather than a PR defect. Follow the test command the repo's own instructions require for the environment you're in, since a local worktree and a cloud run can need different ones. Do not roll back a shared database to make the branch pass.

**When timing is noise, count the mechanism instead.** Peer agents running their own suites can
put the noise floor above the effect you are measuring, and so can a fixture-heavy suite on an idle
machine. Before you quote a duration, time two variants that do identical work, interleaved with the
ones you are comparing. Their disagreement is your error bar, and a difference inside it is not a
finding. On one review two identical base runs differed by 3.3x, and the two columns under
comparison swapped order between passes. When the error bar swallows the effect, count what the
claim is about: subprocesses, syscalls, queries or requests. A count is deterministic under any
load, and for a claim about work done on a hot path it is closer to the claim than a duration is.
To count subprocesses, put a directory of one-line shims on `PATH` ahead of the real commands, each
appending its name to a log and then `exec`-ing the real binary. Resolve each real path when you
write the shim, because resolving it inside the shim finds the shim. Restore `PATH` before you read
the log, or the reporting commands count themselves. Shims see only commands found through `PATH`: a call by absolute path, a builtin, and a fork that never execs (`$(printf ...)`) all go uncounted, so a change that moves work into those looks free. When the claim covers them, count with `strace -f -e trace=execve,clone,clone3` instead.

**A long silent wait for the test runner is a queue, not a hang.** Where the repo's runner shares a
test lease, a suite that runs in a second can wait many minutes behind peers' full gates before it
starts. One reviewer lost 12 minutes of a 45-minute budget that way and cancelled the runs without
learning anything. Start the runs you'll need early and keep reading while they queue. The suite
times you were given are run times, so count queue time against your budget separately.

State per finding how you established it — measured, mutated, grepped, or read. "Read" is a
legitimate answer and a useful signal to the author about how hard to push back.

**On a re-run, suspect your own last round first.** The fixes written in response to a review are
the newest, least-exercised code on the branch, and in that same stack roughly one addressing
round in five introduced a defect that only the following review caught — including one that
re-created the exact bug the PR was opened to fix. Before hunting anywhere else, re-run the
probes that produced the last round's findings and check what the fixes for them touched.
Load the previous run from `GET .../issues/<n>/comments --paginate`, matching `<!-- deep-review-marker -->` on the comment's first non-blank line — a `GET .../comments/<id>` of an ID scraped from a truncated listing can 404.

## Step 2: Is this the right change?

Before judging how the change is built, ask whether it should be built this way at all. Everything below assumes the approach is sound, and this is the cheapest moment to say it isn't.

**First, reconcile with what the author said.** Step 1 gave you the description and the ticket — hold every candidate criticism against them before it becomes a finding. The failure mode is filing a deliberate choice as a defect: you find something that looks wrong, make it the headline, and the description called it a placeholder three lines in. Words like _placeholder_, _for now_, _disposable_, _throwaway_, _temporary_, _first pass_, and _scaffolding_ reframe severity rather than confirm it — the thing the author already flagged as provisional is not your top finding, and proposing to remove it is proposing to remove the deliverable. When you still think a stated choice is wrong, raise it as cost ("this is intentional, but here's what it risks") rather than as a bug, and weight it accordingly. Reading the description is not the same as honoring it; the mistake is reading it and then reasoning only from the diff.

- **Does it fix the problem or a symptom?** You reconstructed the intent in Step 1 — hold the diff against it. A change that makes the reported failure stop happening isn't the same as one that addresses why it happened.
- **What's the simplest thing that would work?** Sketch it, then compare. If the simpler version meets the same requirements, the burden is on the extra machinery to justify itself, not on the simpler version to prove it's enough.
- **Is there a materially different approach?** Not a variation on this one — a different shape. At write time instead of read time, in the database instead of the application, in a subsystem that already exists instead of a new one. If a reviewer would raise it, raise it first.
- **How does the codebase already solve this?** Find the existing answer before accepting a new mechanism — a hook, a helper, a config key, an override. The trigger to slow down is a diff that changes *shared* code (a base class, model plugin, schema layer, middleware, build step) to add a capability its callers will use. Read the mechanism's existing options, then grep every consumer for the same problem shape: not `rg gqlSerialize` (the thing being added), but `rg 'static excludeGql' models/` (what peers already declare). Three files solving it one way beats a fourth way even when the fourth is smaller or more general, because the next reader pattern-matches on the three. If the framework already exposes a hook, the whole change should collapse to a one-line declaration at the call site — and if it does, say so, because the author usually can't see the convention they didn't find.
- **Could this be smaller, or nothing?** Which parts could be dropped and still satisfy the requirement? Is any of it speculative — built for a need nobody has asked for? Sometimes config, deletion, or leaving it alone beats new code. Size the problem before you accept the mechanism: who hits it, how often, and what do they actually see — a crash, a wrong number, a null field, or nothing yet? Shared infrastructure needs a bigger problem behind it than a single call site does, and "zero rows and zero callers affected today" is a finding, not a footnote.
- **Does it belong here?** Right layer, right service, right repo. Code in the wrong place is a problem no amount of internal quality will fix.

Most changes pass this step. When one does, move on silently — a manufactured "have you considered" wastes the author's time and trains them to skim. But when a change genuinely should pivot, that outranks every other finding, so lead with it.

## Step 3: Architectural review

Think through each of these dimensions. Not every dimension applies to every PR — skip what's irrelevant, but don't skip what's merely subtle.

### Abstraction and modularization

- Are the abstraction boundaries drawn at the right level? Too early (premature abstraction over 2 cases) is as bad as too late (700-line function).
- Does each module have a single, clear reason to change? If a change to business logic forces a change to serialization code, the boundary is wrong.
- Are the interfaces between modules narrow and stable, or do they leak implementation details?
- Would a new team member understand where to put the next feature without asking?

### Data model fitness

- Do the data structures faithfully represent the domain, or are they shaped around the current UI / current query pattern?
- Are there implicit constraints that should be explicit (non-null, uniqueness, referential integrity)?
- Will this model accommodate the next 2-3 known requirements without a migration, or is it already tight?

### Error handling and edge cases

- Are failure modes handled where they can be handled well, not just where they're convenient to catch?
- Is there error handling that exists only to satisfy a linter or "just in case" — adding complexity without value?
- **For every guard, ask what satisfies it by construction in the place it actually runs.** Authors write the situation they pictured rather than the condition that has to hold — "must be on `master`" when what's needed is "the migrations directory matches `origin/master`", or a check on a branch *name* where the tool underneath reads the *filesystem*. Both pass wherever the author tested and refuse everywhere else, so trace each assertion to its real call site and name what is true there: a local checkout, a CI runner, a fresh clone. This is worth a deliberate pass, because it is invisible from the diff — the guard reads as correct right up until you ask which commit the caller is standing on.

### Naming and readability

- Do names carry enough meaning that the code reads like a description of its intent?
- Do a dedicated pass over every variable and function name introduced or renamed in the diff: is each one the clearest, most intuitive name for what it holds or does? Conventional generic names (`data`, `result`) are fine; the vagueness problem is names that seem specific/descriptive but are in fact vague and relatively meaningless on closer inpsection. Also flag names that are misleading (a `get*` that mutates, an `is*` that isn't boolean) or that describe the implementation instead of the intent.
- Are there abstractions whose names obscure rather than clarify (Manager, Handler, Processor, Utils)?
- Pay attention to the ordering of code from top to bottom in a file. What is the most natural way to read through the file — main entry point before helpers, high-level flow before details, related functions adjacent — and do the changes reflect that? New code appended at the bottom or inserted wherever the diff was convenient, rather than where a reader would look for it, makes the file harder to read for everyone after.

## Step 4: Stack-specific excellence

The default stack is TypeScript, React, and Postgres. Each has characteristic ways to be merely working versus actually well-built. Apply the relevant section when the diff touches that part of the stack; skip what doesn't apply. Where a repo guideline loaded in Step 1 conflicts with anything below, the repo's own rule wins — flag against it, not against this list.

### TypeScript

- `any`, `as any`, and `@ts-ignore` should be avoided / never used.
- Prefer `@ts-expect-error` over `@ts-ignore` when a suppression is genuinely needed — `@ts-expect-error` fails the build once the underlying error is gone, so the suppression cleans itself up instead of lingering and silently hiding the next bug.
- At trust boundaries — parsed JSON, `catch` clauses, external input — values are `unknown` and narrowed via guards or schema validation. Code that types `catch (e)` as `Error` without a check is wrong.
- Discriminated unions over optional-field soup. State that can be `loading | error | data` should not be three independent booleans that can encode impossible combinations.
- Generics that don't constrain are decoration. A `<T>` that flows through unchanged is a hint the function is `unknown`-shaped underneath; constrain or drop the parameter.
- `satisfies` for literal config and lookup tables — preserves narrow types while validating shape. `as` should be rare and load-bearing, not a way to quiet the compiler.
- Branded or opaque types for IDs, tokens, and untrusted strings when the project already uses them. Don't introduce branding for one PR.

### React

- Effects are for synchronizing with external systems. State derived from props or other state should be computed during render, not synced via `useEffect`. State updated in response to user events belongs in event handlers, not in effects watching the prior state.
- `useMemo` / `useCallback` only when referential identity actually matters — memoized child, effect dependency, context value. Defaulting to memoize-everything adds cost without benefit and obscures the real dependencies.
- `key` props are stable and unique under reordering. Index-as-key on a list that can be reordered, filtered, or inserted into will silently produce wrong UI and lost input state.
- State lives at the right level. Too high and re-renders ripple through the tree; too low and you get prop drilling or duplicated source-of-truth.
- Effects clean up after themselves — subscriptions, intervals, listeners, `AbortController`. Missing cleanup leaks memory and produces ghost updates after unmount.
- In RSC / Next.js contexts, the server/client boundary is deliberate. `"use client"` at the smallest leaf that needs it, data fetching kept on the server, no waterfalls created by sequential client fetches that could have been one server query.
- Suspense and error boundaries placed at meaningful units of fallback, not as a root catch-all.

### Postgres

- Indexes match the actual query patterns. New `WHERE` clauses, `ORDER BY`, and join keys should be checked against existing indexes; composite indexes are ordered equality-before-range, most selective first.
- Migrations are safe to run on a live table. `ALTER COLUMN TYPE`, adding `NOT NULL` without a default, and `CREATE INDEX` without `CONCURRENTLY` all take long locks on hot tables — flag them and ask for the plan.
- Constraints live in the schema, not in the application. `NOT NULL`, `CHECK`, `UNIQUE`, and `FOREIGN KEY` with deliberate `ON DELETE` semantics catch bugs the application layer will miss.
- Transaction boundaries are deliberate. Wide transactions hold locks and break under load; narrow transactions over multiple writes lose atomicity. Watch especially for transactions held across network calls or long computation.
- `timestamptz`, never `timestamp`, for anything representing a real moment in time. Money in `numeric`, never `float`. JSONB only when the data is genuinely schemaless — not as an escape hatch from schema design.
- N+1 queries from ORMs and dataloaders. Loops that hit the database or a service per item are the most common production hot spot in PRs that "work" in tests.
- Implicit type casts in `WHERE` clauses (`WHERE id = '123'` against a `bigint` column) silently disable index usage. ORMs sometimes do this by default — verify with `EXPLAIN` on anything performance-sensitive.

## Step 5: AI-code pitfalls

LLM-generated code has characteristic failure modes that experienced engineers consistently flag. These are the real complaints — not theoretical concerns but patterns that repeatedly waste reviewer time and cause production issues.

### Ignores the existing codebase

The most common complaint. AI writes standalone solutions with no awareness of the surrounding code. Look for:

- Reimplementing utilities that already exist in the project (search for similar functions before accepting new ones)
- Adding a dependency the project already solves with a different library (e.g., pulling in `date-fns` when `dayjs` is already used)
- Widening shared infrastructure — a base class, plugin, or schema layer — with a new extension point when the mechanism already exposes one that sibling consumers use for this exact case. This one hides well: the new hook is usually small, opt-in, correct, and verifiably safe, so it survives a review that only asks whether it works. Ask instead whether it was needed, by reading two or three peers that hit the same problem.
- Code that works in isolation but fights the grain of the project's established patterns — different data access style, different error conventions, different module structure

### Happy-path-only logic

AI writes the success case correctly, then handles failure shallowly or not at all. Look for:

- Missing edge cases: null inputs, empty collections, concurrent access, boundary values
- Generic try/catch that logs and continues instead of handling the failure meaningfully
- No consideration of what happens when an external call times out, returns unexpected data, or fails partially
- Security blind spots: unsanitized inputs, missing auth checks, hardcoded secrets, unsafe deserialization

### Wrong abstractions

AI imports patterns from training data regardless of fit. Look for:

- Design patterns with only one concrete implementation (a factory that builds one thing, a strategy with one strategy)
- Dependency injection in a script, repository pattern in a project using direct data access
- Merging visually similar code into a "universal" abstraction stuffed with conditionals — this is worse than the duplication it replaced
- Abstraction layers that exist to look professional rather than to solve a real separation-of-concerns problem

### Massive, unfocused diffs

Instead of a targeted change, AI generates new service classes, background workers, and full test suites when a 10-line fix was needed. Look for:

- Scope creep beyond what the PR description calls for
- New files or classes that could have been a function
- Refactoring mixed in with feature work (these should be separate PRs)

### "Almost right" code

The most dangerous pattern: code that compiles, passes superficial review, and has subtle logic errors that surface in production. Look for:

- Off-by-one errors in loops or pagination
- Conditions that are close but inverted or missing a case
- Code that works for the test case but not for real-world inputs
- Correct-looking async code with race conditions or missing awaits

### Hallucinated APIs

AI confidently references functions, parameters, or library versions that don't exist. Look for:

- Method calls that aren't in the library's actual API
- Mixing API styles from different versions of the same library
- Using deprecated APIs when current alternatives exist

### Style drift

When touching multiple files, AI drifts between conventions. Look for:

- Inconsistent naming across the same change (`userProfile`, `user_profile`, `profileUser`)
- Formatting or structural choices that don't match the surrounding code
- Test style that doesn't match the project's existing test patterns

### No concept of maintainability

AI optimizes for "works now" without considering how code will be read, extended, or debugged six months later. Look for:

- Layered patches on top of previous AI iterations instead of coherent rewrites
- Magic numbers or hardcoded values that should be named constants or configuration
- Code that's hard to test in isolation because of hidden dependencies or global state

## Step 6: PR hygiene

The PR is an artifact for human reviewers, not just a diff to merge. A well-built change can still be a bad PR.

- **Size.** A PR too large to hold in your head in one sitting gets rubber-stamped, not reviewed — defect detection starts dropping past ~200 lines of hand-written change and is near zero past ~400 (the SmartBear/Cisco study of 2,500 reviews). Recommend splitting into stacked PRs along natural seams (refactoring or formatting separated from feature code, or data model / backend / UI separation), and hold each slice to the `stacked-pr-rules` skill rather than restating those rules here. Generated files, lockfiles, and snapshots don't count against the budget, but call out when they bury the real diff.
- **Screenshots for UI changes.** Any visible UI change should carry a screenshot (before/after for modifications) or a short recording for interactions in the PR description. Reviewers shouldn't have to check out the branch to see what changed.
- **Description guides the review.** Intent, the non-obvious decisions, and where to focus. A description that narrates the diff adds nothing; one that explains why this approach was chosen saves a review round-trip. Flag a missing or diff-narrating description.

## Step 7: Forward-looking analysis

This is the part most reviews miss. Think about what happens _next_.

- Read the PR description and branch history for mentions of follow-up work, phases, or "upcoming PRs."
- Given the abstractions and data model chosen here, will the next likely changes be easy or painful?
- Are there coupling points that will force shotgun surgery when requirements shift?
- Is there implicit state or ordering that will surprise the next person who touches this code?
- Are there assumptions baked in (about scale, about single-tenancy, about deployment topology) that may not hold?

## Step 8: What are we missing?

Step back from the code and think about the problem itself.

- **Plan gaps.** Is there a requirement or constraint that the plan doesn't account for? A race condition, a permission model, a migration path, a rollback story?
- **Implementation gaps.** Is there something the plan calls for that the code doesn't actually do yet — silently deferred rather than explicitly deferred?
- **Unstated assumptions.** What does this code assume about its environment that isn't enforced? (Database state, feature flags, execution order, network availability.)

## Output format

Always deliver the complete review in the **chat reply to the user**. Compose and finalize that review before building the marker body, then use the same text in both places. The PR comment is a record, never a substitute; a failed or interrupted post must not, by itself, keep the full review out of the final chat response. **A caller's index request is the one exception.** When the prompt that invoked you asks for an index to the posted marker instead of the review, as a review-loop orchestrator does, and your marker posted, the marker is the delivery: return the index the caller asked for and don't paste the review again. If the marker didn't post, the caller's own rule for that case decides what your final message carries.

Structure your review as:

**Summary** — one paragraph on the overall quality and the single most important thing to address.

**Different approach** — only when Step 2 concluded the change should pivot or shrink substantially. Say what you'd do instead and why it's better, in a few sentences. This sits directly under the Summary, above the findings: a pivot recommendation filed under "Must address" reads like a bug report and gets triaged like one. Omit the heading entirely when the approach is sound — never manufacture one just to fill the format.

Then the findings, grouped by severity:

**Must address** — issues that will cause bugs, data loss, or significant maintenance burden.

**Should address** — design choices that will cause friction but aren't immediately dangerous.

**Consider** — suggestions that would improve the code but are judgment calls.

**What's working well** — things the author got right that are worth calling out, especially non-obvious good decisions. This isn't filler — recognizing good judgment is how teams calibrate.

Number every finding sequentially across the whole review, starting at 1 at the top of the output and continuing across sections without restarting (e.g. "Must address" has 1–3, "Should address" continues at 4, "Consider" continues at 5, and so on). Do not reset the counter at each section heading.

Within each group, lead with the most impactful item. For each finding, name the file and the concern, explain _why_ it matters (not just that it's "wrong"), and suggest a concrete alternative when you have one. When the alternative is code, run it before you write it down, through the same probe that showed the problem if there was one. If you can't run it, label it unverified. An untested fix in a review reads as a tested one.

**Tag every finding `defect` or `preference`**, independently of its severity. A defect means something behaves wrongly — a wrong result, a test that doesn't test its property, a citation attached to behaviour that isn't the source's — or that changed behaviour lacks the regression test the project's own rules require. Substack's `CLAUDE.md`, for example, asks for one on logic that isn't obvious from the diff, so a changed code path there that no test exercises is a `defect`: the suite no longer protects behaviour that changed. Show it with a mutant that stays green, or, when you can't run the suite, say so and tag it from the rule. A preference means the code reads differently than you would have written it. A test you'd merely like to have is a `preference`. Both are worth reporting and the two are not a ranking: a naming preference can sit in "Should address" and a defect in "Consider". The tag exists because severity answers "how much does this matter" and the author needs "is this wrong, or is this taste" to triage at all — and without it stated, everything reads as the former.

**Rate a bypass by who can reach it.** When a finding is a bypass, an evasion, or an adversarial input, say what the artifact defends against and who its adversary is, then rate the finding's reachability under that model. The file header or the PR usually says: a guard that fails open and exists to catch an honest mistake is a seatbelt, not a security boundary, and an input that no supported call path and no plausible mistake produces is unreachable under it. A bypass nobody can reach is `consider` at most, never must-address. On PR #285 five rounds of heredoc-delimiter evasions that no agent would ever type were each filed must-address, each was fixed, and a PR-body guard grew from 134 lines to 1045, about 800 of them a shell lexer.

End with a **Forward-looking risks** section if Step 7 surfaced anything worth flagging.

Then say, in one line, **whether this PR warrants another review round** — and say plainly that it doesn't when it doesn't. Findings decay but never reach zero, so a loop waiting for an empty review never ends; a run that turns up no defects is the signal, and only the reviewer is placed to give it. See the address-deep-review skill for what the author does with that.

Keep the review dense and direct. No preamble, no "great PR overall" throat-clearing. Respect the author's time.

There is no cap on the number of findings. Report everything genuinely worth reporting — never trim real findings to hit a tidy count or keep the output short. Density means each finding is stated tightly, not that findings get dropped.

## Post a marker comment on the PR

**Check PR authorship before posting.** Compare the PR author (`gh pr view <number> --json author --jq .author.login`) to the authenticated user (`gh api user --jq .login`) when both are available. On your own PR, post the marker comment as described below. On someone else's, don't post automatically — deliver the review in chat, then ask the user whether to post it, and only post if they say yes. In a cloud or CI run where the credential cannot resolve a user, post only when the caller has already established that this is the user's own PR; otherwise treat authorship as unconfirmed and do not post.

**A caller's explicit grant replaces this check.** When the prompt that invoked you contains the line `MARKER-POST-AUTHORIZED: <owner>/<repo>#<number>` and it names exactly the PR you are reviewing, skip the authorship check and post, whoever opened the PR. A review-loop orchestrator sends this line to every reviewer it dispatches, because invoking the loop on a PR is the decision to record the loop on it. The grant covers only this run's marker comment on that PR: no other PR, no review threads, and no replies to anyone. A grant naming a different PR, or prose such as "this is the user's own PR", is not a grant — run the check as usual.

When the review target is a PR (not a bare branch diff) and posting is allowed per the authorship check above, record that the review ran by posting one comment after the review text is final. Posting the comment does not replace the chat delivery — the user gets the full review in both places, unless a caller asked for an index and the post succeeded (see Output format). Style it like an automation, not a conversational comment — small text via `<sub>`, with the full review collapsed inside a `<details>` block.

Write the body file after every authorship, head, and tree preflight has finished, in its own tool call, and run the check below only once that write's result is back. Name it for this run and head — `/tmp/deep-review-marker-<number>-run<run>-<short-sha>.md`, where `<run>` is this run's number (1 on a first run) — and write the whole file in one overwriting write: the harness's file-write tool, or the truncating `cat >` below. Never append to it, and never use a patch tool's "add file" on a path that may already exist. Every reviewer once shared `/tmp/deep-review-marker-<number>.md`, and a patch-tool add over the previous round's file put the new review in front of the old one, so each marker carried every earlier round after its own `</details>`.

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

Before posting, check that the file holds exactly one review: its first non-blank line is the marker, and no other line outside a code fence consists of a marker alone — a second one, typically after the closing `</details>`, means an older body got in. Marker text quoted in prose or inside a fenced block is fine. This exits non-zero on a bad body; if it does, rewrite the file rather than posting:

```bash
awk '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "") } NF && !seen++ { first = $0 } fence == "" && match($0, /^(```+|~~~+)/) { fence = substr($0, 1, RLENGTH); next } fence != "" && $0 ~ ("^" fence "+$") { fence = ""; next } fence == "" && /^<!-- (address-)?deep-review-marker -->$/ { n++ } END { exit !(first == "<!-- deep-review-marker -->" && n == 1) }' /tmp/deep-review-marker-<number>-run<run>-<short-sha>.md
```

Then, in a separate shell call sent after the check's result is back (not in the same parallel batch, where it can run first), run only the posting command — no `cd` before it and nothing chained after it:

```bash
DEEP_REVIEW_SKILL=1 gh pr comment <number> --repo <owner>/<repo> --body-file /tmp/deep-review-marker-<number>-run<run>-<short-sha>.md
```

- Keep both HTML comments. The first is the marker this skill matches on; the second is how a later session learns the convention. An agent that returns days later to fix the findings usually never loads either skill — it just reads the PR's comments — so the instruction has to travel with the comment. It's invisible on GitHub, so it costs a human reader nothing.
- Keep the `DEEP_REVIEW_SKILL=1` prefix on this comment. Some setups run an agent hook that denies a bare `gh pr comment` so an agent can't reply to reviewers on your behalf; that prefix is the guard's one sanctioned exception, covering this marker and the response comment `address-deep-review` posts to it. Without the hook the prefix is an inert env var, so it's safe either way — but don't reuse it on any other comment.
- **Keep the posting command exact and standalone.** Local reply guards may validate the prefix, numeric PR, optional `--repo owner/repo`, temporary body-file path, and first non-blank marker. Chaining a preflight, reordering the flags, or wrapping the command changes that contract. If the canonical line is denied by a deterministic guard, don't retry it or invent another shape. Report the missing marker in chat and return any handoff the caller requested.
- Fill in the head commit SHA that was reviewed and the real finding counts. **If you were handed the SHA you were reviewing, use that one**; only fall back to `gh pr view <number> --json headRefOid` when you weren't, and know that it returns the head *now* rather than the head you read — if anything landed while you were writing, the header will name a commit you never saw.
- **Convert code citations before pasting.** A ` ```startLine:endLine:filepath ` fence is a Cursor-only affordance and renders as a broken code block on GitHub. Replace each with a permalink plus a plain fenced block: ``[`File.tsx#L464-L487`](https://github.com/<owner>/<repo>/blob/<sha>/<path>#L464-L487)`` followed by the snippet in a normal fence. Pin the SHA, never the branch. Those line numbers only stay true for files the PR didn't touch — for a changed file, cite it in prose instead of linking to lines that move.
- **One marker comment per review run.** A re-review posts a **new** marker comment rather than editing an earlier run's comment — each run's comment is the permanent record of that run, and the sequence of markers is the review history of the PR. Number the runs in the header (e.g. "deep-review ran on <sha>" for the first, "deep-review re-ran (run 2) on <sha>" after that), and it's helpful for a re-run's header to say in one line how the previous run's findings resolved. Put the another-round verdict there too, so it is readable without opening the details block. The only reason to edit an existing marker is an accidental duplicate run on the identical head SHA — fold it into the comment already there rather than leaving two. Append the duplicate below the original's `</details>` and leave out its `<!-- deep-review-marker -->` line: `review-loop-state` counts every such line outside a code fence, and two in one comment read as a corrupt record. The original's `<sub>` header stays the must-address count that `review-loop-state` reads, so a must-address finding only the duplicate raised still has to reach the addressing response even though that count leaves it out.
- Skip the comment entirely when reviewing a local branch with no PR, and say so in the chat output. On someone else's PR, ask before posting unless the caller granted `MARKER-POST-AUTHORIZED` for it (see the authorship check above).
- If the post fails with a permissions error (`403 Resource not accessible by integration`), the environment's GitHub credential can't write comments — some cloud runtimes use a scoped installation token. Don't retry, and don't reach for a personal access token. Check whether the harness exposes a PR-comment write tool and use it with the same body, markers included. Only when there is no sanctioned write path does the chat review become the sole delivery — say the marker couldn't be posted, and expect the next round to have no history to read.

## The marker is immutable; the response is its own comment

Push the fixes as **new commits** on the PR branch and a plain `git push` — never `git commit --amend` + force-push a branch that's been reviewed, which wipes GitHub's "changes since you last reviewed" so the reviewer can't see what moved. Squash into a clean history only at the very end, right before merge.

**This section is the mechanics only. The address-deep-review skill owns the judgment** — which findings to take, which to decline, and when the PR is done. Read it before changing any code in response to a review.

**A run's marker is never edited to record what was addressed.** The response to a review is a separate comment under `<!-- address-deep-review-marker -->`, and `address-deep-review`'s "Recording what you did" owns its shape — read that before writing one.

**Open your marker with `<!-- deep-review-marker -->` and never put `<!-- address-deep-review-marker -->` on that first line.** Automation classifies a comment by the marker its first non-blank line carries, so a review that opens with the response marker is read as an addresser's record and its finding table is scanned for declines — planting a blocking finding no round can clear. Quoting either string further down the body is fine, and a review arguing about the convention has to. `address-deep-review` carries the mirror of this rule.

Two reasons it works this way. A comment that both states findings and records their resolution has no stable content, so a reader can't separate what the review said at the time from what was written over it later. And comment editing is not available in every runtime, while comment creation usually is. A convention that depends on editing the marker is less reliable than a second comment.

To find the run you are responding to, list the PR's comments over REST (`gh api repos/<owner>/<repo>/issues/<number>/comments --paginate`) and match `<!-- deep-review-marker -->` on each comment's first non-blank line, taking the newest when several runs exist. Match it anywhere in the body and you pick up a comment that merely quotes it, which the rule above allows. Don't expect the header's SHA to still be in the branch — a legitimate rebase onto a newer base replaces it, so match the marker and take the newest run rather than concluding there's no marker for the current head. Quote that run's number and short SHA in your response, and don't open a comment of your own with the marker string — that is the line automation classifies on.

A finding can be resolved without a code change — record it as settled with a one-line reason when the review's own alternative was taken or it was answered in the PR body, and as declined when it was considered and rejected or, for a `consider` finding, routed to the tracker. Either way give the reason rather than leaving it looking ignored; don't fold a decline into settled, since address-deep-review counts declines separately to catch over-compliance.
