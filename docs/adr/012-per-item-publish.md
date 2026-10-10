# ADR-012: Per-item Publish

## Status
Accepted — implemented and shipped: backend (#238), API (#239), and the
publish-modal UI (#240). Remaining items are deferred with documented
triggers (see "Known limitations and deferred work").

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
3. **Commit the subset onto `main`.** The caller passes an **explicit**
   split — `copyPaths` (added/modified) and `deletePaths` (removed) —
   derived from the diff; the mechanism never *infers* delete-vs-copy
   from "is the path on the source," because a missing copy path must
   never silently become a deletion. Build a tree from `base_tree =
   main`'s tree, overlaying `copyPaths` using **draft's existing blob
   SHAs** (referenced, not re-uploaded — binary-safe, cheap, and
   mode-faithful) and `sha: null` entries for `deletePaths`. A copy path
   that doesn't resolve to a blob on the source — or a **truncated**
   source tree listing — **throws** rather than risk a wrong deletion.
   If the resulting tree equals `main`'s current tree (nothing actually
   changed), skip the commit (no spurious deploy). Otherwise
   `createCommit` with parent = `main` HEAD and `updateRef main` with the
   same stale-ref retry as `commitFiles`. No `[skip ci]` — this commit
   *is* a publish and triggers the deploy.
4. **Reconcile the draft.** `mergeBranchInto({ from: main, into: draft })`
   (existing). In the common case the selected paths are byte-identical
   on both branches so they merge cleanly, the unselected paths exist
   only on `draft` and remain, and `draft` becomes a descendant of the
   new `main`. This merge is *not* unconditionally clean, though — a
   concurrent edit to a published path during the publish window can
   conflict (see Known limitations).

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

Both writers of `main` — `commitSelectedPathsInto` (selected publish)
and `squashBranchInto` (full publish) — guard their `updateRef main`
with the same stale-ref retry as `commitFiles` (one shared helper,
`retryOnStaleRef` in `git-commit.ts`). So any two publishes on `main`
serialize: the loser rebuilds on the new `main`. The squash takes the
draft's *whole* tree, so a full publish also checks, on every attempt,
that the draft contains the `main` it is about to build on. If it
doesn't (a publish landed after the auto-rebase, or between a retry's
merge and the next attempt), that counts as a lost race: the new `main`
is merged into the draft first, so the squash can't revert what the
other publish shipped. Exhausting the retries surfaces as
`concurrent-edit`, as for saves. A full publish only moves `main`; it
then merges `main` back into the draft, the same reconcile step as
below.

If step 3 succeeds but step 4 (reconcile) fails, `main` already has the
selected changes (the deploy fired) while `draft` is behind on those
paths but still ahead on the unselected ones. The publish *shipped*, so
`publishSelectedToMain` reports success with a typed `warning`
(`PublishWarning` in `publish-types.ts`) and the editor shows a note
under the Publish button:

- `draft-resync-pending` — the merge failed transiently. The next
  save's `ensureDraftAndRebase` merges `main` in and self-heals the
  draft; until then the pending list can still show the published
  items.
- `draft-resync-conflict` — the draft can't merge the new `main`
  cleanly (another publish touched the same files). The next save hits
  the same conflict, so the note tells the editor to discard the
  remaining pending changes.

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
  semantics; wires the selection to the route. Must build `selectedKeys`
  with the canonical `changeKey` from the client-safe
  `lib/draft-changes-keys.ts` (and drop the modal's divergent local
  copy), so the keys match the server's expansion.

## Known limitations and deferred work

- **Reconcile (and pre-flight rebase) can conflict on concurrent edits.**
  The merges in steps 1 and 4 are 3-way merges against the *old* `main`;
  a path edited on both `main` (a dev push) and `draft` during the
  publish window can conflict. Notably a conflicting **unselected** file
  blocks the pre-flight rebase, so per-item Publish — like full Publish —
  requires `draft` to rebase cleanly on `main`; it does not let you ship
  a clean selected item past an unrelated conflicting one. Editors are
  otherwise branch-isolated (ADR-011), so the realistic trigger is
  same-editor multi-tab or a direct push mid-publish; recovery is Discard
  or resolve, then retry. *Trigger:* artists hit this in concurrent
  sessions — then add per-path reconciliation.

- **A selected subset can be internally incoherent.** Nothing enforces
  that interdependent changes publish together — selecting a new
  collection's items without its `_collection.json` schema (`def`), or an
  `_order.json` without the items it lists, can ship `main` referencing a
  schema or slugs that aren't there yet. The artist composes the subset;
  the modal (PR 3) should group/guide dependent changes, and a future
  guard could auto-include a collection's `def`/`order` with its items.
  *Trigger:* artists publish incoherent subsets in practice.

- **Selective publish is content-only and refuses truncated diffs.** The
  expansion restricts published paths to `src/content/` + `public/images/`
  (a stray `other:` change can't ship an arbitrary repo file), only
  deletes the old side of a *same-collection* item rename (GitHub's
  cross-collection rename heuristic won't delete an unrelated file), and
  throws when the compare is truncated at 300 files (so an image's
  variants can't be split). Above the cap, full Publish is the path.

- **Cross-collection "renames" publish as a copy, not a move.** GitHub's
  similarity heuristic can flag an added item in one collection as a
  rename of an unrelated item in another. The modal shows it as a single
  "A → B" row, but selecting it copies the new file and (deliberately, to
  avoid deleting an unrelated file) leaves the old one live on `main` — a
  half-move. *Trigger:* artists do real cross-collection moves and expect
  the old item gone; then surface the two sides as separate rows.

- **A subset publish silently skips items that vanished since the modal
  opened.** The modal lists the diff at open time; the server re-derives
  it at publish time. If a concurrent save removed a selected item in
  between, that key matches nothing and is dropped — the publish succeeds
  for the rest with no "N of M shipped" notice. *Trigger:* concurrent
  same-editor sessions; then return matched/skipped counts and surface
  them in the button status.

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
