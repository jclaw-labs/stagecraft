# ADR-010: Save vs Publish via persistent draft branch

## Status
Proposed

## Context

ADR-007 §5 ("Publishing") established a single-branch publish flow: every
admin save commits directly to `main` and triggers a production deploy.
There's no concept of staging — "Save" and "Publish" are the same action.

Three pressures from real artist workflows surfaced this:

1. **Mid-edit saves shouldn't deploy.** Artists make a series of changes
   over 10-30 minutes, hit Save several times to checkpoint their work,
   then Publish when they're ready. Today every Save = a production
   deploy.
2. **`main`'s history fills with one commit per Save.** Indistinguishable
   from real publish events. `git log main` becomes unusable as a
   record of what shipped when.
3. **No way to share a preview of in-progress work without going live.**
   The artist can't show a draft to a collaborator without first making
   it public.

The natural fit is a two-tier "save vs publish" model. The constraint
is that the storage layer is git, the runtime is serverless (Vercel /
Netlify), and a save in production needs to persist somewhere durable
without triggering the deploy pipeline. This ADR records the chosen
design and the alternatives considered.

## Glossary

Defined here once; used throughout the rest of the ADR.

- **`main`.** The published-view branch. The public site builds from
  this branch only. The public catch-all renderer never reads any
  other ref.
- **`draft`.** Persistent companion branch. The admin reads and writes
  here. Always at or ahead of `main` — never behind. Created at
  bootstrap; never deleted.
- **Save.** Admin operation that commits the artist's pending edits to
  `draft`. Does not trigger a deploy.
- **Publish.** Admin operation that creates a single squash commit on
  `main` whose tree comes from `draft`. Triggers the production
  deploy. After the commit, `draft` is fast-forwarded to match
  `main`.
- **Discard.** Admin operation that force-updates `draft` to point at
  `main`'s current HEAD. Wipes out any pending Save's that hadn't
  been Published.
- **Pending changes.** Diff between `draft` and `main`. "Has pending
  changes?" is a SHA comparison: `draft.sha !== main.sha`.

## Decision

Introduce a persistent `draft` branch alongside `main`. The admin's
read and write source becomes `draft`. Publish creates a single
squash commit on `main` from `draft`'s tree, then fast-forwards
`draft` to match. Discard resets `draft` back to `main`.

Invariants:

1. `draft.sha === main.sha` OR `draft` is a strict descendant of `main`.
2. The public site builds exclusively from `main`.
3. The admin reads exclusively from `draft`.

These three rules make the system explain itself in one sentence:
*"draft is what you see while editing; main is what visitors see;
publish moves draft → main."*

### 1. The two branches

Both branches exist for the entire lifetime of an artist site.
Bootstrap (one-time, idempotent) creates `draft` pointing at `main`'s
current HEAD if absent. After every Publish, `draft.sha === main.sha`;
between publishes, `draft` is ahead of `main` by one or more commits.

The broker's repo-bootstrap step (currently runs at site creation in
the platform's `/create` flow) gets a new "ensure `draft` branch
exists" check. Existing artist sites migrate lazily on first admin
request — broker creates the branch from main's HEAD if missing.

### 2. Save

Every admin save (page edit, settings update, schema change, item
write, image upload) targets the `draft` branch. The blob → tree →
commit → updateRef flow in `git-commit.ts` is otherwise unchanged —
only the ref name differs.

Commit message convention for draft writes:

```
draft(<collection>): <itemSlug> [skip ci]

Stagecraft-Save-Id: <uuid>
```

The `[skip ci]` marker prevents Vercel / Netlify from kicking off a
production build for draft commits. Branch-filter config in
`vercel.json` / `netlify.toml` is the portable alternative; we use
`[skip ci]` because it doesn't require host-specific configuration.

Multiple Saves accumulate as separate commits on `draft`. This gives
a per-save audit trail visible on the branch; the commits become
irrelevant after Publish (which supersedes them with a single squash
commit on `main`).

### 3. Publish

Publish creates one new commit on `main`:

- **Parent**: current `main` HEAD
- **Tree**: `draft`'s current tree (not the SHA — we take the tree
  contents, which implicitly squashes every commit between `main`
  and `draft` into one)
