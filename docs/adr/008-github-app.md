# ADR-008: Stagecraft GitHub App

## Status
Accepted. Body reflects current decisions; see the Revision history at the bottom for what changed since the original draft.

## Context
ADR-007 specifies that the new musician-site template publishes content by committing to the artist's GitHub repo via a Stagecraft-owned GitHub App. The publish endpoint runs on the artist's deployed site (a serverless function on Netlify/Vercel), not on the platform. Several decisions follow from that split:

- Where do GitHub App credentials live? At the edge (each artist's site holds the App private key) or brokered from the platform?
- How does an artist's repo get the App installed in the first place?
- How are commits attributed (artist as author, App as committer)?
- What happens when an artist uninstalls the App, transfers their repo, or rotates credentials?

This ADR captures those decisions for the v1 publish flow. ADR-006 (NextAuth + GitHub OAuth on the platform) is unaffected — that governs platform login; this governs commits to artist repos.

## Decision
A single Stagecraft-wide GitHub App authorizes commits to artist repos. The App's private key lives only on the platform; artist sites obtain short-lived installation tokens from a platform-hosted **token broker** endpoint. Installation IDs per site are stored in the platform database alongside the existing `Site` record.

### 1. App identity and permissions
- Single App registered against the Stagecraft GitHub org. Name: `stagecraft` (final name TBD at registration).
- **Permissions (least-privilege):**
  - `Contents: Read & write` — required for commits and reading existing files (image dedup check).
  - `Metadata: Read` — always required for any App.
  - `Pull requests: Read & write` — **deferred**. Only needed when ADR-007's "draft branches" follow-up lands. Add via App permission update at that time; existing installations re-confirm.
- **Subscribe to events:**
  - `installation` — to detect installs/uninstalls.
  - `installation_repositories` — to detect repo additions/removals on existing installations.
  - No `push` or `repository` subscriptions for v1; the platform reacts to its own commits, not to incoming activity.

### 2. Token model: platform-hosted broker
The artist site's `/api/publish` does not hold the App private key. Instead it requests a short-lived installation token from the platform.

```
artist-site /api/publish
  → POST https://platform.stagecraft.com/api/publish-token
      Authorization: Bearer <STAGECRAFT_BROKER_SECRET>   # per-site shared secret
      { siteId }
  ← { ok: true, token, expiresAt, repo: { owner, name } }  # GitHub installation token, ~1hr lifetime
  → uses token to commit via Octokit Git Data API
  → discards token
```

- **Why broker, not at-edge:** the App private key is the master credential. Distributing it to every artist site multiplies the blast radius of any single-site compromise. The broker model keeps the master credential confined to the platform's secret manager.
- **Auth from artist site to platform:** *per-site shared secret* (`STAGECRAFT_BROKER_SECRET`) sent as `Authorization: Bearer`. The platform stores only the SHA-256 hash on the `Site` row (`brokerSecretHash`); the plaintext is shown to the artist exactly once at install time and lives only in their site's deployment env vars. Comparison is constant-time. **(Amended from earlier draft.)**
- **Tokens are not cached on the artist site.** Each publish requests a fresh token. Tokens may be cached on the platform for the remaining lifetime to reduce GitHub API calls; cache key is `installationId`.
- **Rate limiting** lives in the broker, not in the artist site — the broker is the chokepoint for all publishes.

### 3. Installation flow
- Artist signs in to the platform via GitHub OAuth (per ADR-006).
- Platform dashboard shows a "Connect repo" CTA → links to `GITHUB_APP_INSTALL_URL` with `state=<signed siteId>` (signed using the platform's session secret to prevent CSRF; expires in 10 min).
- Artist selects exactly one repo on GitHub's install screen → GitHub redirects to platform `/api/github/install-callback?state=<signed siteId>&installation_id=<id>&setup_action=install`.
- Callback validates `state` (signature + expiry), confirms the signed-in user owns the `siteId`, fetches the installation's repo via the App, and persists `githubInstallationId`, `githubRepoOwner`, and `githubRepoName` on the `Site` record.
- **Generates the broker secret** (`generateBrokerSecret()` from `apps/web/src/lib/broker-secret.ts`), stores `brokerSecretHash`, and renders a one-time "reveal" page showing the plaintext with copy-to-env-var instructions. The plaintext is **never persisted** and **never re-displayed** — losing it requires rotation.
- One installation per artist account, scoped to one or more repos. GitHub creates a single installation per account/org and grows its repository list as the artist grants access to more repos over time. The install-callback locates the **specific** repo for the current `Site` (matched on `githubRepoOwner` + `githubRepoName` set by `/create`) within the installation's repo list, rather than assuming the installation grants access to exactly one repo.

### 4. Commit author and committer
- **Committer:** `stagecraft-app[bot] <{appId}+stagecraft-app[bot]@users.noreply.github.com>` (GitHub generates the noreply email for App identities).
- **Author:** the artist's email from the magic-link session, with a chosen name (also from the platform `Site` record). This makes the artist visible in `git log` and GitHub's contribution graph (when they later associate that email with their GitHub account).
- **Commit messages** include a structured trailer: `Stagecraft-Publish-Id: <uuid>` to enable later auditing / rollback.

### 5. Credential storage and env vars

**Platform (one set, server-side):**

| Var | Purpose |
|---|---|
| `GITHUB_APP_ID` | App's numeric id, from GitHub App General page |
| `GITHUB_APP_PRIVATE_KEY` | Contents of the `.pem` private key. Escaped `\n` newlines are normalized at read time |
| `GITHUB_APP_WEBHOOK_SECRET` | Validates HMAC signatures on incoming webhook events |
| `GITHUB_APP_INSTALL_URL` | Where "Connect repo" sends the artist (e.g. `https://github.com/apps/<slug>/installations/new`) |
| `STAGECRAFT_STATE_SIGNING_SECRET` | HS256 secret used to sign the short-lived install-state JWT that round-trips through GitHub's install flow. Generate with `openssl rand -hex 32` |

**Per-artist site (one per `Site`):**

| Var | Purpose |
|---|---|
| `STAGECRAFT_PLATFORM_URL` | Base URL of the broker, e.g. `https://platform.stagecraft.com` |
| `STAGECRAFT_SITE_ID` | The `Site.id` for this deployment. Namespaced because Netlify reserves `SITE_ID` (injected automatically into Functions) |
| `STAGECRAFT_BROKER_SECRET` | The per-site secret revealed once at install. Used to authenticate to the broker |

**Storage rules:**
- App private key never leaves the platform's secret manager. Never committed.
- `Site.brokerSecretHash` stores SHA-256 of the secret; plaintext is never persisted on the platform.
- `Site.githubInstallationId`, `githubRepoOwner`, `githubRepoName` are non-secret, stored in the platform DB.
- Artist sites only ever see installation tokens (short-lived) and their own broker secret (set in their deployment env).

### 6. Webhook handling, uninstall, and revocation
The platform exposes `POST /api/github/webhook` to receive App lifecycle events.

- **Signature validation:** every incoming request's `X-Hub-Signature-256` header is verified via HMAC-SHA256 against `GITHUB_APP_WEBHOOK_SECRET` (constant-time). Invalid → 401.
- **Idempotency:** GitHub may redeliver. Store the `X-GitHub-Delivery` id and skip duplicates.
- **Events handled:**
  - `installation.created` — usually a no-op (the install_callback already wired things up); used as a sanity check.
  - `installation.suspend` → set `Site.githubAppSuspended = true`. Broker returns 423 until unsuspended.
  - `installation.unsuspend` → clear `githubAppSuspended`.
  - `installation.deleted` → null out `githubInstallationId`, `githubRepoOwner`, `githubRepoName`. Broker returns 409 ("reinstall"). Don't drop the broker secret hash — the artist may reinstall on a new repo and we'd want to allow that; rotation is a separate explicit action.
  - `installation_repositories.removed` → if the removed repo matches `Site.githubRepoName`, treat as uninstall (null out repo fields).
  - `installation_repositories.added` → log only; we don't auto-attach to new repos (one Site = one repo).

- No automatic re-install attempt; the artist must take explicit action.

### 7. Failure modes worth noting
- **Token broker down** → publish endpoint surfaces a 503 with retry-after. Artist's editor preserves drafts in `localStorage` (per ADR-007), so no work is lost.
- **GitHub API rate limit hit** → the broker returns 429; surfaced to the editor with a clear "try again in N minutes" message. Per-installation limits are 5000 req/hr, far above realistic publish volume.
- **Installation token expired mid-publish** → the artist site does not retry transparently for v1. The publish function returns failure; the editor can re-request a new token and retry. Future evolution: broker issues a refreshed token automatically.

## Rejected alternatives

- **App private key at the edge.** Each artist site holds the `.pem` and mints its own installation tokens. Simpler architecture (no broker, no per-publish round trip to platform). Rejected: distributes the master credential, multiplies blast radius. A single compromised artist site exposes the App's signing key.
- **Per-artist GitHub OAuth tokens (no App).** Use the artist's own OAuth token from platform login to commit on their behalf. Avoids the App registration entirely. Rejected: OAuth tokens don't refresh cleanly without a long-running service, scopes are coarser than App permissions, and commits would be authored as the artist's full GitHub identity in a way that's hard to revoke. Apps are the supported model for this use case.
- **Personal Access Tokens (artist-supplied).** Artist creates a PAT, pastes it into the platform. Rejected: PAT UX is hostile to non-technical artists, tokens have no install scope (full-account access), and rotation is manual.
- **Per-site GitHub Apps.** One App registered per artist. Rejected: registration is manual and multiplies operational overhead at zero security benefit — the platform still holds the keys.
- **Sync via webhook to a queue, decouple publish from commit.** Artist site posts to a queue, platform worker dequeues and commits. More resilient under platform outages but adds latency and a new component (the queue). The existing `packages/queue` could host this; deferred to a future ADR if publish failure modes become a problem.

## Consequences

- **New platform endpoints.** `/api/publish-token` (POST, token broker — landed in PR #72), `/api/github/install-callback` (GET, install completion), `/api/github/webhook` (POST, lifecycle events).
- **`Site` schema gains fields** (landed in PR #72): `githubInstallationId Int?`, `githubAppSuspended Boolean`, `brokerSecretHash String?`. (`githubRepoOwner` and `githubRepoName` already existed.)
- **Four GitHub App env vars enter the platform's environment:** `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_INSTALL_URL`.
- **Octokit becomes a platform dependency.** `@octokit/auth-app` mints installation tokens; `@octokit/rest` issues commits. Artist sites only see `@octokit/rest` configured with the broker-issued token — not the App auth flow.
- **First-time artist onboarding gains a step:** install GitHub App after platform sign-in. Platform UI needs a "Connect repo" CTA and a one-time "broker secret reveal" view.
- **Repo transfers (artist moves the repo to a new owner) require reinstall.** Documented behavior; the platform detects via `installation_repositories.removed` and prompts.

---

## Revision history

The body above reflects current decisions. Each entry below records *what changed and why* — useful when reading old PRs or wondering why the doc and an early draft disagree.

**2026-05-02, PR #72 — Cross-service broker auth.** Original §2 sketched broker auth as a "forwarded magic-link cookie." That doesn't work cross-service: the artist site signs sessions with its own `MAGIC_LINK_SIGNING_SECRET`, which the platform doesn't hold. Implementation uses a per-site shared secret (`STAGECRAFT_BROKER_SECRET`) sent as `Authorization: Bearer`; the broker compares its SHA-256 to `Site.brokerSecretHash` in constant time.

**2026-05-02, PR #72 — Schema field naming.** Original ADR used `repoFullName: string | null`. Implementation reuses the existing `githubRepoOwner` and `githubRepoName` columns instead (they predate this ADR and capture the same data).

**2026-05-02, PR #75 — Install-state signing secret.** Original §3 said the install state is "signed using the platform's session secret." Implementation uses a dedicated `STAGECRAFT_STATE_SIGNING_SECRET` (HS256) so install-state signing is decoupled from session signing — rotating one doesn't force the other. Added to the §5 env-vars table.

**2026-05-03, PR #86 — Installation scope corrected.** Original §3 read "one installation per repo." GitHub Apps actually install **per account/org**, and the installation's repo list grows as the artist grants access to more repos. The install-callback now locates the current Site's repo (matched on existing `githubRepoOwner` + `githubRepoName` from `/create`) within the installation's list, rather than rejecting installs that span multiple repos. Caught when an artist with multiple Stagecraft sites tried to connect their 8th and the install-callback failed with "Multiple repositories selected".

**2026-05-03, PR #87 — Per-site env-var renamed.** Original §5 listed the artist-side env var as `SITE_ID`. Netlify reserves that name (auto-injects its own Netlify-side site id into Functions under `SITE_ID`), so the platform's broker-side site id is now `STAGECRAFT_SITE_ID`. Template, broker consumer, and install-callback's reveal page all use the namespaced name.

**2026-05-03, PR #88 — `/create` is synchronous, not queued.** Tangential but relevant: the worker pattern from `@stagecraft/queue` doesn't survive on Netlify Functions (Lambda freezes the container when the HTTP handler returns; any pending awaits in a "background" job get abandoned and the SiteJob stays `running` forever). `POST /api/sites` now awaits `handleCreateSite` directly. The install-callback flow described here is unchanged — it was already synchronous within an HTTP request.

**2026-05-03, PR #90 — `findGithubAppInstallation` helper.** Stand-alone helper in `integrations/github.ts` that calls `GET /user/installations` (the user's own GitHub OAuth token) and filters by `app_slug` + `account.login` to find any App's installation id. Used for Stagecraft's App (where the install-callback already had it from the OAuth round-trip) and for the deploy-target App (Netlify) where the provider's own API doesn't expose installation discovery.
