# ADR-011: Per-editor draft isolation

## Status
Proposed

## Context

ADR-010 introduced a single, shared `draft` branch: every admin save
commits to `draft`, and Publish squashes the whole of `draft` onto
`main`. That model assumes **one editor per site** — the v1 audience.
ADR-010 named two consequences of the shared branch and deferred both:

- *Rejected alternatives → "Per-session draft branches"*: isolated
  drafts "stay on the table for multi-artist support later (could
  layer in on top of this design)."
- *Known limitations → "Per-session draft isolation"*: "Multi-artist
  sites with concurrent draft work share one branch. Publishing
  publishes everything pending, not 'just my edits.' *Trigger:* the
  first site with multiple regular editors."

This ADR picks up that deferred work. Two pressures motivate it:

1. **One editor's Publish ships another's half-done work.** A band's
   drummer is mid-edit on tour dates while the singer finishes her bio
   and hits Publish. Today they share one `draft`, so the singer's
   Publish promotes the drummer's unfinished edits too.
2. **"Publish only my edits" is impossible.** The shared branch has no
   notion of *whose* pending changes are whose, so there's no subset
   to publish.

### The blocking finding: there is no identity to isolate on

Before designing isolation, we have to confront what the system knows
about *who* is editing. Today: almost nothing.

- Auth is a single-email magic link (ADR-007 §4). A site has exactly
  one allowed editor, `ADMIN_EMAIL`.
- The session is a JWT carrying only `{ email, type: "session" }`
  (`auth.ts` `getSession()` → `{ email }`). There is **no session id,
  no per-device token, no user record.**

So "isolation" presupposes two things that don't exist yet: (a) more
than one editor per site, and (b) a stable key to attribute a draft
to. This ADR has to define both, and the multi-editor auth piece is a
genuine **prerequisite** (see §7), not a detail.

## Reframe: per-*editor*, not per-*session*

The deferred work was labelled "per-session" in ADR-010, and the
request that revived it used the same word. But the actual goal —
"two people don't clobber each other" — is **per-editor**, and the
distinction matters because it interacts with a feature ADR-010
deliberately shipped:

> ADR-010 §9: the `draft` branch is "durable cross-device staging: the
> artist can start editing on a laptop, close the lid, continue on a
> phone, and see the same pending state."

- **Per-editor** (key the draft on *who*, i.e. the email identity):
  the same person on laptop and phone shares one draft. Cross-device
  staging is preserved. Two different people get two drafts.
- **Per-session / per-login / per-tab** (key the draft on a freshly
  minted session id): the same person's laptop and phone get *different*
  drafts — a regression on ADR-010 §9 — and you inherit session-id
  minting, lifecycle, GC, and a "resume your draft" UI, none of which
  the per-editor model needs.

Per-editor solves the stated problem and keeps §9. We adopt it and
name the feature accordingly. ("Per-session" is recorded as a rejected
alternative in the Rejected-alternatives section.)

## Glossary

Extends ADR-010's glossary.

- **Editor.** A person allowed to edit a given site, identified by
  their email (the only stable identity the system has).
- **Editor key.** A short, ref-safe, stable derivation of an editor's
  normalized email — `shortHash(lower(trim(email)))`. Used in branch
  names so raw emails (which contain `@`, `.`, and other characters
  that are awkward-to-invalid in git ref names, and are PII) never
  appear in a ref.
- **Per-editor draft branch.** `draft/<editorKey>`. The editor's
  private companion branch, playing the exact role ADR-010's single
  `draft` plays — but scoped to one editor.
- **Pending changes (per editor).** Diff between `main` and
  `draft/<editorKey>`. Each editor sees only their own.

## Decision

Generalize ADR-010's single `draft` branch to **one draft branch per
editor**, `draft/<editorKey>`, resolved from the current session at
every read/write/publish/discard. Single-editor sites keep using the
literal `draft` branch (the resolver returns `"draft"` when a site has
≤1 editor), so existing sites and the dev path are unchanged until a
second editor is actually added.

ADR-010's invariants hold per branch:

1. For each editor key `k`: `draft/<k>.sha === main.sha` OR
   `draft/<k>` is a strict descendant of `main`.
2. The public site builds exclusively from `main`.
3. An editor reads exclusively from *their own* `draft/<k>`.

### 1. Branch resolution (the seam)

A single resolver decides which branch a request targets:

```ts
// lib/draft-branch.ts
export const DRAFT_BRANCH = "draft"; // moved out of publish.ts

// Returns the literal "draft" for single-editor sites (today's
// behavior) and `draft/<editorKey>` once a site has multiple editors.
export function resolveDraftBranch(session: Session | null): string;
```

