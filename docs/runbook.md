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

A claimed job carries a lease (`lockedUntil`, 5 minutes) that the worker renews every minute while the handler runs. A handler that throws is retried up to 2 times (`retryAttempts`), 30s then 60s later; the third failure marks the job `failed` with the last error. `create_site` and `migrate_site` share their provisioning steps (`apps/web/src/lib/jobs/provision-site.ts`): a transient error is thrown and retried, and a re-run resumes at the step that failed. A missing precondition (no verified email, deploy target or Resend; a source site with no pages; a repo name already taken) fails the job on the first run. See [4.2](#42-job-stuck-in-running) for what happens when a worker dies mid-job.

`create_site` (queued by `POST /api/sites`) runs as named steps: `createRepo`, `pushTemplate`, `findInstallation`, `mintBrokerSecret`, `createHostProject`, `setEnv`. Each step's state and result are recorded under `resultPayload.steps` as it runs, so a retried run, a run after an expired lease, or a manual retry skips the finished steps and resumes at the first unfinished one. Transient errors are thrown for the worker to retry; the site stays `creating` meanwhile. Once retries are spent, or for a missing precondition (no verified email, no deploy target or Resend connected, repo name taken), the site goes to `error` and the job to `failed`. The site page then offers **Retry setup**, which calls `POST /api/sites/<id>/retry` to re-queue the same job with its progress. A retry adopts a repo, Netlify site or Vercel project with the expected name only when it was created after the step's first attempt started (2 minutes of clock skew allowed). So if the job failed on "repo name taken", or refuses a resource it made itself because of a larger clock skew, delete or rename the existing one before retrying. When Vercel's GitHub App is missing, the job fails with `failureCategory = 'vercel_github_app_missing'` and keeps the repo, and the site page links to the App install before the retry.

`migrate_site` (queued by `POST /api/migrations`) runs a `crawlSource` step, which stores the crawled content, and then the same steps, pushing that content over the template. Its retries and failures work the same way, but **Retry setup** and its route only re-queue `create_site` jobs today.

On hosts with the in-process poller (Netlify), `POST /api/sites`, the retry route and `POST /api/migrations` also run one queued job right after their response (Next's `after()`), since a function frozen after its response can't be relied on to poll.

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
| `STAGECRAFT_CREDENTIALS_KEY` | Current key for encrypting stored integration credentials, as `<keyId>:<base64 of 32 bytes>`. Unset in production, sign-in and the connect flows fail rather than store tokens in plaintext; unset elsewhere, tokens are stored in plaintext with a warning once per process (see `STAGECRAFT_CREDENTIALS_REQUIRED`). Generating it and the rollout order are in [§9](#9-credential-encryption). |

### Optional env vars

| Variable | Description |
|---|---|
| `STAGECRAFT_CREDENTIALS_OLD_KEYS` | Retired credential keys, comma-separated, same format as `STAGECRAFT_CREDENTIALS_KEY`. Used only to decrypt values written before a rotation ([§9](#9-credential-encryption)). |
| `STAGECRAFT_CREDENTIALS_REQUIRED` | `true` or `false`. Whether a missing `STAGECRAFT_CREDENTIALS_KEY` makes credential writes fail instead of storing plaintext. Unset, it is on when `NODE_ENV=production` and off otherwise. Set `false` only for a deliberate deploy before the key exists ([§9](#when-the-key-is-missing)). |
| `STAGECRAFT_CREDENTIALS_ACCEPT_V1` | `true` or `false`. Whether legacy, row-unbound `enc:v1:` credentials still decrypt. Unset or empty means `true`, and `true` / `false` are read in any case; any other value is a configuration error: the app's v1 reads fail with it, and the backfill stops before scanning. Set `false` once the backfill has left no v1 values, on both hosts ([§9](#first-rollout), step 5). |
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

If the old worker turns out to be alive after all (a frozen invocation that thaws), its late result is discarded: post-claim writes only apply while the row is still `running` with the `startedAt` that worker stamped. It logs `job.lease_lost`. A `job.lease_lost` whose `error` says an earlier attempt may have landed is different: the worker's result write failed, was retried, and the retry matched no row. Usually the first attempt committed and only its response was lost, so check the row before acting; if it is `completed` or `failed` with this run's result, nothing was lost. The lost write can also be a re-queue (a retry or a repair pass), and then the row is `queued` again or already re-claimed by a later run. Tell the two cases apart by `errorMessage`: if it isn't `Lease expired: …`, this run's re-queue landed; if it is, the lease really was lost and the reaper re-queued the job. Either way the job runs again and nothing needs doing.

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

`"retryAttempts"` counts automatic re-runs. A job gets at most 2 automatic re-runs in total, shared between two causes: a handler that throws is re-queued with backoff (30s, then 60s), and a job whose lease expired is re-queued by the reaper to run immediately. A failed `create_site` or `migrate_site` row with `"retryAttempts" = 0` failed on something retrying can't fix: a missing precondition, or Vercel's GitHub App not installed. Its `"resultPayload"->'steps'` shows which steps finished.

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

`accessToken` is stored encrypted (it starts with `enc:v2:`, or `enc:v1:` if the backfill hasn't upgraded it yet; see [§9](#9-credential-encryption)), so the column value is not the token. Decrypt it with `decryptCredential` from `apps/web/src/lib/credential-crypto.ts`, the deployed key and the row it came from (`integrationCredentialField('<user-id>', 'github')`; a v2 value only decrypts for its own row), or have the user reconnect. With the plaintext token:

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
| `STAGECRAFT_CREDENTIALS_KEY` | yes | Encrypts and decrypts stored integration credentials (`apps/web/src/lib/credential-crypto.ts`). Must be the same value as on Netlify whenever both read the same database. Unset, sign-in and the connect flows fail (the Worker runs with `NODE_ENV=production`) and encrypted tokens can't be read. See [§9](#9-credential-encryption) |
| `STAGECRAFT_CREDENTIALS_OLD_KEYS` | no | Retired credential keys, decrypt only. Same value as on Netlify ([§9](#rotating-the-key)) |
| `STAGECRAFT_CREDENTIALS_REQUIRED` | no | `false` lets writes store plaintext with no key set. Leave unset ([§9](#when-the-key-is-missing)) |
| `STAGECRAFT_CREDENTIALS_ACCEPT_V1` | no | `false` refuses legacy, row-unbound `enc:v1:` credentials. Set once the backfill has left none, same value as on Netlify ([§9](#first-rollout), step 5) |
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

The app writes encrypted values as `enc:v2:<keyId>:<iv>:<tag>:<ciphertext>`. A v2 value is bound to the row and column it was written for (`Account` by provider and provider account id, `IntegrationAccount` by user id and provider), so a value copied into another user's row, another provider's row or another column fails to decrypt instead of handing that user someone else's token.

The app also still reads:

- `enc:v1:` values, written before v2 existed. They decrypt as before but aren't bound to a row, so a v1 value copied into another row (from the live database, a dump, or the database's history) decrypts there too. The backfill below upgrades them to v2 when run with `--upgrade-v1`, and setting `STAGECRAFT_CREDENTIALS_ACCEPT_V1=false` afterwards makes the app refuse v1 values ([step 5](#first-rollout)). Only from then on is every stored credential bound to its row.
- Values with no `enc:` prefix, as legacy plaintext, so rows written before the key was set keep working until the backfill encrypts them.

A value with any other `enc:` version is refused, never treated as plaintext.

Both Netlify and the Cloudflare Worker ([§8](#8-cloudflare-worker)) run this same code from `apps/web`, so everything below applies to both hosts.

### Generating a key

The key is a key id (letters, digits, `_` or `-`, up to 32 characters) and 32 random bytes in standard base64 (44 characters ending in `=`), joined by `:`. Use a new id for each key, e.g. the date:

```bash
echo "k$(date +%Y%m%d):$(openssl rand -base64 32)"
```

The app parses keys strictly, `STAGECRAFT_CREDENTIALS_KEY` and every entry in `STAGECRAFT_CREDENTIALS_OLD_KEYS` alike: anything other than exactly that shape (a stray or base64url character, missing padding, a wrong length) fails every credential read and write with an error naming the variable and key id, never the key. A mangled paste can't silently decode to a different key.

Store it in 1Password with the other platform secrets. Never commit it. Losing it makes every encrypted credential unreadable, and users would have to reconnect each integration.

### When the key is missing

With `STAGECRAFT_CREDENTIALS_KEY` unset, what a credential write does depends on `STAGECRAFT_CREDENTIALS_REQUIRED`:

| `STAGECRAFT_CREDENTIALS_REQUIRED` | No key set: a write... |
|---|---|
| unset or empty, and `NODE_ENV=production` (every Netlify and Worker deploy) | fails. Sign-in and the connect flows error instead of storing a token in plaintext |
| unset or empty, any other `NODE_ENV` (local dev, tests) | stores plaintext and logs `STAGECRAFT_CREDENTIALS_KEY is not set` once per process |
| `true` | fails |
| `false` | stores plaintext with the warning, even in production. Only for a deliberate first deploy before the key exists; remove it once the key is set |
| anything else | fails (a typo can't turn the check off) |

Separately, setting `STAGECRAFT_CREDENTIALS_OLD_KEYS` without `STAGECRAFT_CREDENTIALS_KEY` always fails writes, whatever the flag says: that is a rotation done halfway, not a host that hasn't been given a key yet.

Reads don't depend on any of this: legacy plaintext rows read with or without a key, and encrypted ones need their key.

### Checking a key's shape

Before deploying a build from issue #370 or later with an existing key, check that the key, and every entry of `STAGECRAFT_CREDENTIALS_OLD_KEYS`, has the strict shape above. The v1-only build (issue #354) accepted any encoding that decoded to 32 bytes, such as base64url or base64 without the trailing `=`; this build rejects those, and a rejected key fails every encrypted credential read and write on that host. Read the deployed values (from 1Password) at a hidden prompt, as in [Setting the variables for the backfill](#setting-the-variables-for-the-backfill), then, from the repo root with this build checked out, run the app's own key parser on them:

```bash
npx tsx -e 'import("./apps/web/src/lib/credential-crypto.ts").then((m) => m.currentCredentialKeyId()).then((id) => { if (!id) throw new Error("STAGECRAFT_CREDENTIALS_KEY is not set"); console.log("ok"); }).catch((e) => { console.error(e.message); process.exit(1); })'
```

It checks `STAGECRAFT_CREDENTIALS_KEY` and every entry of `STAGECRAFT_CREDENTIALS_OLD_KEYS` exactly as the app will, including that the base64 is canonical and that no key id appears twice, and its error names the variable and key id, never the key. If it doesn't print `ok`, re-encode the same 32 bytes as standard base64 under the same key id. The bytes don't change, so values already encrypted under it still decrypt. Read the key to re-encode (the current key, or one entry of `STAGECRAFT_CREDENTIALS_OLD_KEYS` on its own) into a separate variable, so the exported `STAGECRAFT_CREDENTIALS_KEY` and `STAGECRAFT_CREDENTIALS_OLD_KEYS` stay as they were and the check above still means what it says when you re-run it:

```bash
printf 'Key to re-encode: ' && read -rs KEY_TO_REENCODE && echo
KEY_TO_REENCODE="$KEY_TO_REENCODE" node -e 'const s=process.env.KEY_TO_REENCODE.trim();const i=s.indexOf(":");const b=Buffer.from(s.slice(i+1),"base64");if(i<1||b.length!==32){console.error("not <id>:<32 bytes>");process.exit(1)}console.log(s.slice(0,i)+":"+b.toString("base64"))'
unset KEY_TO_REENCODE
```

Put the printed value in 1Password and set it on both hosts in place of the old one (with the build that is already deployed, which reads either form). Then re-run the check on the values the hosts now have before deploying this build. To check them without overwriting your shell's variables, do it in a subshell, which reads them at hidden prompts and discards them when it exits:

```bash
(
  printf 'STAGECRAFT_CREDENTIALS_KEY: ' && read -rs STAGECRAFT_CREDENTIALS_KEY && echo && export STAGECRAFT_CREDENTIALS_KEY
  printf 'STAGECRAFT_CREDENTIALS_OLD_KEYS (Enter if none): ' && read -rs STAGECRAFT_CREDENTIALS_OLD_KEYS && echo && export STAGECRAFT_CREDENTIALS_OLD_KEYS
  npx tsx -e 'import("./apps/web/src/lib/credential-crypto.ts").then((m) => m.currentCredentialKeyId()).then((id) => { if (!id) throw new Error("STAGECRAFT_CREDENTIALS_KEY is not set"); console.log("ok"); }).catch((e) => { console.error(e.message); process.exit(1); })'
)
```

### Setting the variables for the backfill

The backfill script reads `DATABASE_URL`, `STAGECRAFT_CREDENTIALS_KEY`, (during a rotation) `STAGECRAFT_CREDENTIALS_OLD_KEYS` and (after [step 5](#first-rollout)) `STAGECRAFT_CREDENTIALS_ACCEPT_V1` from the environment. Don't type them into the command line, where they land in shell history and the process list. In a shell at the repo root, read each one from a hidden prompt and export it; paste the value only at the prompt, then press Enter:

```bash
printf 'DATABASE_URL: ' && read -rs DATABASE_URL && echo && export DATABASE_URL
printf 'STAGECRAFT_CREDENTIALS_KEY: ' && read -rs STAGECRAFT_CREDENTIALS_KEY && echo && export STAGECRAFT_CREDENTIALS_KEY
# Only when old keys are configured on the hosts:
printf 'STAGECRAFT_CREDENTIALS_OLD_KEYS: ' && read -rs STAGECRAFT_CREDENTIALS_OLD_KEYS && echo && export STAGECRAFT_CREDENTIALS_OLD_KEYS
# Once step 5 is done, the value the hosts use (not a secret):
export STAGECRAFT_CREDENTIALS_ACCEPT_V1=false
```

Check that `[ -n "$DATABASE_URL" ] && [ -n "$STAGECRAFT_CREDENTIALS_KEY" ] && echo ok` prints `ok` before going on: an empty `DATABASE_URL` lets Prisma fall back to `packages/db/.env`'s local database. When done, `unset DATABASE_URL STAGECRAFT_CREDENTIALS_KEY STAGECRAFT_CREDENTIALS_OLD_KEYS STAGECRAFT_CREDENTIALS_ACCEPT_V1` (or close the shell).

Alternatively, keep them in a file outside the repo created with `umask 077` (or `chmod 600` it), `set -a && . /path/to/file && set +a`, and delete the file afterwards.

### First rollout

1. **Set the key** as `STAGECRAFT_CREDENTIALS_KEY` on Netlify (site environment variables) and as a Worker secret (`npx wrangler secret put STAGECRAFT_CREDENTIALS_KEY`, which prompts for the value). Use the same value on both whenever they read the same database.
2. **Deploy** the code that encrypts on write (Netlify needs a redeploy to pick up a new environment variable; a Worker `secret put` deploys by itself). From now on new and refreshed tokens are written as v2.

   Do step 1 first. In production a deploy without the key refuses to store tokens, so sign-in and the connect flows fail until it is set (see [When the key is missing](#when-the-key-is-missing)). If you really have to deploy to a host before its key exists, set `STAGECRAFT_CREDENTIALS_REQUIRED=false` there first: tokens are then stored in plaintext with a warning, as before. Set the key, remove the flag, redeploy, and run the backfill.
3. **Run the backfill** against each database, from the repo root, with that database's `DATABASE_URL` and the same key exported as in [Setting the variables for the backfill](#setting-the-variables-for-the-backfill). Dry-run first:

   ```bash
   npx tsx apps/web/scripts/encrypt-credentials.ts --dry-run
   npx tsx apps/web/scripts/encrypt-credentials.ts
   ```

   It encrypts plaintext values as v2 and leaves v2 values alone. Only with `--upgrade-v1`, which is for [Upgrading from v1](#upgrading-from-v1) alone, does it upgrade `enc:v1:` values to v2 (decrypting with whichever configured key they were written under, re-encrypting under the current one); without it, it lists each v1 value as `legacy v1 value, left as is`, leaves it, counts it under `v1 left as is` (not `undecryptable`: its key is fine) and exits non-zero. That line is not a prompt to re-run with the flag: whether to pass it depends only on where you are in the rollout. A v1 value decrypts in any row, so upgrading one binds it to whatever row it sits in: only pass the flag before step 5. A second run finds nothing to do, so it is safe to re-run, and it refuses to run without a key. A row rewritten by a sign-in during the run is reported as a conflict and left alone (the app already encrypted it). It also test-decrypts every encrypted value. Any it can't decrypt (key not configured, a malformed value, or a v2 value sitting in a row it wasn't written for) are listed by table, row id and column, left as they are, and make the run exit non-zero once every other row is done. So does an `IntegrationAccount` row whose `provider` isn't one the app knows. Add the missing key to `STAGECRAFT_CREDENTIALS_OLD_KEYS`, or have those users reconnect, and re-run.
4. **Check** nothing is left in plaintext or v1; both counts should be 0:

   ```sql
   SELECT count(*) FROM "IntegrationAccount"
   WHERE ("accessToken" IS NOT NULL AND "accessToken" NOT LIKE 'enc:v2:%')
      OR ("refreshToken" IS NOT NULL AND "refreshToken" NOT LIKE 'enc:v2:%');
   SELECT count(*) FROM "Account"
   WHERE (access_token IS NOT NULL AND access_token NOT LIKE 'enc:v2:%')
      OR (refresh_token IS NOT NULL AND refresh_token NOT LIKE 'enc:v2:%')
      OR (id_token IS NOT NULL AND id_token NOT LIKE 'enc:v2:%');
   ```

5. **Stop accepting v1.** Once both counts are 0 on every database the hosts read, set `STAGECRAFT_CREDENTIALS_ACCEPT_V1=false` on Netlify (site environment variables, then redeploy) and as a Worker secret (`npx wrangler secret put STAGECRAFT_CREDENTIALS_ACCEPT_V1`, [§8](#worker-secrets)). From then on the app refuses `enc:v1:` values, so an old v1 ciphertext pasted into a row no longer decrypts, and the row binding covers every stored credential. Unset (the default) or `true` keeps accepting them; any other value refuses them. A v1 value that turns up later (a restore from an older backup, say) fails to read with an error naming the flag, and the backfill lists it as `legacy v1 value, left as is`, counts it under `v1 left as is` and leaves it: have that user reconnect. Never pass `--upgrade-v1` after this step, whatever the backfill's output says.

   Until this step, the binding protects only values written as v2. Someone with database write access could have copied a v1 value into their own row before the backfill ran, and the backfill would then have re-encrypted that copy as v2 bound to their row. If database write access may have been exposed before step 5, have users reconnect their integrations, or revoke and reissue the tokens with the providers, so the stored tokens are new ones.

After step 3, don't remove the key or roll the app back to a build from before encryption: either would send ciphertext to GitHub, Netlify, Vercel and Resend, and every integration call would fail until the key is restored. Once any v2 value exists, don't roll back to a build that only knows v1 (from before issue #370) either; it takes `enc:v2:` values for plaintext and sends them to the provider.

#### Upgrading from v1

If the v1-only build (issue #354) is already deployed with a key, the key id and bytes stay as they are, but [check its shape](#checking-a-keys-shape) first and re-encode it if the check fails: otherwise this build rejects it and every credential read and write fails on both hosts. Then deploy this build to both hosts (new writes become v2 straight away, and v1 values keep reading), run steps 3 and 4 to upgrade the stored v1 values, passing `--upgrade-v1` to both backfill commands in step 3, and finish with step 5.

**Mind the deploy timing across hosts.** A host still running the #354 build doesn't know `enc:v2:`: it takes a v2 value for plaintext and sends the ciphertext to GitHub, Netlify, Vercel or Resend as the bearer token, so that integration call fails. From the moment the first host runs this build, every sign-in and connect writes v2, so every host that reads that database has to be on this build too. Three ways to end up with a #354 build reading v2 values:

- **A staggered deploy.** When Netlify and the Worker read the same database, deploy this build to both back to back, and run the backfill only once both are on it. Between the two deploys, tokens the new host writes fail on the old one; the gap closes when the second deploy lands.
- **A Netlify instant rollback.** Publishing an older deploy from the Deploys list puts that build live without rebuilding it. Once this build has written any v2 value, never roll back to a #354 deploy (or anything older); fix forward instead. The same goes for a Worker rollback (`wrangler rollback`) when it reads that database.
- **A preview deploy against the production database.** A preview built from an older branch runs that branch's build, so if it gets production's `DATABASE_URL` and key it reads and writes production's credentials with code that may not know v2. Before the first deploy of this build, check it on the production Netlify site: under Site configuration → Environment variables, open `DATABASE_URL` and `STAGECRAFT_CREDENTIALS_KEY` and confirm that each is scoped to the Production deploy context only, with no value for Deploy Previews or Branch deploys. If either has a value for those contexts, change that first. A Netlify Deploy Preview or Branch deploy, or a Worker preview version (`wrangler versions upload`, preview URLs), must never point at the production database. The Worker's own deploy reads production's database only once the #312 cutover switches it there ([§8](#setting-secrets)); until then it uses its separate database.

### Rotating the key

Netlify and the Cloudflare Worker share one database but are deployed separately, so for a while one host can be running with the new key and the other with the old one. Whatever one host writes, the other must be able to read. Either do the rotation in two deploys, as below, or change both hosts' variables and deploy both close together, accepting that a token written by one host fails on the other until the second deploy lands. The two-step version has no such gap:

1. **Generate** a new key with a new id.
2. **Make the new key readable everywhere, then promote it.**
   1. Append the new key to `STAGECRAFT_CREDENTIALS_OLD_KEYS` (comma-separated) on Netlify *and* the Worker, leaving `STAGECRAFT_CREDENTIALS_KEY` unchanged. Deploy both. Nothing writes with the new key yet, but both hosts can now decrypt it.
   2. On both hosts, set `STAGECRAFT_CREDENTIALS_KEY` to the new key, and in `STAGECRAFT_CREDENTIALS_OLD_KEYS` replace the new key with the old current one (a key id may appear only once across the two variables). Deploy both. Whichever host deploys first writes with the new key, and the other can already read it.
3. **Retire the old key** by re-encrypting under the new one: run the backfill with `--rotate`, with both variables exported as above. Besides encrypting plaintext as in the first rollout, it re-encrypts v2 values under any old key with the current one. Don't pass `--upgrade-v1`: a v1 value at this point is one the first rollout didn't produce, so the run lists it under `v1 left as is` instead of binding it to the row it was found in (have that user reconnect). Only remove the old key from `STAGECRAFT_CREDENTIALS_OLD_KEYS` on both hosts, and deploy, once that run exits 0 and reports `0 v1 left as is, 0 undecryptable` for both tables; a non-zero exit lists, by row, what is left: values still under a key the run couldn't use (`undecryptable`), v1 values to have reconnected (`v1 left as is`), or rows with an unknown provider (`unbindable`). Each table's summary line counts every kind; the run's final error names only the first kind it finds (in that order), so read the summary lines, not just the error, to see everything that is left.

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
