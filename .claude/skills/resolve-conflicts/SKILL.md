---
name: resolve-conflicts
description: Intelligently resolve merge conflicts in a repo or worktree that is mid-rebase, mid-merge, mid-cherry-pick, or mid-revert. Reads both sides, resolves to preserve both intents, and continues the operation — pausing only when the two sides genuinely conflict. Use when a rebase/merge stops on conflicts, or when another skill (e.g. refresh-stack) hands off a conflicted worktree. Stack-agnostic.
---

# Resolve conflicts

Resolve the conflicts in a repository (or a specific worktree) that is partway
through a `rebase`, `merge`, `cherry-pick`, or `revert`, then continue to
completion. This skill knows nothing about PR stacks — it operates on whatever
operation git is currently in. Callers pass a working directory; default to the
current one.

## Operating mode

Semi-autonomous: resolve clear conflicts yourself; **pause and ask** only when the
two sides change the same behavior in genuinely incompatible ways. Never silently
drop either side's intent.

## 1. Read the state — before touching anything

```bash
git -C "$WT" status
git -C "$WT" diff --name-only --diff-filter=U   # files with unresolved conflicts
```

Identify the operation from what's present in `.git`:

| In progress | Marker | `--continue` command |
|---|---|---|
| rebase | `rebase-merge/` or `rebase-apply/` | `git rebase --continue` |
| merge | `MERGE_HEAD` | `git merge --continue` |
| cherry-pick | `CHERRY_PICK_HEAD` | `git cherry-pick --continue` |
| revert | `REVERT_HEAD` | `git revert --continue` |

**The ours/theirs inversion (read this every time):**
- In a **merge**, `--ours` = your current branch, `--theirs` = the branch merging in.
- In a **rebase / cherry-pick**, it flips: `--ours` = the commit you're replaying *onto* (the new base), `--theirs` = the commit being replayed (your own work). During a stack refresh the "theirs" side is *your PR's changes*.

Always confirm direction with `git status` / commit subjects (`git -C "$WT" log --oneline -1 REBASE_HEAD` for the commit being applied) rather than trusting intuition.

### Capture the exact operation inputs

Before staging or continuing anything, record the exact commits that define the
operation:

- **Rebase:** `old_base` is the caller's old parent or replay boundary,
  `old_tip` is the branch tip before the rebase, and `new_onto` is the commit
  the branch is being replayed onto.
- **Merge:** the old parent and `old_tip` are the current `HEAD`; the new base
  is every commit named by `MERGE_HEAD`. A merge keeps both histories instead
  of replaying the old branch.
- **Cherry-pick / revert:** the old parent and `old_tip` are the current `HEAD`;
  `CHERRY_PICK_HEAD` / `REVERT_HEAD` identifies the exact commit whose patch is
  being applied or inverted, and the old parent is also the new onto commit.

For a rebase, read only metadata written by this operation:

