---
name: deep-review
description: Senior-engineer architectural review of a PR or branch. Goes beyond lint and correctness to evaluate abstraction design, modularization, data model fitness, AI-code pitfalls, and forward-looking risks. Use when the user asks for a deep review, architectural review, senior-engineer review, thorough code review, or uses /deep-review. Also trigger when the user asks to "really look at" or "think hard about" a PR, or wants to know what they're missing.
---

# Deep Review

A review through the lens of someone who has seen hundreds of production systems succeed and fail — not a checklist pass, but a judgment call on whether this code is set up to thrive.

## Arguments

`/deep-review` — review the current branch diff against the base branch
`/deep-review 136` — review PR #136

## Step 1: Gather context

1. **Get the diff.** If a PR number was given, use `gh pr diff <number>`. Otherwise, detect the base branch and run `git diff <base>...HEAD`.
2. **Read the PR description** if one exists (`gh pr view <number>` or the most recent commit messages). The description often contains intent that the code alone doesn't reveal — planned follow-ups, constraints, trade-offs the author already considered.
3. **Read the changed files in full** (not just the diff hunks). Reviewing only the diff leads to missing how changes interact with surrounding code. If a file is very large, read at least the full module/class containing the changes.
4. **Check for related context.** Look at recent commits on the branch, open issues or PRs that reference similar areas, and any TODO/FIXME comments near the changed code.

## Step 2: Architectural review

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

### Naming and readability
- Do names carry enough meaning that the code reads like a description of its intent?
- Are there abstractions whose names obscure rather than clarify (Manager, Handler, Processor, Utils)?

## Step 3: AI-code pitfalls

LLM-generated code has characteristic failure modes that experienced engineers consistently flag. These are the real complaints — not theoretical concerns but patterns that repeatedly waste reviewer time and cause production issues.

### Ignores the existing codebase
The most common complaint. AI writes standalone solutions with no awareness of the surrounding code. Look for:
- Reimplementing utilities that already exist in the project (search for similar functions before accepting new ones)
- Adding a dependency the project already solves with a different library (e.g., pulling in `date-fns` when `dayjs` is already used)
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

## Step 4: Forward-looking analysis

This is the part most reviews miss. Think about what happens *next*.

- Read the PR description and branch history for mentions of follow-up work, phases, or "upcoming PRs."
- Given the abstractions and data model chosen here, will the next likely changes be easy or painful?
- Are there coupling points that will force shotgun surgery when requirements shift?
- Is there implicit state or ordering that will surprise the next person who touches this code?
- Are there assumptions baked in (about scale, about single-tenancy, about deployment topology) that may not hold?

## Step 5: What are we missing?

Step back from the code and think about the problem itself.

- **Plan gaps.** Is there a requirement or constraint that the plan doesn't account for? A race condition, a permission model, a migration path, a rollback story?
- **Implementation gaps.** Is there something the plan calls for that the code doesn't actually do yet — silently deferred rather than explicitly deferred?
- **Unstated assumptions.** What does this code assume about its environment that isn't enforced? (Database state, feature flags, execution order, network availability.)

## Output format

Structure your review as:

**Summary** — one paragraph on the overall quality and the single most important thing to address.

Then the findings, grouped by severity:

**Must address** — issues that will cause bugs, data loss, or significant maintenance burden.

**Should address** — design choices that will cause friction but aren't immediately dangerous.

**Consider** — suggestions that would improve the code but are judgment calls.

**What's working well** — things the author got right that are worth calling out, especially non-obvious good decisions. This isn't filler — recognizing good judgment is how teams calibrate.

Within each group, lead with the most impactful item. For each finding, name the file and the concern, explain *why* it matters (not just that it's "wrong"), and suggest a concrete alternative when you have one.

End with a **Forward-looking risks** section if Step 4 surfaced anything worth flagging.

Keep the review dense and direct. No preamble, no "great PR overall" throat-clearing. Respect the author's time.