- **Author**: the artist's email
- **Committer**: the GitHub App (per ADR-008)
- **Message**: auto-generated from the diff between `main` and
  `draft`, grouped by collection. Example:

  ```
  Publish: 3 pages, 2 tour dates updated

  - pages/about
  - pages/contact
  - pages/home
  - tour-dates/paris-2026
  - tour-dates/lyon-2026

  Stagecraft-Publish-Id: <uuid>
  ```

After the new commit lands on `main`, the publish flow fast-forwards
`draft` to the same SHA. Both refs now point at the new commit; the
invariant holds; the next edit cycle starts clean.

The per-save draft commits between the previous `main.sha` and the
new one remain in GitHub's reflog for some retention window before
being garbage-collected, but aren't reachable from any active ref.

**Implementation cost**: three GitHub Git Data API calls — `getRef`
for both branches, `createCommit` with the right parent + tree,
`updateRef main` then `updateRef draft`. The squash is implicit in
how the commit's tree is built; we don't preserve draft's individual
commits on main.

**Optional commit message override**: the publish modal shows the
auto-generated subject + body and lets the artist edit it before
clicking Publish. v1 ships the auto-generated message only.

### 4. Discard

Force-update `draft`'s ref to `main.sha`. The previous draft state is
unreachable via active refs (visible only via reflog before GitHub
garbage-collects it).

The admin UI requires confirmation: *"Discard 17 unpublished
changes? This can't be undone."* The count is the cheap diff between
draft and main.

### 5. Admin reads

The admin reads exclusively from `draft`. The container's
filesystem (whatever main was at build time) is no longer the source
of truth for admin requests — it becomes a degraded fallback for the
GitHub-down case.

Implementation: a runtime-fetch + per-process cache layer in
`store.ts`. On each admin request:

1. `GET /repos/.../branches/draft` → returns `draft.sha` (cached
   HTTP, ~50ms)
2. If `draft.sha` matches our last-known SHA, serve from cache.
3. If not, drop the cache and re-fetch tree contents on demand (per
   path).

Cache shape: `Map<(branch, path), { sha, content }>`. Per-process —
each container instance maintains its own. Cold-start cost on first
admin request: ~200ms-1s depending on collection size. Warm cost:
one HEAD check + cached content reads.

After any admin write, the writer's process updates its own cache
synchronously with the new commit's tree. Other containers' caches
update on their next read via the SHA comparison.

Cache GC: paths removed from the source branch (e.g., a deleted
item) get dropped on the next `listItemSlugs` call that observes
the absence — the listing operation rewrites the cache for that
collection's items directory. For long-lived processes (non-
serverless deploys), this means cache size tracks the live tree
plus any items removed since the most recent list call. Serverless
processes are bounded by cold-start frequency; either way, no
unbounded growth.

### 6. Concurrent edits on draft

Two browsers (or two tabs of the same browser) commit to `draft`
from possibly-different base SHAs. GitHub's `updateRef` rejects a
push with a stale base via 422.

The publish layer wraps commits in a bounded retry loop:

1. Read `draft.sha`
2. Build the commit tree on top
3. `updateRef draft`
4. If 422: re-fetch `draft.sha`, rebuild on the new base, retry
5. Cap at 3 retries; return structured "someone else just saved"
   error after exhausting

This is the same shape `commitFiles` already has; only the retry
cap and structured error message are new.

### 7. Main moves outside of publish

A developer pushes a code or schema change directly to `main` (e.g.,
a release that touches `lib/content.ts`, or a schema migration that
rewrites `_collection.json` files). `draft` is now behind `main` on
those paths — the invariant breaks.

Auto-rebase on next artist save: before committing to `draft`, the
broker compares `main.sha` to `draft`'s known base. If `main` moved:

