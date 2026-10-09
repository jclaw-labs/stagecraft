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

A child's green suite is landing proof only when its parent contains the pinned trunk and the child contains its parent's current head. Before calling any stacked child safe:

1. Resolve and pin the stack's trunk — the bottom PR's base. Use the repository default only when there is no bottom PR; a failing `gh pr view` stops here rather than falling back. Pin the fetched commit from `FETCH_HEAD`, which the fetch writes whatever the clone's refspec:

   ```bash
   bottom_pr=<bottom-pr>  # leave empty only when there is no bottom PR
   if [ -n "$bottom_pr" ]; then
     trunk="$(gh pr view "$bottom_pr" --json baseRefName --jq .baseRefName)"
   else
     trunk="$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)"
   fi &&
     [ -n "$trunk" ] &&
     git fetch origin "$trunk" &&
     trunk_oid="$(git rev-parse --verify 'FETCH_HEAD^{commit}')" ||
     { echo "cannot resolve and pin the stack's trunk; stop" >&2; trunk_oid=; }
   ```

   Fetch every open PR head in the chain and record each current OID; do not reconstruct the stack from a stale local branch.
2. Use `git merge-base --is-ancestor "$trunk_oid" <parent-head>` to tell whether the parent contains the pinned trunk. Check every adjacent parent/child edge unconditionally, regardless of whether the parent contains the pinned trunk. Use `git merge-base --is-ancestor <parent-head> <child-head>` for each edge.
3. If the parent contains the pinned trunk and every adjacent edge is intact, the top head already contains the exact landing chain. Otherwise, create a temporary worktree at `$trunk_oid`. If every adjacent edge is intact, the top head contains the whole chain, so the shortcut is:

   ```bash
   git merge --no-commit --no-ff <top-head>
   ```

   When any edge has diverged, merge each current PR head into the worktree, bottom-up. After inspecting each clean merge, make its temporary merge commit before applying the next head; if a merge conflicts, stop and report the divergence.
4. Before each merge, compare the accumulated landing tree with the incoming head relative to their merge base, and inspect every file changed on both sides. In the temporary worktree, `HEAD` is the pinned trunk plus every head already applied:

   ```bash
   base="$(git merge-base HEAD <incoming-head>)"
   comm -12 \
     <(git diff --no-renames --name-only "$base" HEAD | sort) \
     <(git diff --no-renames --name-only "$base" <incoming-head> | sort)
   ```

   Disabling rename detection keeps both the source and destination in the base-relative path set, so a rename/edit merge cannot hide the shared file. Inspect every reported path and every conflict. Do not resolve a semantic overlap by automatically choosing either side.
5. Run the relevant checks in the integrated landing tree, not only on the child branch. If a PR changes tests or fixtures for overlapping behavior, make a positive-control mutation in the temporary tree and prove the intended test fails under the mutation before restoring it.
6. Remove the temporary worktree. A failed integration check means the stack needs a landing-safe split or an explicitly approved refresh; it is not a reason to force-push reviewed branches as the first response.

## Reviewer navigation

Every PR description in a multi-PR result carries the generated `## PR stack` block and no other stack navigation. Generate it into every PR in the chain with `pr-stack-section --apply <pr>` when the stack is opened and again after anything that reshapes it, and never write it by hand. Do not add a hand-kept `## Change set` table alongside it; a second navigation section has to be rewritten in every description each time the stack changes shape, and those rewrites are what clobber human-authored bodies.

State each PR's purpose in its ordinary Summary prose: what this slice does, why it sits where it does in the stack, and, for the activation PR, that it is the one that makes the feature reachable.

When reviewing, read each PR against the stack's trunk — the bottom PR's base — rather than against the stack's final state: the question is whether this PR is safe alone, not whether the whole feature is correct. A PR whose tests only pass with a sibling PR checked out has already failed the first rule.
