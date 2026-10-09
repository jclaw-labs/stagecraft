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
                     └──►  failed
                     └──►  awaiting_review
```

The worker polls the `SiteJob` table every 5 seconds for the oldest `queued` job and processes it. All state transitions are reflected in the database immediately.

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

### Optional env vars

| Variable | Description |
|---|---|
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

**Cause:** The worker process crashed while a job was in flight.

**Diagnosis:**
```sql
SELECT id, type, status, "startedAt", "createdAt"
FROM "SiteJob"
WHERE status = 'running'
ORDER BY "startedAt";
```

**Recovery:** Reset the job to `queued` so the worker picks it up again:
```sql
UPDATE "SiteJob"
SET status = 'queued', "startedAt" = NULL
WHERE id = '<job-id>';
```

---

### 4.3 Job repeatedly failing

**Symptom:** A `SiteJob` row has `status = "failed"` and `errorMessage` indicates a transient or external error.

**Diagnosis:**
```sql
SELECT id, type, "errorMessage", "createdAt", "completedAt"
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
  "errorMessage" = NULL
WHERE id = '<job-id>';
```

The worker will pick it up within 5 seconds. To process it right away (or when the in-process poller is off), drain the queue by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/jobs
# → {"ok":true,"processed":1}
```

### Re-enqueue all recently failed jobs for a site

```sql
UPDATE "SiteJob"
SET status = 'queued', "startedAt" = NULL, "completedAt" = NULL, "errorMessage" = NULL
WHERE "siteId" = '<site-id>'
  AND status = 'failed'
  AND "createdAt" > NOW() - INTERVAL '1 day';
```

### Cancel a stuck job

```sql
UPDATE "SiteJob"
SET status = 'canceled', "completedAt" = NOW()
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
| `GITHUB_APP_INSTALLATION_ID_NETLIFY` | no | Fallback installation id when `/user/installations` can't find the Netlify app |
| `GITHUB_APP_INSTALLATION_ID_STAGECRAFT_BOT` | no | Same fallback for `stagecraft-bot` |

Resend, Netlify and Vercel API keys aren't platform secrets: each user connects their own account, and the tokens live in the database (`IntegrationAccount`).

Sign-in on the preview only works if the GitHub OAuth App (`AUTH_GITHUB_ID`) accepts `<AUTH_URL>/api/auth/callback/github` as a callback URL, and Netlify OAuth needs `<AUTH_URL>/api/integrations/netlify/callback` registered the same way.

### Setting secrets

**Give the preview its own database until it has passed end to end.** The every-minute cron claims queued jobs from whatever `DATABASE_URL` points at, and a job whose handler throws is marked `failed` with no retry (`packages/queue/src/worker.ts`). With production's `DATABASE_URL`, the preview would share real users' `create_site` and `migrate_site` jobs with Netlify's in-process worker, on Worker code nobody has checked end to end yet, and it starts doing so as soon as the secret is set. So set `DATABASE_URL` to a separate Neon database, not the Netlify value, until sign-in, create-site and migrate-site have passed on the preview. Switching to production's database is part of the cutover (#312).

Nothing in CI migrates that database (CI's "DB migrations applied to production" job and `npm run db:migrate:prod` both target production), so apply the schema to it yourself before setting the secret, and again whenever a migration lands on main, or sign-in and the cron fail on missing tables. Use its direct (unpooled) URL, the one without `-pooler` in the host. Run the command below as one line from the repo root: after you press Enter it shows a prompt, where you paste the URL and press Enter again. Paste the URL only at that prompt, not together with the command. The URL isn't echoed or kept in shell history, and the migration runs only once `read` has a non-empty URL: an empty Enter stops instead of migrating with an empty `DATABASE_URL`, which Prisma would replace with `packages/db/.env`'s local database. The parentheses run it in a subshell, so your shell stays in the repo root and doesn't keep the URL afterwards.

```bash
(cd packages/db && read -rsp 'Preview DATABASE_URL (direct, unpooled): ' PREVIEW_DATABASE_URL && echo && [ -n "$PREVIEW_DATABASE_URL" ] && DATABASE_URL="$PREVIEW_DATABASE_URL" npx prisma migrate deploy)
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
