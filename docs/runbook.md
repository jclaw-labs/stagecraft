# Stagecraft Operator Runbook

This document is for engineers and support staff operating the Stagecraft platform. It covers the architecture, common failure modes, and recovery procedures.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Environment Setup](#2-environment-setup)
3. [Health Check](#3-health-check)
4. [Common Failure Modes](#4-common-failure-modes)
5. [Manually Retrying Failed Jobs](#5-manually-retrying-failed-jobs)
6. [Verifying GitHub Integration](#6-verifying-github-integration)
7. [Verifying Netlify Integration](#7-verifying-netlify-integration)
8. [Cloudflare Worker](#8-cloudflare-worker)
9. [Credential Encryption](#9-credential-encryption)
10. [Database Migrations](#10-database-migrations)

---

## 1. Architecture Overview

```
┌─────────────┐     HTTP      ┌─────────────────────────┐
│   Browser   │ ───────────► │  Next.js App (apps/web)  │
└─────────────┘              │                          │
                             │  /api/auth/...           │  NextAuth + GitHub OAuth
                             │  /api/integrations/...   │  Netlify OAuth
                             │  /api/sites/...          │  Site CRUD
                             │  /api/health             │  Health check
                             └────────────┬─────────────┘
                                          │
                             ┌────────────▼─────────────┐
                             │   PostgreSQL Database     │
                             │   (via Prisma ORM)        │
                             └────────────┬─────────────┘
                                          │
                             ┌────────────▼─────────────┐
                             │  @stagecraft/queue        │
                             │  Polling worker (5 s)     │
                             │  Processes SiteJob rows   │
                             └──────────────────────────┘
```

### Key Models

| Model | Purpose |
|---|---|
| `User` | Platform user account (linked to GitHub via NextAuth) |
| `IntegrationAccount` | Stored OAuth tokens for GitHub and Netlify |
| `Site` | A generated musician website |
| `SiteJob` | Async background job (create_site, edit_site, etc.) |
| `ChangeRequest` | An edit request tied to a job and GitHub PR |
| `AuditEvent` | Immutable event log |

### Job Lifecycle

```
queued  ──►  running  ──►  completed
  ▲                  └──►  failed
  │                  └──►  awaiting_review
  └──── retry / repair / expired lease ──┘
```

The worker polls the `SiteJob` table every 5 seconds for the oldest `queued` job whose `runAt` (retry backoff) has passed and processes it. All state transitions are reflected in the database immediately.

A claimed job carries a lease (`lockedUntil`, 5 minutes) that the worker renews every minute while the handler runs. A handler that throws is retried up to 2 times (`retryAttempts`), 30s then 60s later; the third failure marks the job `failed` with the last error. `migrate_site` catches its own errors and returns a failure instead of throwing, so its errors are usually not retried automatically; it is re-run when its lease is lost, or in the rare case that it throws anyway (for example, when its own write of the site's error status fails). See [4.2](#42-job-stuck-in-running) for what happens when a worker dies mid-job.

`create_site` (queued by `POST /api/sites`) runs as named steps: `createRepo`, `pushTemplate`, `findInstallation`, `mintBrokerSecret`, `createHostProject`, `setEnv`. Each step's state and result are recorded under `resultPayload.steps` as it runs, so a retried run, a run after an expired lease, or a manual retry skips the finished steps and resumes at the first unfinished one. Transient errors are thrown for the worker to retry; the site stays `creating` meanwhile. Once retries are spent, or for a missing precondition (no verified email, no deploy target or Resend connected, repo name taken), the site goes to `error` and the job to `failed`. The site page then offers **Retry setup**, which calls `POST /api/sites/<id>/retry` to re-queue the same job with its progress. A retry adopts a repo, Netlify site or Vercel project with the expected name only when it was created after the step's first attempt started (2 minutes of clock skew allowed). So if the job failed on "repo name taken", or refuses a resource it made itself because of a larger clock skew, delete or rename the existing one before retrying. When Vercel's GitHub App is missing, the job fails with `failureCategory = 'vercel_github_app_missing'` and keeps the repo, and the site page links to the App install before the retry.

On hosts with the in-process poller (Netlify), the sites API also runs one queued job right after its response (Next's `after()`), since a function frozen after its response can't be relied on to poll.

---

## 2. Environment Setup

The project uses 1Password for secret management in development. The `.op.env` file stores `op://` references that are resolved at runtime by the 1Password CLI. Run:

```bash
npm run dev  # uses op run --env-file=apps/web/.op.env
```

For production or CI, set the variables below directly in your hosting environment.

### Required env vars

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Random secret for NextAuth session signing |
| `AUTH_URL` | Base URL of the app (`http://localhost:3000` locally) |
| `AUTH_GITHUB_ID` | GitHub OAuth App client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret |
| `NETLIFY_CLIENT_ID` | Netlify OAuth App client ID |
| `NETLIFY_CLIENT_SECRET` | Netlify OAuth App client secret |
| `CRON_SECRET` | Bearer secret for `POST /api/cron/jobs`, the scheduled job-queue drain. Unset disables the route (503). |
| `STAGECRAFT_INPROCESS_WORKER` | Set to `false` to stop the in-process job poller (hosts with no long-lived process). Queue is then drained only via `/api/cron/jobs`. |
| `STAGECRAFT_CREDENTIALS_KEY` | Current key for encrypting stored integration credentials, as `<keyId>:<base64 of 32 bytes>`. Unset, new tokens are stored in plaintext and the app logs a warning once per process. Generating it and the rollout order are in [§9](#9-credential-encryption). |

### Optional env vars

| Variable | Description |
|---|---|
| `STAGECRAFT_CREDENTIALS_OLD_KEYS` | Retired credential keys, comma-separated, same format as `STAGECRAFT_CREDENTIALS_KEY`. Used only to decrypt values written before a rotation ([§9](#9-credential-encryption)). |
| `DATABASE_DRIVER` | How Prisma connects. Unset, empty or `engine`: Prisma's built-in TCP engine, whatever the `DATABASE_URL` host. `neon`: opt in to the Neon driver adapter (WebSockets), needed on Cloudflare Workers; it requires `DATABASE_URL` and a global `WebSocket` (Node 22+ or Workers) and fails at startup without them. Any other value fails at startup. |

---

## 3. Health Check

```bash
curl https://<your-domain>/api/health
```

**Healthy response (`200 OK`):**
```json
{
  "status": "ok",
  "uptime": 184200,
  "checks": { "database": "ok" },
  "metrics": {
    "job.started": 9,
    "job.completed": 8,
    "job.failed": 1
  }
}
```

**Degraded response (`503 Service Unavailable`):**
```json
{
  "status": "degraded",
  "uptime": 184200,
  "checks": { "database": "error" },
  "metrics": {}
}
```

If `database` is `"error"`, the app cannot serve most requests. Check `DATABASE_URL` and confirm the database is reachable.

---

## 4. Common Failure Modes

### 4.1 Database unreachable

**Symptom:** `GET /api/health` returns `503` with `"database": "error"`. All API routes fail with 500.

**Diagnosis:**
```bash
# Check database connection directly
psql "$DATABASE_URL" -c "SELECT 1"
```

**Recovery:**
1. Verify `DATABASE_URL` is correct.
2. Check that the PostgreSQL server is running (`docker-compose ps` if local).
3. Confirm network/firewall rules allow the app to reach the database host.

---

### 4.2 Job stuck in `running`

**Symptom:** A `SiteJob` row has `status = "running"` and `startedAt` is more than a few minutes ago, but `completedAt` is null.

**Cause:** The worker process crashed, or its serverless invocation was frozen, while a job was in flight.

**Automatic recovery:** Usually none needed. Every claim takes a 5-minute lease (`lockedUntil`) that the worker renews every minute while the handler runs. When a worker dies the renewals stop, and the next poll from any worker (the in-process poller or `POST /api/cron/jobs`) finds the lapsed lease and:

- returns the job to `queued` with `retryAttempts` incremented, `errorMessage = 'Lease expired: …'` and `failureCategory = 'timeout'`, if it has retries left (fewer than 2 so far); or
- marks it `failed` with the same message once retries are used up, so a job that kills its worker every time can't loop forever.

So a job stuck past `lockedUntil` clears on the next poll; if nothing is polling (in-process worker off and no cron), trigger a drain:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/jobs
```

If the old worker turns out to be alive after all (a frozen invocation that thaws), its late result is discarded: post-claim writes only apply while the row is still `running` with the `startedAt` that worker stamped. It logs `job.lease_lost`. A `job.lease_lost` whose `error` says an earlier attempt may have landed is different: the worker's result write failed, was retried, and the retry matched no row. Usually the first attempt committed and only its response was lost, so check the row before acting; if it is `completed` or `failed` with this run's result, nothing was lost.

**Diagnosis:**
```sql
SELECT id, type, status, "startedAt", "lockedUntil", "retryAttempts", "createdAt"
FROM "SiteJob"
WHERE status = 'running'
ORDER BY "startedAt";
```

Rows with `"lockedUntil"` in the future are held by a live worker; leave them alone. Rows with a **null** `"lockedUntil"` are never reaped automatically: they were claimed by a worker deployed before leases existed, or are `create_site` rows from before create_site moved to the queue, when the sites API ran it synchronously (cancel those, see [Section 5](#cancel-a-stuck-job), and mark their site `error`).

A `create_site` job that was reaped after its last retry is `failed`, but its site may still say `creating`. Set the site to `error` (`UPDATE "Site" SET status = 'error' WHERE id = '<site-id>';`) and the artist can use **Retry setup**, which resumes from the job's recorded steps.

**Manual fallback:** Reset the job to `queued` so the worker picks it up again:
```sql
UPDATE "SiteJob"
SET status = 'queued', "startedAt" = NULL, "lockedUntil" = NULL, "runAt" = NULL
WHERE id = '<job-id>';
```

---

### 4.3 Job repeatedly failing

**Symptom:** A `SiteJob` row has `status = "failed"` and `errorMessage` indicates a transient or external error.

`"retryAttempts"` counts automatic re-runs. A job gets at most 2 automatic re-runs in total, shared between two causes: a handler that throws is re-queued with backoff (30s, then 60s), and a job whose lease expired is re-queued by the reaper to run immediately. `migrate_site` reports its errors without throwing, so a failed `migrate_site` row usually has `"retryAttempts" = 0`: it ran once and was not retried. A non-zero value means earlier runs were lost (lease expired) or threw.

**Diagnosis:**
```sql
SELECT id, type, "errorMessage", "retryAttempts", "createdAt", "completedAt"
FROM "SiteJob"
WHERE status = 'failed'
ORDER BY "completedAt" DESC
LIMIT 20;
```

**Recovery:** See [Section 5](#5-manually-retrying-failed-jobs).

---

### 4.4 GitHub OAuth token expired

**Symptom:** Jobs that call the GitHub API fail with `401 Unauthorized` in the `errorMessage`.

**Diagnosis:** Check `IntegrationAccount` for the affected user:
```sql
SELECT "userId", provider, "tokenExpiresAt", "updatedAt"
FROM "IntegrationAccount"
WHERE provider = 'github';
```

**Recovery:** The user must disconnect and reconnect their GitHub account from the Settings page, which re-issues a fresh token.

---

### 4.5 Netlify site creation failing

**Symptom:** `create_site` jobs fail with Netlify API errors.

**Diagnosis:** Check the job's `errorMessage`:
```sql
SELECT "errorMessage" FROM "SiteJob" WHERE id = '<job-id>';
```

Common causes:
- Netlify access token expired → user must reconnect Netlify integration
- Netlify API rate limit → wait and retry
- Site name conflict on Netlify → inspect the `name` field in `requestPayload`

---

## 5. Manually Retrying Failed Jobs

### Re-enqueue a single failed job

```sql
UPDATE "SiteJob"
SET
  status       = 'queued',
  "startedAt"  = NULL,
  "completedAt" = NULL,
  "errorMessage" = NULL,
  "retryAttempts" = 0,
  "runAt"      = NULL,
  "lockedUntil" = NULL
WHERE id = '<job-id>';
```

Resetting `"retryAttempts"` gives the job its automatic retries back; leave it out to allow a single run only.

The worker will pick it up within 5 seconds. To process it right away (or when the in-process poller is off), drain the queue by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/jobs
# → {"ok":true,"processed":1}
```

### Re-enqueue all recently failed jobs for a site

```sql
UPDATE "SiteJob"
SET status = 'queued', "startedAt" = NULL, "completedAt" = NULL, "errorMessage" = NULL,
    "retryAttempts" = 0, "runAt" = NULL, "lockedUntil" = NULL
WHERE "siteId" = '<site-id>'
  AND status = 'failed'
  AND "createdAt" > NOW() - INTERVAL '1 day';
```

### Cancel a stuck job

```sql
UPDATE "SiteJob"
SET status = 'canceled', "completedAt" = NOW(), "lockedUntil" = NULL
WHERE id = '<job-id>';
```

---

## 6. Verifying GitHub Integration

### Check a user's GitHub token is stored

```sql
SELECT "userId", "providerAccountId", scopes, "updatedAt", metadata
FROM "IntegrationAccount"
WHERE provider = 'github' AND "userId" = '<user-id>';
```

### Manually verify the token works

`accessToken` is stored encrypted (it starts with `enc:v1:`; see [§9](#9-credential-encryption)), so the column value is not the token. Decrypt it with `decryptCredential` from `apps/web/src/lib/credential-crypto.ts` and the deployed key, or have the user reconnect. With the plaintext token:

```bash
curl -s -H "Authorization: Bearer <access_token>" \
  https://api.github.com/user | jq .login
```

### Confirm required scopes

The token must have `repo` scope (for creating repos and pushing files). The `scopes` column in `IntegrationAccount` should include `repo`.

---

## 7. Verifying Netlify Integration

### Check a user's Netlify token is stored

```sql
SELECT "userId", "providerAccountId", "updatedAt"
FROM "IntegrationAccount"
WHERE provider = 'netlify' AND "userId" = '<user-id>';
```

### Manually verify the token works

As with GitHub, the stored `accessToken` is encrypted; decrypt it first ([§9](#9-credential-encryption)).

```bash
curl -s -H "Authorization: Bearer <access_token>" \
  https://api.netlify.com/api/v1/accounts | jq '.[0].name'
```

### Confirm a site is linked

```sql
SELECT id, name, "netlifySiteId", "productionUrl", status
FROM "Site"
WHERE id = '<site-id>';
```

`netlifySiteId` should be set after a successful `create_site` job. `productionUrl` is populated once the first deploy succeeds.

---

## 8. Cloudflare Worker

`apps/web` also builds as a Cloudflare Worker named `stagecraft` (`apps/web/wrangler.jsonc`). It serves only the workers.dev preview, `https://stagecraft.<account-subdomain>.workers.dev`. It has no routes or custom domains, so stagecraft.website keeps serving from Netlify until the cutover.

The Worker has no long-lived process, so `wrangler.jsonc` sets `STAGECRAFT_INPROCESS_WORKER=false` and a Cron Trigger drains the job queue every minute through `POST /api/cron/jobs`. It also sets `DATABASE_DRIVER=neon`, because Prisma's default engine can't open a TCP socket on Workers. Those two are the only `vars`. Everything else is a Worker secret.

### Worker secrets

`wrangler deploy` replaces `vars` on every deploy and stores them in plain text, but leaves secrets alone. So every value below is a secret, including `AUTH_URL`, which isn't sensitive but differs between the preview and production. `apps/web/cloudflare/wrangler-config.test.ts` fails if one of these names shows up in `vars`.

| Secret | Required | What reads it |
|---|---|---|
| `DATABASE_URL` | yes | Prisma client (`packages/db`); must be a Neon URL, since the Worker uses the Neon driver. Until the preview passes the end-to-end checks, use a separate Neon database, not production's (see below) |
| `AUTH_SECRET` | yes | NextAuth session signing |
| `AUTH_URL` | yes | NextAuth, Netlify OAuth redirect, install URLs. The Worker's own origin, e.g. `https://stagecraft.<account-subdomain>.workers.dev` |
| `AUTH_GITHUB_ID` | yes | NextAuth GitHub sign-in |
| `AUTH_GITHUB_SECRET` | yes | NextAuth GitHub sign-in |
| `STAGECRAFT_STATE_SIGNING_SECRET` | yes | Signed install-URL state and Resend verification tokens |
| `NETLIFY_CLIENT_ID` | yes | Netlify OAuth |
| `NETLIFY_CLIENT_SECRET` | yes | Netlify OAuth |
| `GITHUB_APP_ID` | yes | `stagecraft-bot` GitHub App tokens |
| `GITHUB_APP_PRIVATE_KEY` | yes | `stagecraft-bot` GitHub App tokens. Multi-line, `\n`-escaped or space-flattened PEM all work |
| `GITHUB_APP_WEBHOOK_SECRET` | yes | GitHub App webhook signature check |
| `CRON_SECRET` | yes | Cron Trigger → `POST /api/cron/jobs` bearer token. Unset, every cron run fails |
| `STAGECRAFT_CREDENTIALS_KEY` | yes | Encrypts and decrypts stored integration credentials (`apps/web/src/lib/credential-crypto.ts`). Must be the same value as on Netlify whenever both read the same database. Unset, new tokens are stored in plaintext (with a warning) and encrypted ones can't be read. See [§9](#9-credential-encryption) |
| `STAGECRAFT_CREDENTIALS_OLD_KEYS` | no | Retired credential keys, decrypt only. Same value as on Netlify |
| `GITHUB_APP_INSTALLATION_ID_NETLIFY` | no | Fallback installation id when `/user/installations` can't find the Netlify app |
| `GITHUB_APP_INSTALLATION_ID_STAGECRAFT_BOT` | no | Same fallback for `stagecraft-bot` |

Resend, Netlify and Vercel API keys aren't platform secrets: each user connects their own account, and the tokens live in the database (`IntegrationAccount`), encrypted with `STAGECRAFT_CREDENTIALS_KEY`.

Sign-in on the preview only works if the GitHub OAuth App (`AUTH_GITHUB_ID`) accepts `<AUTH_URL>/api/auth/callback/github` as a callback URL, and Netlify OAuth needs `<AUTH_URL>/api/integrations/netlify/callback` registered the same way.

### Setting secrets

**Give the preview its own database until it has passed end to end.** The every-minute cron claims queued jobs from whatever `DATABASE_URL` points at, and a job whose handler throws is marked `failed` with no retry (`packages/queue/src/worker.ts`). With production's `DATABASE_URL`, the preview would share real users' `create_site` and `migrate_site` jobs with Netlify's in-process worker, on Worker code nobody has checked end to end yet, and it starts doing so as soon as the secret is set. So set `DATABASE_URL` to a separate Neon database, not the Netlify value, until sign-in, create-site and migrate-site have passed on the preview. Switching to production's database is part of the cutover (#312).

Nothing in CI migrates that database (CI's "DB migrations applied to production" job and `npm run db:migrate:prod` both target production), so apply the schema to it yourself before setting the secret, and again whenever a migration lands on main, or sign-in and the cron fail on missing tables. Use its direct (unpooled) URL, the one without `-pooler` in the host. Run the command below as one line from the repo root: after you press Enter it shows a prompt, where you paste the URL and press Enter again. Paste the URL only at that prompt, not together with the command. The URL isn't echoed or kept in shell history, and the migration runs only once `read` has a non-empty URL: an empty Enter stops instead of migrating with an empty `DATABASE_URL`, which Prisma would replace with `packages/db/.env`'s local database. The parentheses run it in a subshell, so your shell stays in the repo root and doesn't keep the URL afterwards. It works the same in bash and zsh.

```bash
(cd packages/db && printf 'Preview DATABASE_URL (direct, unpooled): ' && read -rs PREVIEW_DATABASE_URL && echo && [ -n "$PREVIEW_DATABASE_URL" ] && DATABASE_URL="$PREVIEW_DATABASE_URL" npx prisma migrate deploy)
```

From `apps/web`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exported (or after `npx wrangler login`):

```bash
# One at a time (prompts for the value, so it stays out of shell history)
npx wrangler secret put CRON_SECRET

# Or all at once from a JSON file ({"NAME": "value", ...}) or a KEY=VALUE .env file.
# Keep the file outside the repo and delete it afterwards.
npx wrangler secret bulk /path/to/worker-secrets.json

# Check which names are set (values are never shown)
npx wrangler secret list
```

Each `secret put` or `secret bulk` deploys a new version of the Worker with the change, so no redeploy is needed. If the Worker doesn't exist yet, run `npm run deploy:worker` first. Until they're set, the cron runs fail on the missing `CRON_SECRET`.

### Deploying

- **From CI:** `.github/workflows/deploy-worker.yml` runs `npm run deploy:worker` after CI passes on a push to main, or by hand from main via Actions → Deploy Worker → Run workflow. It needs the repository secrets `CLOUDFLARE_API_TOKEN` (a token with Workers Scripts: Edit on the account) and `CLOUDFLARE_ACCOUNT_ID`; without them it skips with a notice.
- **By hand:** from `apps/web`, after `npm ci` and `npm run db:generate` at the repo root, run `npm run deploy:worker` with the same two variables exported.

`npm run build:worker` builds and bundles without deploying or logging in, which is what CI runs on every PR.

---

## 9. Credential Encryption

Users' provider credentials are encrypted in the database with AES-256-GCM (ADR-005, `apps/web/src/lib/credential-crypto.ts`):

- `Account.access_token`, `refresh_token`, `id_token` (NextAuth's GitHub OAuth tokens)
- `IntegrationAccount.accessToken`, `refreshToken` (GitHub, Netlify and Vercel tokens, Resend API keys)

An encrypted value looks like `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>`. The app still reads values without that prefix as legacy plaintext, so rows written before the key was set keep working until the backfill below encrypts them.

### Generating a key

The key is a key id (letters, digits, `_` or `-`, up to 32 characters) and 32 random bytes in base64, joined by `:`. Use a new id for each key, e.g. the date:

```bash
echo "k$(date +%Y%m%d):$(openssl rand -base64 32)"
```

Store it in 1Password with the other platform secrets. Never commit it. Losing it makes every encrypted credential unreadable, and users would have to reconnect each integration.

### First rollout

1. **Set the key** as `STAGECRAFT_CREDENTIALS_KEY` on Netlify (site environment variables) and as a Worker secret (`npx wrangler secret put STAGECRAFT_CREDENTIALS_KEY`). Use the same value on both whenever they read the same database.
2. **Deploy** the code that encrypts on write (Netlify needs a redeploy to pick up a new environment variable; a Worker `secret put` deploys by itself). From now on new and refreshed tokens are written encrypted. Deploying before step 1 is safe: tokens are written in plaintext and the app logs `STAGECRAFT_CREDENTIALS_KEY is not set` once per process.
3. **Run the backfill** against each database, from the repo root, with that database's `DATABASE_URL` and the same key. Dry-run first:

   ```bash
   DATABASE_URL='<url>' STAGECRAFT_CREDENTIALS_KEY='<key>' npx tsx apps/web/scripts/encrypt-credentials.ts --dry-run
   DATABASE_URL='<url>' STAGECRAFT_CREDENTIALS_KEY='<key>' npx tsx apps/web/scripts/encrypt-credentials.ts
   ```

   It skips values that are already encrypted, so it is safe to re-run, and it refuses to run without a key. A row rewritten by a sign-in during the run is reported as a conflict and left alone (the app already encrypted it). It also test-decrypts every encrypted value. Any it can't decrypt (key not configured, or a malformed value) are listed by table, row id and column, left as they are, and make the run exit non-zero once every other row is done. Add the missing key to `STAGECRAFT_CREDENTIALS_OLD_KEYS`, or have those users reconnect, and re-run.
4. **Check** nothing is left in plaintext; both counts should be 0:

   ```sql
   SELECT count(*) FROM "IntegrationAccount"
   WHERE ("accessToken" IS NOT NULL AND "accessToken" NOT LIKE 'enc:v1:%')
      OR ("refreshToken" IS NOT NULL AND "refreshToken" NOT LIKE 'enc:v1:%');
   SELECT count(*) FROM "Account"
   WHERE (access_token IS NOT NULL AND access_token NOT LIKE 'enc:v1:%')
      OR (refresh_token IS NOT NULL AND refresh_token NOT LIKE 'enc:v1:%')
      OR (id_token IS NOT NULL AND id_token NOT LIKE 'enc:v1:%');
   ```

After step 3, don't roll the app back to a build from before encryption, or remove the key: either would send ciphertext to GitHub, Netlify, Vercel and Resend, and every integration call would fail until the key is restored.

### Rotating the key

1. Generate a new key with a new id.
2. Set `STAGECRAFT_CREDENTIALS_OLD_KEYS` to the current key (append it, comma-separated, if old keys are already listed) and `STAGECRAFT_CREDENTIALS_KEY` to the new one, on Netlify and the Worker. Deploy. New writes use the new key; values under the old key still decrypt.
3. To retire the old key, re-encrypt under the new one: run the backfill with `--rotate` (same command as above, with both variables set). Only remove the old key from `STAGECRAFT_CREDENTIALS_OLD_KEYS`, and deploy, once that run exits 0 and reports `0 undecryptable` for both tables; a non-zero exit means some values are still under a key the run couldn't use (they are listed by row).

## 10. Database Migrations

On every push to main, CI's "DB migrations applied to production" job runs `prisma migrate deploy` against production at the same time as the platform deploys. The migration usually lands first, so for a while the **old** code runs against the **new** schema. The new code can also briefly run against the old schema, and a rollback puts old code back on the new schema for good. So every migration must work with both the code before it and the code after it.

### The rule: expand, then contract

Split a breaking schema change across separate PRs, each deployed before the next merges:

1. **Expand.** Add the new shape alongside the old: a new nullable column (or `NOT NULL DEFAULT ...`), a new table, a new enum value. The old code works without it.
2. **Migrate the code.** Ship code that writes both shapes (or only the new one) and reads the new one. Backfill existing rows.
3. **Contract.** Once no deployed code reads or writes the old shape, drop it in its own PR.

| Change | Instead of | Do |
|---|---|---|
| Rename a column | `RENAME COLUMN a TO b` | add `b`, write both and read `b`, backfill, then drop `a` |
| Make a column required | `SET NOT NULL` | make every writer set it and backfill, then `SET NOT NULL` in a later PR |
| Add a required column | `ADD COLUMN x TEXT NOT NULL` | `ADD COLUMN x TEXT NOT NULL DEFAULT '...'`, or nullable first |
| Change a column's type | `ALTER COLUMN x TYPE ...` | add a column of the new type, dual-write, backfill, switch reads, drop the old one |
| Remove a table or column | `DROP` in the same PR as the code change | remove the code first, drop in a later PR |

Never edit a migration that has merged to main. Prisma checksums applied migrations, and production has already run the old text. Add a new migration instead.

### The CI check

The "Migrations are backward compatible" job in `.github/workflows/ci.yml` runs `scripts/migration-safety.mjs` on every pull request. It finds the merge base of the PR with its base branch, lists what changed under `packages/db/prisma/migrations/` since then, and fails on:

- `DROP TABLE` or `DROP COLUMN`
- `ALTER COLUMN ... TYPE` / `SET DATA TYPE`
- `SET NOT NULL`, even when the same migration backfills or sets a default first. Old code can still insert NULLs until the new code is live, so this belongs in a later contract step.
- `ADD COLUMN ... NOT NULL` without a `DEFAULT`
- `RENAME` in an `ALTER TABLE` or `ALTER TYPE` statement (tables, columns, enum types and values, and also `RENAME CONSTRAINT`, which Prisma emits when a key's name changes and which is harmless, so label that one; index renames are allowed)
- any modification, deletion or rename of an existing migration file

Only migration files the PR adds are scanned, so older migrations never fail it. Comments, string literals and quoted identifiers are ignored. Escape strings (`E'...'`) and dollar quotes (`$$`) are flagged instead, because the check can't read past them; Prisma never generates them. The check is deliberately simple and conservative: it matches text patterns, not the schema, so it can flag a change that is in fact safe (dropping a table no deployed code has used for a while), and it can't catch every unsafe one (for example `DROP DEFAULT` on a column old code relies on). Review migrations with the rule above, not just the check.

Run it locally before pushing: `git fetch origin main && npm run migrations:check`. To scan specific files: `node scripts/migration-safety.mjs packages/db/prisma/migrations/<name>/migration.sql`.

### Overriding it

When a flagged change is safe for the code running in production (typically the contract step, after the code that used the old shape has shipped), add the label `migration:destructive-ok` to the PR and say in the PR body why it's safe. Adding the label doesn't restart CI: re-run the "Migrations are backward compatible" job from the PR's Checks tab, or push a new commit. The job reads the PR's current labels, so a re-run picks up the new one.
