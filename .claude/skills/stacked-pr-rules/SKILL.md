---
name: stacked-pr-rules
description: Use this skill whenever you split work across multiple PRs, or create, slice, reorder, or review a stack of PRs. Landing-safety rules for what makes each PR in a stack safe to merge on its own, independently of the PRs above it.
---

# Stacked PRs: landing safety

Use this skill whenever you split work across multiple PRs, or slice, reorder, or review an existing stack.

Every PR in a stack must be safe to land on its own — independently mergeable into the stack's trunk (the bottom PR's base) and leaving the product coherent even if the PRs above it never land. A reviewer or the merge queue can land the bottom of a stack and stop there, so "the next PR fixes it" is not a plan.

- **No broken intermediate state.** Each PR must compile, pass tests, and not crash at runtime on its own. A PR that calls into code only introduced by a later PR isn't independently mergeable — pull that dependency down into the earlier PR, or keep the two together.
- **No partially-visible feature.** Don't let an early slice reveal a half-built flow that would confuse users or break the system. Keep new user-facing surface dark until the feature is whole: gate it behind a site config or experiment, or leave its entry point unwired.
- **Flip it on last.** Order the stack so plumbing and gated-off code land first, and the single PR that makes the feature reachable — the config flip, the route or nav entry, the menu item — sits at the top. That's the one PR that must not merge until everything under it has.
- **Too coupled to slice is a valid answer.** If no split satisfies the rules above, keep the changes in one PR rather than shipping a broken middle.

## Review against the current trunk

A child's green suite is landing proof only when its parent contains the pinned trunk and the child contains its parent's current head. The landing chain for the PR you are judging is the pinned trunk plus every PR from the bottom up to and including that PR; PRs above it are no part of its proof. Before calling any stacked PR safe:

1. Resolve and pin the stack's trunk — the bottom PR's base. Use the repository default only when there is no bottom PR; a failing `gh pr view` stops here rather than falling back. Pin the fetched commit from `FETCH_HEAD`, which the fetch writes whatever the clone's refspec. If the snippet exits nonzero, stop:

   ```bash
   bottom_pr=<bottom-pr>  # leave empty only when there is no bottom PR
   if [ -n "$bottom_pr" ]; then
     trunk="$(gh pr view "$bottom_pr" --json baseRefName --jq .baseRefName)"
   else
     trunk="$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)"
   fi &&
     [ -n "$trunk" ] &&
     git fetch origin "$trunk" &&
     trunk_oid="$(git rev-parse --verify 'FETCH_HEAD^{commit}')" &&
     echo "trunk $trunk_oid" ||
     { echo "cannot resolve and pin the stack's trunk; stop" >&2; false; }
   ```

   The steps below take the printed OID as `<trunk-oid>`, because they may run in later shells that no longer hold `$trunk_oid`. Fetch every open PR head in the chain and record each current OID; do not reconstruct the stack from a stale local branch.
2. Use `git merge-base --is-ancestor <trunk-oid> <bottom-head>` to tell whether the chain contains the pinned trunk. Check every adjacent parent/child edge in the chain unconditionally with `git merge-base --is-ancestor <parent-head> <child-head>`.
3. Create a disposable worktree at a fresh path, and run every merge, diff, and check below inside it, never in the checkout you started from. If the snippet exits nonzero, stop:

   ```bash
   wt="$(mktemp -d "${TMPDIR:-/tmp}/stack-landing.XXXXXX")" &&
     git worktree add --detach "$wt" <trunk-oid> &&
     echo "landing $wt" ||
     { echo "cannot create the landing worktree; stop" >&2; false; }
   ```

   The steps below take the printed path as `<landing-wt>`, because a later shell no longer holds `$wt`, and `git -C ""` runs in the current checkout.

4. Build the landing tree in it. Take exactly one of these paths:
   - **The bottom head contains the pinned trunk and every edge is intact.** The judged head already is the landing tree: `git -C <landing-wt> checkout --detach <judged-head>`, and merge nothing.
   - **Every edge is intact but the bottom head lacks the pinned trunk.** The judged head contains the whole chain, so merge only it.
   - **Any edge has diverged.** Merge each head in the chain, bottom-up.

   Before each merge, list the files the accumulated landing tree and the incoming head both changed relative to their merge base, and inspect every one. `HEAD` in the worktree is the pinned trunk plus every head already applied:

   ```bash
   base="$(git -C <landing-wt> merge-base HEAD <incoming-head>)"
   comm -12 \
     <(git -C <landing-wt> diff --no-renames --name-only "$base" HEAD | sort) \
     <(git -C <landing-wt> diff --no-renames --name-only "$base" <incoming-head> | sort)
   ```

   Disabling rename detection keeps both the source and destination in the base-relative path set, so a rename/edit merge cannot hide the shared file. Once you have inspected the list, merge as a separate command:

   ```bash
   git -C <landing-wt> merge --no-ff --no-edit <incoming-head>
   ```

   If a merge conflicts, report the divergence, remove the worktree as in step 6, and stop. Do not resolve a semantic overlap by automatically choosing either side.
5. Run the relevant checks in `<landing-wt>`, not only on the child branch. If a PR changes tests or fixtures for overlapping behavior, make a positive-control mutation in `<landing-wt>` and prove the intended test fails under the mutation before restoring it.
6. Remove it with `git worktree remove --force <landing-wt>`. A failed integration check means the stack needs a landing-safe split or an explicitly approved refresh; it is not a reason to force-push reviewed branches as the first response.

## Reviewer navigation

Every PR description in a multi-PR result carries exactly one stack navigation section. It shows the same stack in every PR in the chain, linking every PR and what each one sits on (a generator may fold rows away from the PR being viewed into one), and marks the PR being viewed; linking only the immediate parent or child is not enough. Where the repo has a generator for it, use that when the stack is opened and again after anything that reshapes it, rather than writing it by hand. Where it has none, keep the hand-written section in step across every PR whenever the stack is created, reordered, split, replaced, or reduced, and migrate an existing stack section rather than appending a second one, preserving unrelated human-authored content. Do not add a hand-kept `## Change set` table alongside a generated section; a second navigation section has to be rewritten in every description each time the stack changes shape, and those rewrites are what clobber human-authored bodies.

State each PR's purpose in its ordinary Summary prose: what this slice does, why it sits where it does in the stack, and, for the activation PR, that it is the one that makes the feature reachable.

When reviewing, read each PR against the stack's trunk — the bottom PR's base — rather than against the stack's final state: the question is whether this PR is safe alone, not whether the whole feature is correct. A PR whose tests only pass with a sibling PR checked out has already failed the first rule.
