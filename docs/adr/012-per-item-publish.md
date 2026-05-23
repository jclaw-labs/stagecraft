# ADR-012: Per-item Publish

## Status
Proposed

## Context

ADR-010's Publish is all-or-nothing: `publishDraftToMain` squashes the
*entire* draft tree onto `main` in one commit. Artists routinely
accumulate several unrelated pending edits (a new tour date, a
half-rewritten bio, a not-yet-colour-corrected photo) and want to ship
some while holding others. ADR-010 deferred this:

> *Per-item Publish (publish A but not B).* Today's model is "publish
> everything pending." Per-item Publish would need per-session branches
> or a fancy diff-extraction trick. *Trigger:* a real workflow where it
> matters.

ADR-011 added per-editor draft branches, which gives "publish **my**
edits" (each editor publishes their own branch). Per-item Publish is a
different axis: publish a **subset of one editor's own** pending
changes. This ADR adds it via the diff-extraction route (per-session
branches aren't needed — ADR-011 already isolated editors).

## Decision

Publish a selected subset of the pending changes by building one commit
on `main` that contains only the selected paths, then merging `main`
back into the editor's draft branch so the unselected changes stay
pending.

### Mechanism

Let `draft` be the editor's branch (`resolveDraftBranch`, ADR-011) and
`main` the published branch.

1. **Pre-flight.** `ensureDraftAndRebase` (existing) so `draft` sits on
   top of `main` before we diff — a dev push to `main` is merged in (or
   surfaces the existing conflict error).
2. **Diff + classify.** Compare `main...draft`; the selected paths must
   be a subset of that diff. Partition them into *added/modified* (the
   path exists on `draft`) and *removed* (the path is gone on `draft`).
3. **Commit the subset onto `main`.** Build a tree from `base_tree =
   main`'s tree, overlaying the added/modified paths using **draft's
   existing blob SHAs** (referenced, not re-uploaded — binary-safe and
   cheap) and `sha: null` entries for the removed paths. `createCommit`
   with parent = `main` HEAD; `updateRef main` with the same
   stale-ref retry as `commitFiles`. No `[skip ci]` — this commit *is* a
   publish and triggers the deploy.
4. **Reconcile the draft.** `mergeBranchInto({ from: main, into: draft })`
   (existing). The selected paths are now byte-identical on both
   branches, so they merge cleanly; the unselected paths exist only on
   `draft` and remain. `draft` becomes a descendant of the new `main`.

### Invariant

**Preserved.** After step 4 `draft` is a strict descendant of `main`
(it has `main` as a merge parent) and is ahead by exactly the
unselected items — ADR-010's "`draft.sha === main.sha` OR `draft` is a
strict descendant of `main`" still holds. The pending-changes compare
(`main...draft`) now reports just the leftover items, with no special
casing. Selecting *all* pending items lands the same end state as
today's full Publish.

### Selection granularity

The unit is a pending **item** as the publish modal shows it (changes
are collapsed server-side — see `draft-changes.ts`). The client sends
selected item keys; the **server** re-derives the diff and expands each
selected item to its underlying repo path(s):

- a normal item / singleton / order → its one JSON path;
- an image upload → its full variant set (original + widths × formats),
  published all-or-none;
- a rename → both the old path (deleted) and the new path (added).

Server-side expansion means a stale client can't publish a partial
image or desync from the real diff.

### Concurrency & partial failure

The `updateRef main` in step 3 uses the `commitFiles` stale-ref retry,
so two near-simultaneous publishes serialize (the loser rebuilds on the
new `main`). If step 3 succeeds but step 4 fails, `main` has the
selected changes while `draft` is briefly behind on those paths but
still ahead on the unselected ones; the next save's
`ensureDraftAndRebase` merges `main` in and self-heals — the same
recovery shape ADR-010 already relies on.

## Rejected alternatives

- **Per-session branches** (ADR-010's other suggestion). Heavier, and
  ADR-011 already isolated editors; per-item is an orthogonal axis that
  diff-extraction handles without more branch lifecycle.
- **Re-read content and re-commit via `commitFiles`.** Simpler (reuses
  `commitFiles` wholesale) but re-downloads + re-uploads blob content,
  which is wasteful for image publishes. Referencing draft's existing
  blob SHAs in the new tree is cheaper and binary-clean.
- **Mark-published per file on `draft`.** Tracking which files are
  "published" in side state reintroduces the parallel-state problem
  ADR-010 rejected. The branch topology already answers "what's
  pending" via the compare.

## Decomposition

- **PR 1 (backend).** This ADR + a `git-commit.ts` primitive that
  commits a selected set of a source branch's paths into a target
  branch by blob-SHA reference (with stale-ref retry), plus
  `publishSelectedToMain({ authorEmail, paths, commitSubject })` in
  `publish.ts` (resolve branch → pre-flight → classify → commit subset →
  merge). Unit + integration tests over the mocked git layer.
- **PR 2 (API + item→path mapping).** A route that takes selected item
  keys, expands them to paths server-side (variants, renames) against a
  fresh diff, and calls `publishSelectedToMain`. Tests for the
  expansion (image variants, rename, deletion, subset validation).
- **PR 3 (UI).** Publish-modal checkboxes per item/group, "select all"
  default, a "Publish N of M" affordance, and discard-of-selection
  semantics; wires the selection to the route.

## Known limitations and deferred work

- **Merge commits accrue on the draft branch.** Each partial publish
  adds a merge commit to the editor's branch. Harmless (the branch is
  ephemeral and gets superseded by the next full Publish's squash), and
  invisible on `main`. *Trigger:* never expected to matter.
- **No "publish these N, discard the rest" combo.** Partial publish
  leaves the unselected items pending; discarding them is a separate
  Discard action. *Trigger:* artists ask for a one-step "publish some,
  drop the rest."
- **Large-publish tree cost.** Step 3 reads the source tree to resolve
  blob SHAs; for a publish near the compare's 300-file cap this is one
  recursive `getTree`. Fine for typical publishes. *Trigger:* shows up
  in traffic profiles on very large publishes.

## Relates to / amends

- **ADR-010** — adds a subset-publish path alongside the existing
  whole-draft squash; both preserve the same `draft ≥ main` invariant.
- **ADR-011** — operates on the editor's resolved draft branch.