```bash
git_dir="$(git -C "$WT" rev-parse --absolute-git-dir)"
if [ -f "$git_dir/rebase-merge/orig-head" ]; then
    rebase_state="$git_dir/rebase-merge"
elif [ -f "$git_dir/rebase-apply/orig-head" ]; then
    rebase_state="$git_dir/rebase-apply"
else
    echo "rebase metadata does not identify the original tip; stop" >&2
    return 1
fi
metadata_old_tip="$(git -C "$WT" rev-parse --verify "$(cat "$rebase_state/orig-head")^{commit}")"
metadata_new_onto="$(git -C "$WT" rev-parse --verify "$(cat "$rebase_state/onto")^{commit}")"

provenance_path="$(git -C "$WT" rev-parse --git-path restack-conflict-provenance)"
case "$provenance_path" in
    /*) ;;
    *) provenance_path="$WT/$provenance_path" ;;
esac
persisted_old_base=""
persisted_old_tip=""
persisted_new_onto=""
[ ! -e "$provenance_path" ] || [ -f "$provenance_path" ] || {
    echo "conflict provenance is not a regular file; stop" >&2
    return 1
}
if [ -f "$provenance_path" ]; then
    seen_old_base=0
    seen_old_tip=0
    seen_new_onto=0
    while IFS='=' read -r key value; do
        case "$key" in
            old_base)
                [ "$seen_old_base" -eq 0 ] && [ -n "$value" ] || return 1
                persisted_old_base="$value"
                seen_old_base=1
                ;;
            old_tip)
                [ "$seen_old_tip" -eq 0 ] && [ -n "$value" ] || return 1
                persisted_old_tip="$value"
                seen_old_tip=1
                ;;
            new_onto)
                [ "$seen_new_onto" -eq 0 ] && [ -n "$value" ] || return 1
                persisted_new_onto="$value"
                seen_new_onto=1
                ;;
            *) return 1 ;;
        esac
    done <"$provenance_path"
    [ "$seen_old_base" -eq 1 ] &&
        [ "$seen_old_tip" -eq 1 ] &&
        [ "$seen_new_onto" -eq 1 ] || return 1
fi

if [ -n "${RC_OLD_BASE:-}" ]; then
    old_base="$RC_OLD_BASE"
    if [ -n "$persisted_old_base" ] && [ "$persisted_old_base" != "$old_base" ]; then
        echo "caller and persisted old base disagree; stop" >&2
        return 1
    fi
else
    old_base="$persisted_old_base"
fi
old_tip="${persisted_old_tip:-$metadata_old_tip}"
new_onto="${persisted_new_onto:-$metadata_new_onto}"

for value in "$old_base" "$old_tip" "$new_onto"; do
    [ -n "$value" ] || {
        echo "conflict provenance is missing, malformed, or incomplete; stop" >&2
        return 1
    }
    resolved="$(git -C "$WT" rev-parse --verify "${value}^{commit}" 2>/dev/null)" || {
        echo "conflict provenance is missing, malformed, or incomplete; stop" >&2
        return 1
    }
    [ "$resolved" = "$value" ] || {
        echo "conflict provenance must contain full commit OIDs; stop" >&2
        return 1
    }
done
[ "$old_tip" = "$metadata_old_tip" ] &&
    [ "$new_onto" = "$metadata_new_onto" ] &&
    git -C "$WT" merge-base --is-ancestor "$old_base" "$old_tip" || {
        echo "conflict provenance contradicts rebase metadata; stop" >&2
        return 1
    }
```

Git's rebase metadata records `old_tip` in `orig-head` and `new_onto` in
`rebase-merge/onto` or `rebase-apply/onto`, but it does not reliably record the
exact old replay boundary. `restack-refresh` stores all three commits in the
worktree's Git metadata before handing off a conflict, so a caller still invokes
this skill with only the worktree path. `RC_OLD_BASE` remains an explicit
fallback for other callers. Treat a missing, malformed, or incomplete record as
a stop condition rather than deriving any value from a branch name,
`origin/<trunk>`, a merge base, reflog position, or commit shape.
If persisted or caller-supplied provenance disagrees with operation metadata, stop.

For a merge, capture `old_tip="$(git -C "$WT" rev-parse HEAD)"` and
`new_onto="$(git -C "$WT" rev-parse MERGE_HEAD)"` while the merge is still in
progress. After `git merge --continue`, those must be the resulting merge
commit's first and second parents. This differs from a rebase: `ORIG_HEAD` may
also name the old merge tip, but it is mutable repository state, while the
in-progress `HEAD` and `MERGE_HEAD` are the operation's exact inputs.

## 2. Resolve each conflicted file

For every file from `--diff-filter=U`:

1. **Read the whole file** and each conflict hunk (`<<<<<<<` / `=======` / `>>>>>>>`).
2. **Understand both intents** — what did each side change and why? Use `git log`/blame on both sides if the intent isn't obvious.
3. **Merge to preserve both.** The goal is the union of intent, not picking a winner. Combine both changes when they're orthogonal; reconcile them when they touch the same code.
4. Remove **all** conflict markers. Keep the file syntactically valid.
5. Stage it: `git -C "$WT" add -- <file>`.

### Special cases

- **Lockfiles / generated files** (`package-lock.json`, `yarn.lock`, `Cargo.lock`, `*.generated.*`, snapshots): don't hand-merge. Take the incoming base, finish the resolution of source files, then **regenerate** (`npm install`, `cargo build`, the repo's codegen) and stage the result.
- **delete/modify**: decide whether the deletion or the edit should win based on intent; if unsure, this is a pause-and-ask case.
- **add/add** (both added the same path): merge the two versions into one.
- **A purely one-sided hunk** (only one side meaningfully changed): take that side — but verify it's genuinely one-sided, not a subtle semantic clash.

