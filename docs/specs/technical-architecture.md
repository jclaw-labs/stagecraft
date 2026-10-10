# Stagecraft — Technical Architecture

## 1. Purpose

This document describes how Stagecraft is built today: the platform app, the
artist sites it provisions, and how the two talk to each other. It is the
map; the ADRs in `docs/adr/` hold the reasoning behind each decision, and
`docs/runbook.md` holds the operator procedures.

Anything described here that isn't built yet is marked **Roadmap** and
collected in §14.

This document used to be the original build plan: an Astro site template,
an AI worker that edited artist repos, and a pull-request-based change
request flow, followed by a milestone and ticket backlog. That product was
cut (issue #344, decided 2026-10-10) and its code removed (#399). The old
plan is in this file's git history.

---

## 2. System Summary

Stagecraft has two parts:

1. **The platform** (`apps/web`, plus `packages/*`). A Next.js app on
   Netlify with a Postgres database. Artists sign in with GitHub, connect a
   deploy target (Vercel or Netlify) and Resend, and create a site. The
   platform provisions the site, then stays involved only as a **token
   broker**: it hands the artist's site short-lived GitHub tokens so the
   site's own editor can commit to its own repo.
2. **Artist sites.** Each site is a private GitHub repo in the artist's
   account, created from `templates/musician-site` (Next.js + Puck, ADR-007).
   The repo holds the site's code and all of its content as JSON files. The
   site is deployed by the artist's Vercel or Netlify account and has its
   own editor at `/admin`. Saving in the editor commits to a draft branch in
   that repo; publishing merges the draft into `main`, and the host rebuilds.

```
 Artist's browser
   │                          │
   │ platform UI              │ public site + /admin editor
   ▼                          ▼
 ┌─────────────────────┐    ┌──────────────────────────────┐
 │ Platform (apps/web) │◄───│ Artist site (Next.js + Puck) │
 │ Netlify + Postgres  │    │ on artist's Vercel / Netlify │
 └──────────┬──────────┘    └──────────────┬───────────────┘
            │ provision: repo, host        │ commit via broker token
            │ project, env vars            │ (draft branch, then main)
            ▼                              ▼
     GitHub · Vercel/Netlify · Resend    artist's GitHub repo
```

The platform never stores site content. If Stagecraft disappeared, every
artist would still have a working repo and a working deploy; only the
editor's save and publish would stop, because they need the broker.

---

## 3. Principles

These are the owner's decisions, recorded on the 2026-10 review issues:

- **The site is files in the artist's git.** Content, schemas and layouts
  live in the artist's repo with full history. There is no platform
  database for content or drafts; drafts are git branches (#342,
  ADR-010).
- **Artists customise their site.** Artists edit collection schemas and
  design item and detail layouts in the editor (#340, ADR-009). The
  content model is not fixed by the template.
- **It stays free.** Nothing in the design may need a paid tier: no paid
  registry, no paid hosting plan. Vercel's and Netlify's free tiers must
  build every site (#341).
- **Repos are private by default.** New artist repos are created private
  (#343, #398). Deleting a site archives its repo; it never deletes it.
- **The platform holds the master credentials.** The GitHub App private
  key and the artists' provider tokens stay on the platform; artist sites
  get per-site, short-lived, repo-scoped tokens (ADR-008).
- **Template updates are versioned.** Decided on #341; designed in
  ADR-016 (Proposed). **Roadmap:** today each site is a one-time copy of
  the template (§14).

---

## 4. Repository Layout

```
apps/web/                  Platform app (Next.js 15, App Router)
  src/app/                 Pages: marketing, /dashboard, /create, /sites/[id], /settings
  src/app/api/             Route handlers (see §5.2)
  src/lib/jobs/            Job handlers: create_site, migrate_site, shared provisioning
  src/lib/integrations/    GitHub, Netlify, Vercel, Resend clients
  src/lib/migration/       Crawler, content mapper and report for migrate_site
  scripts/                 Template bundle generator, credential backfill
  netlify/functions/       Scheduled queue drain (drain-jobs.ts)
packages/
  db/                      Prisma schema, client and migrations
  queue/                   Postgres-backed job queue (enqueue, worker, step runner)
  shared/                  Types, enums and helpers shared across packages
templates/
  musician-site/           The artist-site template (Next.js + Puck)
docs/
  adr/                     Architecture decision records
  specs/                   Product spec and this document
  runbook.md               Operator runbook
```

---

## 5. Platform

### 5.1 Runtime

- Next.js 15 (App Router), React 19, TypeScript, deployed on Netlify.
  The Cloudflare Worker build was dropped in #464.
- Postgres through Prisma (`packages/db`); production runs on Neon.
- Sign-in is NextAuth with the GitHub provider and database sessions
  (ADR-006). Session tokens are stored hashed (#411).
- Background work runs on the job queue in `packages/queue` (§9).

### 5.2 Route handlers

| Route | Purpose |
| --- | --- |
| `/api/auth/[...nextauth]` | GitHub sign-in |
| `/api/integrations/netlify`, `/netlify/callback` | Netlify OAuth connect |
| `/api/integrations/vercel/connect` | Vercel personal access token connect |
| `/api/integrations/resend/connect`, `/verify-send` | Resend API key connect and sender check |
| `/api/sites` | List sites; `POST` creates a site and queues `create_site` |
| `/api/sites/[siteId]` | Site detail and delete |
| `/api/sites/[siteId]/retry` | Re-queue a failed `create_site` job ("Retry setup") |
| `/api/sites/[siteId]/deploy-status` | Latest deploy on the site's host, for the dashboard |
| `/api/sites/[siteId]/install-url` | "Connect repo": attach an existing App installation, or return the App install URL |
| `/api/migrations` | Queue `migrate_site` for an existing site URL |
| `/api/publish-token` | **Broker.** Mints a repo-scoped GitHub installation token for an artist site |
| `/api/broker/deploy-status` | **Broker.** Latest deploy state for an artist site's editor |
| `/api/github/install-callback` | GitHub App install completion |
| `/api/github/webhook` | GitHub App lifecycle events |
| `/api/cron/jobs` | Runs one queued job; called by the scheduled drain |
| `/api/health` | Database check and in-process counters |
| `/api/admin/nuke-my-sites` | Bulk delete for allowlisted operator accounts |

The two broker routes authenticate with the site's broker secret
(`Authorization: Bearer`), not a platform session.

### 5.3 Data model

`packages/db/prisma/schema.prisma` is the source of truth. The platform
stores account and provisioning metadata only:

| Model | Holds |
| --- | --- |
| `User`, `Account`, `Session`, `VerificationToken` | NextAuth identity and sessions |
| `IntegrationAccount` | One row per user and provider (`github`, `netlify`, `vercel`, `resend`): token, scopes, metadata |
| `Site` | Name and slug, status, GitHub repo and App installation, broker secret hash, deploy target and its project ids, production URL |
| `SiteJob` | A queued job (`create_site`, `migrate_site`): payload, per-step progress, result, failure category, retry and lease state |
| `WebhookDelivery` | GitHub webhook delivery ids already handled, for de-duplication |

Provider tokens in `Account` and `IntegrationAccount` are encrypted at the
application layer (AES-256-GCM, bound to their row; ADR-005, runbook §9).
`Site.brokerSecretHash` is a SHA-256 hash; the plaintext secret is never
stored.

`Site.blueprintType` is vestigial: always `solo-artist`, no longer written
by app code, and on its way out (#445).

---

## 6. External Integrations

### 6.1 GitHub

Two separate identities (ADR-005, ADR-006, ADR-008):

- **The artist's OAuth token**, from sign-in, with scopes
  `read:user user:email repo workflow` (`github-oauth-scope.ts`). The
  platform uses it to create the artist's repo, push the template, push the
  Dependabot auto-merge workflow (hence `workflow`), find App
  installations, and archive the repo when a site is deleted. It no longer
  requests `delete_repo` (#398).
- **The Stagecraft GitHub App** (`stagecraft-bot`), with `Contents: write`
  and `Metadata: read`. Its private key stays on the platform. The broker
  mints installation tokens scoped to the one site repo (#355); the artist
  site commits with them. Webhooks keep `Site` in step with installs,
  suspensions and removals.

### 6.2 Deploy targets: Vercel and Netlify

Each site deploys to exactly one host, from the artist's own account
(`Site.deployTarget`). Vercel is preferred when both are connected, because
its API links a GitHub repo without the platform having to find the host's
GitHub App installation. Vercel connects with a personal access token,
Netlify with OAuth. Provisioning creates the host project linked to the
repo and sets the site's environment variables; the host builds on every
push to `main`.

### 6.3 Resend

Each artist connects their own Resend account. Provisioning copies the API
key into the site's environment, where the site uses it for editor
magic-link emails and contact-form delivery. The platform never sees who
those emails go to.

---

## 7. Artist Site Template

`templates/musician-site` is the whole artist site: public renderer, editor,
API routes, git plumbing, image pipeline and auth. Its `CLAUDE.md` is the
detailed guide; this section is the overview.

### 7.1 Stack

- Next.js 15 (App Router), React 19, TypeScript.
- Puck (`@puckeditor/core`) for visual editing of pages and layouts.
- Files only, no database. Content is JSON under `src/content/`; uploaded
  images are under `public/images/`.

### 7.2 Content model (ADR-009)

Every editable surface is a **collection**: pages, the `site`, `header` and
`appearance` singletons, and the prebaked tour dates, releases, posts,
store items, photos and videos. Artists can add their own.

```
src/content/collections/<collection-slug>/
  _collection.json        CollectionDef: fields, item/detail/list templates,
                          detail URL prefix, default sort
  items/
    <item-slug>.json      one item per file
    _singleton.json       the one item of a singleton collection
    _order.json           manual order, when the collection uses it
```

- Fields have stable ids (`fld_…`) and artist-facing keys, so renaming a
  field doesn't touch item values. The schema editor guards destructive
  changes and migrates items.
- Item and detail layouts are Puck templates whose blocks bind to item
  fields. Pages use the same block library (ADR-015).
- A collection with a `detailUrlPrefix` gets public detail pages
  (`/shows/<slug>`); pages use `/`. The public catch-all
  (`src/app/(public)/[[...slug]]`) dispatches by longest prefix and
  prerenders at build time; prefix collisions fail the build.

### 7.3 Editor and saving (ADR-010, ADR-011, ADR-012)

- `/admin` is gated by a magic-link session. The allowed editors are
  `ADMIN_EMAILS` (plus the legacy `ADMIN_EMAIL`, which provisioning sets).
- A save commits to the editor's draft branch: `draft`, or
  `draft-<editorKey>` per editor on a multi-editor site. Nothing is
  written to the server's disk in production (#345). Admin reads come from
  the draft branch over the GitHub API (`read-store.ts`, `draft-store.ts`),
  falling back to the build-time snapshot of `main` on transient errors.
- **Publish** merges the draft into `main`, all at once or per item. The
  push to `main` triggers the host's build. The editor shows the build
  state through the broker's deploy-status route.
- Without platform configuration in a dev build, local disk is the content
  store. A production build without it refuses to save.

### 7.4 Platform contract

The site needs three environment variables to save, all set by
provisioning or by the install callback:

| Var | Purpose |
| --- | --- |
| `STAGECRAFT_SITE_ID` | The `Site.id` (not `SITE_ID`, which Netlify reserves) |
| `STAGECRAFT_BROKER_SECRET` | Per-site secret for the broker routes; also the root the magic-link signing secret is derived from |
| `STAGECRAFT_PLATFORM_URL` | Broker base URL; defaults to the production platform, so provisioning doesn't set it |

Provisioning also sets `ADMIN_EMAIL` and `RESEND_API_KEY`.

### 7.5 Other template features

- **Images:** `POST /api/upload-image` validates, de-duplicates by content
  hash, makes AVIF and WebP variants with sharp (raster only; SVGs are
  sanitised), and commits them to the draft branch.
- **Contact form:** `POST /api/contact` sends through the artist's Resend
  account, with a honeypot, an in-memory per-IP rate limit and a
  same-origin check.
- **Welcome wizard:** a new site's first `/admin` visit asks for the
  artist name, a starting theme or custom colour, an optional wordmark and
  the first page's title, then writes the seed content and publishes it
  (ADR-013).
- **Dependency updates:** provisioning adds Dependabot (weekly, 7-day
  cooldown) and a workflow that builds and auto-merges passing patch and
  minor updates. The workflow push is best-effort.

---

## 8. Site Lifecycle

### 8.1 Create

1. The artist signs in with GitHub and connects a deploy target and Resend
   (with a verified email) in Settings.
2. `/create` asks for a site name. There is no blueprint to choose; every
   site starts from the same template (product spec §14).
3. `POST /api/sites` checks the integrations and slug, creates the `Site`
   (status `creating`) and queues a `create_site` job.
4. The job runs the provisioning steps in
   `apps/web/src/lib/jobs/provision-site.ts`, each recorded on the job so a
   retry resumes where it stopped:
   1. `createRepo`: private repo `stagecraft-site-<slug>` in the artist's
      account.
   2. `pushTemplate`: the template as-is (from the bundle built by
      `apps/web/scripts/generate-template-bundle.mjs`), the Dependabot
      config and a template stamp; then the auto-merge workflow.
   3. `findInstallation`: look for the Stagecraft App on the repo owner.
   4. `mintBrokerSecret`: when the App is installed, mint the secret and
      store its hash.
   5. `createHostProject`: the Vercel project or Netlify site, linked to the
      repo.
   6. `setEnv`: the site's environment variables (§7.4).
5. The site goes `active`. The artist opens its `/admin`, and the welcome
   wizard writes the first content.

If the App wasn't found, the site detail page shows **Connect repo**. That
either attaches an installation the platform can now see
(`/api/sites/[siteId]/install-url`) or sends the artist through GitHub's
install screen to `/api/github/install-callback`. Both mint the broker
secret and push it to the host, falling back to showing it once for
manual setup if the push fails.

Transient failures are retried by the queue. Permanent ones (a missing
precondition, a repo name already taken) mark the site `error`, and the
site page offers **Retry setup**.

### 8.2 Migrate

`POST /api/migrations` queues `migrate_site` for an existing brochure-style
site. Its `crawlSource` step crawls the source (`lib/migration/crawler.ts`),
maps the pages into the template's collections
(`musician-site-mapper.ts`) and records a report of what was imported and
what needs review. The job then runs the same provisioning steps as
create, pushing the mapped content over the template. **Retry setup**
doesn't cover migrations yet; a failed migration is deleted and run again.

### 8.3 Delete

`DELETE /api/sites/[siteId]` deletes the host project and the `Site` row,
and archives the GitHub repo instead of deleting it (#429). Both cleanups
are best-effort: failures are reported, and the site is deleted anyway.

---

## 9. Job Queue

`packages/queue` is a small Postgres-backed queue over `SiteJob`:

- A worker claims the oldest `queued` job whose `runAt` has passed and
  takes a 5-minute lease (`lockedUntil`), renewed every minute while the
  handler runs. A lapsed lease returns the job to `queued`.
- A handler that throws is retried twice with backoff, then the job is
  `failed`. Handlers record per-step progress (`resultPayload.steps`), so a
  retried run resumes at the step that failed.
- Three things drive the queue on Netlify: an in-process poller every 3
  seconds while a function is warm, a drain of one job right after the
  response of any route that enqueues (`after()`), and a scheduled
  function that calls `POST /api/cron/jobs` every five minutes.

Runbook §1, §4.2 and §8 cover the details and recovery.

---

## 10. Webhooks

`POST /api/github/webhook` verifies the HMAC signature, handles each
delivery once (recording the delivery id only after it's handled, #359),
and applies App lifecycle events to `Site`:

- `installation.suspend` / `unsuspend` set and clear
  `githubAppSuspended`; the broker refuses suspended sites.
- `installation.deleted`, and `installation_repositories.removed` for the
  site's repo, clear the installation and repo fields. The broker secret
  hash is kept.

---

## 11. Security

- **Secrets on the platform:** GitHub App credentials, the OAuth client
  secret, the credential encryption key, the install-state signing secret,
  the cron secret. Runbook §2 lists them.
- **Provider tokens** are encrypted at rest and bound to their row
  (ADR-005). Database write access is still equivalent to account
  takeover, so it is limited to the app and operators.
- **Broker tokens** are scoped to one repo with `contents: write` and
  `metadata: read`, and expire within the hour.
- **Broker secrets** are stored as hashes and compared in constant time.
  The platform can't show a secret again after the one time it may display
  it. **Roadmap:** there is no rotation endpoint yet (ADR-008).
- **Access control:** every platform route checks that the signed-in user
  owns the site. Operator-only routes use a hard-coded allowlist.
- **Artist repos** are private by default and never deleted by the
  platform.

---

## 12. Failure Handling and Observability

- A failed job stores `errorMessage` and a `failureCategory`
  (`FailureCategory` in `@stagecraft/shared`). In practice provisioning
  sets `vercel_github_app_missing`, for which the site page links to
  Vercel's GitHub App install before retrying; the queue sets `timeout`
  for an expired lease; anything else is `unknown`, and the site page
  shows the error message with **Retry setup**.
- `lib/telemetry.ts` writes structured JSON events to stdout and keeps
  in-process counters, which `/api/health` reports. There is no external
  metrics service.

---

## 13. Validation and CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`:

- **Monorepo:** typecheck, lint, tests and build for `apps/*` and
  `packages/*`, plus a bare `next build` without the pre-generated template
  bundle.
- **Template:** typecheck, lint, unit tests, build and the Playwright
  editor tests for `templates/musician-site`.
- **Dependency audit** and a **migration safety check** (expand, then
  contract; runbook §10). Pushes to `main` apply pending Prisma migrations
  to production.

Artist repos get no CI beyond the Dependabot auto-merge build. Their host
builds every push to `main`, and a failing build leaves the last good
deploy live.

---

## 14. Roadmap

Intended, not built:

- **Versioned template (ADR-016, Proposed).** Ship the template's code as
  a versioned package so fixes reach existing sites, keeping content in
  the artist's repo and everything free. Today a site never receives
  template changes after it's created.
- **Broker secret rotation (ADR-008).** No endpoint or dashboard action
  issues a new secret for a connected site. An operator can clear the
  site's installation so the next **Connect repo** mints and pushes a fresh
  secret (runbook §6).
- **Migration retry.** Resume a failed `migrate_site` the way **Retry
  setup** resumes `create_site`.
- **Image upload de-duplication on GitHub.** Re-uploading an image still
  creates an empty commit; a pre-check would skip it.

Each ADR's "Known limitations and deferred work" section lists smaller
deferred items with the triggers for picking them up.