Every place that currently hardcodes `DRAFT_BRANCH` instead calls
`resolveDraftBranch(session)`:

- `publish.ts`: `ensureDraftAndRebase`, `commitToDraft` / `saveToDraft`,
  `publishDraftToMain` (squash *from* the editor's branch), `discardDraft`
  (reset *the editor's* branch).
- `draft-changes.ts`: the compare basehead becomes
  `main...draft/<editorKey>`.
- `collections/read-store.ts` → `draft-store.ts`: admin reads come from
  the editor's branch.

The API routes already call `getSession()`; they pass the session (or
the resolved branch) into these functions. The read-store facade runs
in a server context and can read the session cookie itself.

### 2. Save / read

Unchanged in shape (ADR-010 §2, §5) — only the target ref differs.
The blob → tree → commit → updateRef flow, the `[skip ci]` marker, the
per-process read cache, and the stale-ref retry loop are all
branch-agnostic and need no change beyond receiving the resolved
branch name. The read cache is already keyed `Map<(branch, path)>`
(ADR-010 §5), so multiple editors' branches coexist in one process
cache without collision.

### 3. Publish — now "publish my edits"

Publish squashes **the editor's own** `draft/<k>` onto `main`, then
fast-forwards *that* branch. Other editors' branches are untouched.
This is exactly the "publish only my edits" semantics the shared model
couldn't offer — it falls out of per-editor branches for free.

After one editor publishes, `main` has moved. Other editors'
`draft/<k>` branches are now behind `main`. ADR-010 §7's **auto-rebase
on next save** already handles this per branch:

- No file overlap → silent rebase; the other editor keeps working.
- Overlap (both edited the same file) → the existing structured
  conflict error ("draft can't merge cleanly with main; Discard or
  contact support"). This is the correct outcome: last publisher wins
  at the file level, and the loser is told explicitly rather than
  silently overwritten.

### 4. Concurrent publishes

Two editors publish near-simultaneously. Each squash sets parent =
`main`'s then-current HEAD and calls `updateRef main`. The loser of the
`updateRef` race gets GitHub's 422 (stale ref) — caught by the existing
retry loop (ADR-010 §6), which re-reads `main`, re-runs
`ensureDraftAndRebase` (merging the winner's commit into the loser's
draft first), and retries the squash. No lost update; a true file
conflict surfaces as §3's structured error.

### 5. Discard

Reset **the editor's own** `draft/<k>` to `main`'s current HEAD
(ADR-010 §4 mechanics, scoped). One editor's Discard never affects
another's pending work.

### 6. Branch lifecycle and GC

- **Creation:** lazy, on the editor's first save —
  `ensureBranchExists` already creates the branch off `main` if absent.
  No bootstrap change beyond the existing "ensure draft exists" check,
  which becomes per-editor.
- **Steady state:** a per-editor branch sits at-or-ahead of `main`. A
  branch equal to `main` (nothing pending) is a single cheap ref;
  leaving it is fine.
- **Removal:** when an editor is removed from a site's allowlist,
  delete their `draft/<k>` (it may carry unpublished work — surface a
  confirmation to the remover, same "this can't be undone" weight as
  Discard). An optional periodic sweep can delete per-editor branches
  that have equalled `main` for longer than a retention window; not
  required for correctness.

### 7. Prerequisite: multi-editor auth

This is the real foundational dependency, and it is **out of scope for
the isolation layer itself** but blocks the feature being observable:

- `ADMIN_EMAIL` (a single string) becomes a per-site **set** of allowed
  editor emails (platform-managed allowlist; env shape e.g.
  `ADMIN_EMAILS`, or a broker-served list). Magic-link request/verify
  check membership instead of equality.
- Until that lands, every site has ≤1 editor, `resolveDraftBranch`
  returns `"draft"`, and this ADR is a no-op. That's the point: the
  isolation layer can land first, dormant, and switch on per-editor
  branches the moment multi-editor auth makes a second editor possible.

Amends ADR-006 / ADR-007 §4 (auth: single → multiple allowed emails).

**Status:** the allowlist landed ahead of the isolation layer —
`ADMIN_EMAILS` (unioned with the legacy `ADMIN_EMAIL`), with magic-link
request gating + a verify-time re-check (`getAllowedEditorEmails` /
`isAllowedEditor` in `auth.ts`). The dormant `resolveDraftBranch` seam
is the remaining prerequisite-side piece.

### 8. Dev fallback

Unchanged. In dev (no `STAGECRAFT_SITE_ID` / `STAGECRAFT_BROKER_SECRET`)
there are no branches — saves write to local disk. Per-editor isolation
is moot for a single local working copy; the resolver is never consulted
on the dev path.

### 9. Migration

- Existing single-editor sites: nothing changes — resolver returns
  `"draft"`, the branch they already have.
- When a site gains its second editor: the **owner keeps `"draft"`**
  (the branch already exists with their pending work), and each
  additional editor gets `draft/<k>` lazily on first save. This avoids
  re-pointing an existing branch and means the common case (one busy
  owner + occasional collaborators) creates the fewest refs. The
  asymmetry (owner on `"draft"`, others on `draft/<k>`) lives entirely
  inside `resolveDraftBranch` and is invisible to callers.

## Rejected alternatives

- **Per-session / per-login / per-tab branches.** Key each draft on a
  freshly minted session id (`draft/<sessionId>`). Rejected: breaks
  ADR-010 §9 cross-device staging (laptop and phone become different
  drafts for the same person); adds session-id minting, branch
  lifecycle, GC, and a "resume your draft in progress" UI that
  per-editor doesn't need; and doesn't model the actual requirement,
  which is about *people*, not logins.

- **Single shared draft + per-item Publish (diff-extraction).** The
  other deferred ADR-010 item — let one editor publish a subset of the
  shared branch's pending files. Rejected as a *substitute*: it offers
  "publish A but not B" but not isolation — every editor still shares
  one draft and one admin view, so the drummer's half-done tour edits
  are still visible in (and squashable from) the singer's session. It's
  complementary, not equivalent; per-editor branches give "publish my
  edits" for free, which is most of what per-item Publish was for.

- **External per-editor staging store (DB / KV).** Hold each editor's
  pending changes outside git, materialize on Publish. Rejected for the
  same reason ADR-010 rejected its KV alternative: git stays the
  database; image uploads need git anyway; admin reads would need a
  staging lookup on every request.

## Known limitations and deferred work

- **Editor removal doesn't revoke live sessions.** The multi-editor
  allowlist (§7, shipped) gates new logins and re-checks at magic-link
  verify, so a removed editor can't mint a *new* session — but an
  already-issued session cookie stays valid until it expires (7 days).
  `middleware.ts` checks session validity, not live allowlist
  membership. Immediate lock-out would need a per-request allowlist
  check in middleware (or a session epoch/version bumped on removal),
  kept off the hot path until needed. *Trigger:* an editor must be
  locked out immediately (e.g. a departure on bad terms).

- **No cross-editor draft visibility.** By design, editor A can't see
  editor B's unpublished draft in the admin. A "preview a collaborator's
  draft" surface is deferred. *Trigger:* editors ask to review each
  other's work before publish.

- **No real-time co-editing.** Two editors editing the *same item* in
  separate drafts resolve at the file level: the second to publish hits
  the rebase conflict (§3) and chooses Discard-or-support. True
  simultaneous co-editing of one document is a CRDT/OT problem, out of
  scope for a branch-based model. *Trigger:* not anticipated for the
  musician-site audience.

- **Abandoned-branch GC policy.** §6 defines removal on editor-delete;
  a periodic sweep of stale (== `main`) per-editor branches is optional
  and unspecified here. *Trigger:* ref count on a long-lived
  many-collaborator site becomes noticeable.

## Consequences

- **The `DRAFT_BRANCH` constant becomes `resolveDraftBranch(session)`.**
  The string moves to `lib/draft-branch.ts`; `publish.ts`,
  `draft-changes.ts`, and the read-store stack call the resolver. The
  first PR introduces this seam returning `"draft"` unconditionally — a
  pure refactor, no behavior change — so the threading lands and is
  reviewable before any per-editor logic exists.

- **Multi-editor auth is a prerequisite** (§7), amending ADR-006 /
  ADR-007 §4. The isolation layer is dormant until it ships.

- **ADR-010's invariants and flows are preserved per branch.** Save,
  read-cache, stale-ref retry, auto-rebase, squash-Publish, and Discard
  all already operate on a branch name; per-editor isolation is "pass a
  different name," not a new mechanism.

- **"Publish my edits" is delivered as a side effect**, partially
  retiring the separate "Per-item Publish" deferred item for the
  multi-editor case.

## Relates to / amends

- **ADR-010 (draft-branch publish model)** — extends it from one draft
  branch to one-per-editor; reuses every flow.
- **ADR-006 / ADR-007 §4 (authentication)** — requires single-email →
  multi-editor allowlist as a prerequisite.