### Never

- `git checkout --ours/--theirs <file>` wholesale unless the file is truly one-sided. It silently discards the other side.
- `git rebase --skip` (drops a commit entirely) or `--abort` without asking the caller first.
- Reuse a resolved tree, index, or file set produced against a different base (`git read-tree`, `git checkout <other-ref> -- .`, copying from an older scratch worktree). A newer base may contain work that the transplanted tree silently removes.
- Leave a resolution with conflict markers or broken syntax.

## 3. Pause-and-ask criteria

Stop and surface the conflict to the caller/user when:
- Both sides change the **same logic** in incompatible ways (not just adjacent lines).
- A delete/modify where losing either side changes behavior.
- Resolving correctly needs product/domain context you don't have.

Present: the file, both sides' intent, and your proposed resolution. Wait for a decision.

## 4. Continue — and loop

Once every conflicted file is staged with no markers left, run the matching
`--continue` command from the operation table:

```bash
GIT_EDITOR=true git -C "$WT" rebase --continue
GIT_EDITOR=true git -C "$WT" merge --continue
GIT_EDITOR=true git -C "$WT" cherry-pick --continue
GIT_EDITOR=true git -C "$WT" revert --continue
```

A rebase or sequenced cherry-pick/revert may stop again on the **next** commit.
Repeat from step 1 until
`git -C "$WT" status` shows the operation is complete (no rebase/merge in
progress). Keep the provenance captured before the first `--continue`; operation
metadata disappears at completion.

Verify nothing is left behind:

```bash
rg -n '^(<<<<<<<|=======|>>>>>>>)' "$WT" && echo "MARKERS REMAIN" || echo "clean"
```

Then audit paths and patch content against those exact commits.

### Rebase

```bash
git -C "$WT" diff --name-only "$new_onto" HEAD
git -C "$WT" range-diff "$old_base..$old_tip" "$new_onto..HEAD"
```

The new-base-relative path list must contain only files the branch intentionally
changes. It is a scope check, not proof that base content survived. Every patch
that `range-diff` reports as changed, unmatched, added, or removed needs an
explanation tied to the conflict resolution.

For each changed patch, compare the old and new branch deltas in every affected
file:

```bash
path=<affected-path>
git -C "$WT" diff "$old_base" "$old_tip" -- "$path"
git -C "$WT" diff "$new_onto" HEAD -- "$path"
```

The second diff may adjust context or reconcile a real conflict, but every
content change must be explained by the old branch patch or the recorded
resolution. A deletion or rewrite that appears only in the second diff is
overwritten new-base content, even when the path itself is expected. Do not
claim a one-line path list proves content preservation. `range-diff` is a first
pass rather than a substitute for these focused diffs, especially when the old
branch contains merge commits.

Only after the rebase finishes and every provenance, path, patch, and focused
file audit succeeds, remove the persisted handoff:

```bash
rm -f -- "$provenance_path"
[ ! -e "$provenance_path" ] || {
    echo "verified conflict provenance could not be removed; stop" >&2
    return 1
}
```

### Merge

A merge does not rewrite the old patch series, so do not force the rebase
`range-diff` command onto it. First verify that the completed merge's first
parent is `old_tip` and its second parent is `new_onto`. Then inspect the
combined diff and both parent-relative diffs for every resolved file:

```bash
git -C "$WT" show --cc --format=fuller HEAD -- "$path"
git -C "$WT" diff "$old_tip" HEAD -- "$path"
git -C "$WT" diff "$new_onto" HEAD -- "$path"
```

Together these are the merge equivalent of reconciling the pre-operation patch:
every resolution line must be attributable to one parent or to a documented
reconciliation. Keep the new-base-relative path scope check, but do not accept
an expected filename as evidence that either parent's content survived.

For cherry-pick, compare the picked commit's original patch with
`old_tip..HEAD` using `range-diff`, then use the same focused file diffs. For
revert, compare the target patch with the inverse `old_tip..HEAD` file by file.
In every operation, unexplained patch content is a failed audit even when the
paths, marker scan, and test suite are clean.

## 5. Report

For each commit/step you resolved, report the files touched and a one-line note on
how you reconciled each (which intents you combined). Flag anything you took a
judgment call on so the caller can spot-check.