- **Clean rebase** (no overlap between dev's changes and the
  artist's draft files): broker silently rebases `draft` onto
  `main` and proceeds.
- **Conflict** (artist edited the same file dev's commit changed):
  publish fails with a structured error pointing at the conflicted
  files. The artist's options are Discard (lose the conflicting
  edits, accept dev's changes) or contact-support.

For dev pushes that don't touch any file the artist edited, the
rebase is invisible. This is the common case for code-only releases.

### 8. Image uploads

`upload-image` (ADR-007 §6) commits one or more blobs per upload to
whatever branch `publish.ts` targets. Same change as content writes:
commit to `draft`, not `main`. Images become part of the eventual
Publish's tree.

Implications on Discard: an image uploaded during a discarded
session remains reachable in `draft`'s reflog window but unreachable
from any active item that references it. Same orphan-image story as
today (see ADR-009 "Image lifecycle for items" deferred entry); the
draft model doesn't make it worse.

### 9. Two-tier draft model

Three distinct storage layers, each solving a different problem:

| Layer | Persistence | Visibility | Cleared by |
|---|---|---|---|
| Browser localStorage | Single tab, until cleared | This tab only | Successful Save |
| `draft` branch | Git, until Publish or Discard | Any admin login, any device | Publish (FF to main) or Discard (reset to main) |
| `main` branch | Git, durable | Public site visitors | Never (history preserved) |

`localStorage` is the typing-buffer: protects against tab crashes
mid-edit before the artist hits Save. The branch is durable
cross-device staging: the artist can start editing on a laptop,
close the lid, continue on a phone, and see the same pending state.
`main` is what visitors see.

The three layers are independent — a successful Save clears
`localStorage` (the buffer is no longer needed; the durable draft
holds the state) but doesn't touch `main`. A Publish moves `draft`
state to `main` but doesn't affect `localStorage` (which is already
empty after Save).

### 10. Deploy gating

`draft` commits must not trigger production deploys. Two options:

- **`[skip ci]` in every draft commit message.** Vercel and Netlify
  both honor this convention. Host-agnostic, no config needed.
- **Branch-filter config in `vercel.json` / `netlify.toml`.** More
  portable across CI systems, but requires per-host configuration.

We use `[skip ci]`. Belt-and-suspenders (both) is optional but not
necessary.

### 11. Dev fallback

In dev (`STAGECRAFT_SITE_ID` / `STAGECRAFT_BROKER_SECRET` unset),
there's no GitHub round-trip. The branch split is moot — there's no
deploy to skip, no remote ref to manage.

Behaviour:

- Save and Publish both write to local disk under `src/content/`.
- Functionally equivalent in dev; the UI still surfaces two
  buttons so the artist's mental model carries to production.
- A small inline hint near the buttons: *"In dev mode, Save and
  Publish both write to disk immediately."*

### 12. Migration for existing sites

For artist sites deployed before this ADR ships:

- On first admin request after the platform upgrade, the broker
  checks for the `draft` branch on the artist's repo.
- If absent, broker creates it via `createRef` pointing at `main`'s
  current HEAD.
- One-time, idempotent. The artist's repo grows by one new ref; no
  file changes.

### 13. Broker and auth

The publish-token endpoint (ADR-008) currently returns
`{ owner, repo }` and the artist site uses `SITE_GIT_BRANCH` (default
`main`) when committing.

New: tokens are branch-agnostic; the artist site picks which ref to
update at commit time. The broker's permissions for the GitHub App
installation already cover both branches — no auth change needed.

The publish-token endpoint surface is unchanged.

## Rejected alternatives

- **Parallel `.draft.json` files on main.** Drafts live in main's
  history. Each save commits a `<slug>.draft.json` with `[skip ci]`;
  Publish writes the live `<slug>.json` + deletes the draft file in
  one commit. Pros: zero new infrastructure, admin reads cost
  nothing extra (filesystem reads on the deployed snapshot). Cons:
  main's history accumulates draft commits forever even with
  `[skip ci]`; drafts are present on the public branch's working
  tree; cloning main pulls in-progress work. Rejected because the
  history-hygiene cost is structural and gets worse over time.

- **Per-session draft branches.** Each editing session creates a
  branch like `draft/<session-id>`. Pros: isolated per-session for
  multi-artist sites; "publish only my edits" works cleanly. Cons:
  branch lifecycle complexity (creation, deletion, garbage
  collection), per-session UI to surface "your active draft", merge
  conflicts when multiple sessions overlap on the same items.
  Rejected because the v1 audience is single-artist sites, and the
  rolling draft branch handles that case with far less moving
  infrastructure. Per-session branches stay on the table for
  multi-artist support later (could layer in on top of this design).

- **Fast-forward Publish without squash.** Every save's commit
  lands on `main` when published. Pros: trivial publish flow
  (`updateRef main draft.sha`). Cons: main becomes a wall of
  `draft: <slug>` commits — defeats the history-hygiene reason for
  choosing the branch model in the first place. Rejected.

- **Amend-on-save (single rolling draft commit).** Draft always
  has exactly one commit ahead of main; each save force-updates
  that commit with the cumulative tree. Pros: simplest Publish
  (fast-forward). Cons: no per-save audit trail on draft; if the
  artist wants to recover a state from earlier in the session,
  Puck's in-memory undo is the only option. Rejected because the
  per-save commits on draft are cheap and useful for recovery —
  discarding them on Publish is fine because they're superseded
  by the squash commit.

- **External staging store (KV / blob, items keyed by id).** Save
  writes to a non-git store; Publish materializes into a git
  commit. Pros: clean separation of "staged" from "git-tracked".
  Cons: introduces a new storage dep (KV / blob); requires
  staging-store lookups on every admin read; image uploads (which
  need git anyway) split between two stores. Rejected for stack
  simplicity — git as the database remains the philosophy.

- **Vercel / Netlify preview deploys as the draft surface.** Each
  save commits to a branch that builds a preview URL; artist edits
  on the preview deploy. Pros: built-in preview URLs to share with
  collaborators. Cons: per-save deploy latency (~30-60s for a
  preview build); the editor experience pauses for the rebuild on
  every Save. Rejected because the deploy latency makes the typical
  type-save-type-save rhythm unusable. Preview URLs can be layered
  on later as an explicit "Generate preview URL" action that does
  trigger a build.

## Known limitations and deferred work

### Runtime + storage

- **GitHub dependency for admin reads.** With reads sourced from
  `draft` via API, a GitHub outage breaks the admin. Graceful
  degradation: container's baked-in main snapshot serves as a
  stale-but-readable fallback, with edits disabled and a "GitHub
  unavailable — read-only mode" banner.
  *Trigger:* first user-reported incident. Mitigation is ~30 lines.

- **Per-session draft isolation.** Multi-artist sites with
  concurrent draft work share one branch. Publishing publishes
  everything pending, not "just my edits."
  *Trigger:* the first site with multiple regular editors; per-
  session branches become viable then, layering on top of this
  design.

- **Image orphans on Discard.** Images uploaded during a discarded
  draft session remain reachable in `draft`'s reflog window before
  it's garbage-collected, but unreachable from any active item.
  Same orphan story as today (ADR-009 deferred item); not made
  worse by this ADR.
  *Trigger:* same as ADR-009.

### Deploys and CI

- **`[skip ci]` is a host convention.** Vercel and Netlify both
  respect it, but a future host might not. Branch-filter config in
  `vercel.json` / `netlify.toml` is the more portable alternative.
  *Trigger:* when adding a third deploy host that doesn't honor
  `[skip ci]`.

- **Schema migrations split across branches.** A developer commit
  to main that modifies a `_collection.json` won't be reflected on
  draft until next auto-rebase. If the artist tries to publish
  before the rebase, the conflict surfaces at publish time. Clear
  error messaging matters more than prevention.
  *Trigger:* first incident.

### Publish UX

- **Diff preview: richer item labels — shipped.** The publish modal
  now shows the artist's display name ("pages · About Us") instead of
  the slug, via an opt-in `/api/draft-changes?labels=1` read that
  resolves each item's `slugSourceFieldId` value server-side
  (`enrichItemLabels` + the shared `itemDisplayLabel` helper). The
  lightweight chrome reads (indicator + per-row badges) skip labels so
  they don't pay the per-item reads. Renames keep slugs
  ("pages · about → about-us") — the slug move is the point there.
  Remaining cost: a publish near the 300-file compare cap does up to
  ~300 parallel item reads on modal-open (fine for typical publishes;
  the modal shows a loading state).
  *Trigger:* the per-item reads show up as slow modal opens on large
  publishes — then batch the reads or cap enrichment.

- **Per-item Publish (publish A but not B).** Today's model is
  "publish everything pending." Per-item Publish would need
  per-session branches or a fancy diff-extraction trick.
  *Trigger:* a real workflow where it matters.

- **Pending badge on the generic per-item editor — declined.** The
  "Unpublished" badge now covers every surface where it helps an artist
  scan for pending work: the Pages list (PR 5q), the generic collection
  lists (`/admin/collections/<slug>`, PR 5r), and the custom singleton
  panels (Site Settings, Header & Navigation, Appearance — PR 5t,
  badged on the panel title via `getHasPendingSingletonChange`). All
  routed through the shared `pendingItemSlugs` / `hasPendingSingleton`
  filters + the `UnpublishedBadge` component. The one surface left
  without it is the generic per-item editor
  (`/admin/collections/<slug>/items/<slug>`) — deliberately: you're
  already editing that item, so a "this has unpublished changes" hint
  there adds nothing.
  *Trigger:* an artist asks for an at-a-glance pending marker while
  inside the editor (unlikely).

- **Collapse the server/client draft-changes split on collection
  pages.** The client-side reads are now coalesced:
  `fetchDraftChangesShared` (a module-level in-flight promise) folds
  the simultaneous on-mount reads — the sidebar
  `PendingChangesIndicator` plus `PagesPanel`'s badges — into one
  compare call, and the Publish modal shares it when open during the
  window. It's in-flight-only, not a TTL cache, so a save → navigate
  sequence still reflects immediately (the `no-store` freshness intent
  is preserved; a lingering result cache would have regressed it).
  What remains: on `/admin/collections/<slug>` the list reads the diff
  server-side (`getPendingItemSlugs` at render) while the indicator
  reads it client-side — two compare calls the client coalescer can't
  bridge. Passing the server render's result down into the indicator
  (so it skips its own fetch) would close it, but per-call cost is
  modest (broker token process-cached per PR 5m) so it's
  amortise-later.
  *Trigger:* the remaining duplicate compare calls show up in traffic
  profiles.

## Consequences

- **ADR-007 §5 (Publishing) is superseded.** The "every save
  commits to main and deploys" semantics change to "save → draft,
  publish → main." The broker → GitHub commit flow itself is
  preserved; only the target ref + commit shape change.

- **ADR-007 §7 (Drafts) is amended.** `localStorage` drafts now
  serve as the typing buffer in front of the durable draft branch;
  the two-tier model replaces the single-tier "localStorage only".

- **`publish.ts` grows two flows.** `saveToDraft(targets)` for
  Save, `publishDraftToMain()` for Publish. Both share the
  existing commit-files + broker logic. The single-target / multi-
  target shape is preserved.

- **A runtime-fetch + cache layer in `store.ts`.** New ~120 lines,
  isolated behind a `getItem` / `listItems` / etc. abstraction so
  the rest of the admin code doesn't change.

- **The container's filesystem stops being the source of truth.**
  It becomes the GitHub-down fallback only.

- **Image uploads target the draft branch.** Trivial change in
  `upload-image`: commit ref is `draft`, not `main`.

- **Bootstrap step ensures `draft` exists.** Idempotent. Runs on
  first admin request for migrated sites; runs at site creation
  for new sites.

- **Net code surface: ~400-500 lines.** Split across `publish.ts`
  (commit-targeting + squash flow), `store.ts` (runtime fetch +
  cache), `git-commit.ts` (retry-on-stale-base), UI (`SaveBar` two
  buttons + "has pending changes" indicator + discard modal),
  broker (ensure-draft-branch endpoint), and migration.

## Supersedes

- **ADR-007 §5 (Publishing)** — "every save commits to main and
  deploys" semantics. The broker → GitHub commit machinery itself
  is preserved.
- **ADR-007 §7 (Drafts)** — clarifies `localStorage` as the
  typing-buffer tier; durable drafts now live on the `draft`
  branch.
