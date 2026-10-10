# ADR-005: External Integration Strategy

## Status
Accepted

## Context
The platform integrates with GitHub (repos, branches, PRs), Netlify (hosting, previews), Anthropic Claude (AI edits), and Resend (email delivery). Each integration needs auth management and API interaction patterns.

## Decision

### GitHub: OAuth App for v1, GitHub App later
- Start with GitHub OAuth for user authentication and repo access
- OAuth provides simpler setup for v1 and sufficient permissions for repo creation, branching, PR management
- Migrate to a GitHub App when fine-grained installation permissions become important

### Netlify: OAuth + API
- Use Netlify OAuth to connect user accounts
- Use Netlify API for site creation, deploy status, and environment variable management
- Deploy previews are automatic via Netlify's GitHub integration once repos are connected

### AI Provider: Direct Anthropic API
- Platform calls the Anthropic API directly with platform-owned API keys
- Users do not need their own Claude subscription
- Structured prompts with repo context, CLAUDE.md instructions, and task classification

### Email: Resend API
- Generated sites use Netlify Functions to call Resend for contact form delivery
- Platform manages Resend API key injection into site environment variables

## Consequences
- Integration tokens are stored in the platform database via `IntegrationAccount` (and NextAuth's `Account`), encrypted at the application layer (see the 2026-10-09 revision below)
- Each integration has a service module in the platform codebase
- GitHub and Netlify connections are per-user and validated on each operation
- AI calls are platform-managed, providing observability and retry control

---

## Revision history

**2026-05-03, PR #90 — Vercel as a parallel deploy target.** Smoke testing surfaced friction with Netlify's API for programmatic site creation: there's no public endpoint that exposes the user's Netlify GitHub App `installation_id`, so `createSite`'s repo-linking call falls back to deploy-key (SSH) mode and fails with `Host key verification failed` on the first build. Vercel's API auto-resolves repo linking server-side (`POST /v9/projects` with `gitRepository: { type: "github", repo: "owner/name" }` is enough — no installation_id plumbing).

Added Vercel as an additive parallel target, not a replacement. Schema gains `Site.deployTarget` (defaults to `"netlify"` for existing rows) plus Vercel-specific fields (`vercelProjectId`, `vercelProjectName`, `vercelTeamId`). `/create` picks based on which integration the artist has connected; Vercel preferred when both are. Vercel auth is via Personal Access Token (their first-party Integration model is heavier; PAT is the lighter on-ramp and can be upgraded later).

Netlify's path also got fixed in the same PR — `findGithubAppInstallation(userId, "netlify", repoOwner)` now discovers the installation_id via GitHub's `/user/installations` (using the user's GitHub OAuth token we already have) and threads it into the Netlify create call. Both targets now work cleanly out of the box.

**2026-10-09, issue #354 — Credentials actually encrypted at rest.** The Consequences above said tokens were stored encrypted, but they weren't: GitHub OAuth tokens (with `delete_repo` scope), Netlify and Vercel tokens and Resend API keys sat in plaintext. They are now encrypted at the application layer:

- **What:** `Account.access_token` / `refresh_token` / `id_token` and `IntegrationAccount.accessToken` / `refreshToken`.
- **How:** AES-256-GCM via WebCrypto, which runs on both Node (Netlify) and Cloudflare Workers (`apps/web/src/lib/credential-crypto.ts`). Each value is stored as `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>`; the version and key id are bound into the GCM additional data.
- **Keys:** `STAGECRAFT_CREDENTIALS_KEY` is the current key (`<keyId>:<base64 32 bytes>`); `STAGECRAFT_CREDENTIALS_OLD_KEYS` lists retired keys that only decrypt, so keys rotate without a flag day. A single platform key held as a host secret, not a KMS-wrapped per-row data key: no KMS is in use, and the key id prefix leaves room to move to one later.
- **Write sites:** the NextAuth adapter's `linkAccount` (wrapped by `withEncryptedAccountTokens`), the `signIn` event's GitHub `IntegrationAccount` upsert, the Netlify OAuth callback, and the Vercel and Resend connect routes.
- **Read sites:** the token getters in `lib/integrations/{github,netlify,vercel,resend}.ts`, the only code that reads a stored token. Nothing reads tokens back from `Account`.
- **Rollout:** reads accept legacy plaintext (no prefix). With no key set, writes store plaintext and log one warning, so a deploy that lands before the secret doesn't break sign-in. `apps/web/scripts/encrypt-credentials.ts` backfills existing rows; it is idempotent, also re-encrypts under a new key with `--rotate`, and lists any stored value it can't decrypt by row and exits non-zero rather than stopping at the first one. Operator steps are in `docs/runbook.md` §9.

**2026-10-09, issue #370 — Ciphertexts bound to their row; a missing key is fatal in production.** Follow-ups to the revision above:

- **Row binding (`enc:v2`):** v1's additional data was only `enc:v1:<keyId>`, so anyone able to write the database could copy one user's ciphertext into another user's row and have the app decrypt it as theirs. New writes use `enc:v2:<keyId>:<iv>:<tag>:<ciphertext>`, whose additional data is `enc:v2:<keyId>:` followed by the JSON array `["IntegrationAccount", userId, provider, column]` or `["Account", provider, providerAccountId, column]`: the table, the row's unique key and the column. Every read and write site passes that `CredentialField` (typed: `IntegrationProvider` and a union of the token column names). v1 values may already be in production, so v1's meaning is unchanged: they still decrypt, unbound, until `STAGECRAFT_CREDENTIALS_ACCEPT_V1=false` (`true` / `false`, unset means `true`) makes reads refuse them, which the runbook sets once the backfill has left no v1 values. Until then the binding covers only values written as v2: a v1 value (from the live database, a dump or the database's history) copied into another row still decrypts there, and a backfill run with `--upgrade-v1` would re-encrypt such a copy as v2 bound to the row it was copied into. The backfill encrypts plaintext as v2 and leaves v2 values under the current key alone. It upgrades v1 values to v2 only with `--upgrade-v1`, which the runbook passes only in the upgrade before the cut-off: the cut-off flag lives on the hosts, and the operator's shell may not set it, so a later run (a `--rotate`, a re-run) must not re-bind a pasted v1 copy by default. A value with an unknown `enc:` version is refused, never passed through as plaintext.
- **What the row binding doesn't cover (issue #382):** it stops credentials being mixed across accounts: a ciphertext moved into another user's row, another provider's row or another column fails to decrypt instead of handing one user another's token. It is not a defence against someone who can write the database. Sessions are NextAuth database sessions (the Prisma adapter, no JWT strategy), so such a writer can insert a `Session` row for the victim's `userId` with a `sessionToken` of their choosing, send that token as the session cookie, and be signed in as the victim. The app then decrypts the victim's credentials in the victim's own rows, where the binding holds, and calls the providers with them on the attacker's behalf. Database write access stays equivalent to account takeover; keeping it to the app and the operators is what protects credentials against that, not the encryption. Against read-only exposure without the key (a leaked dump or backup, a read replica), the encryption keeps the raw provider tokens from being lifted out and used outside the app. It doesn't stop their use through the app: `Session.sessionToken` is stored in plaintext, so a copy recent enough to hold unexpired `Session` rows lets its reader send one as the session cookie and be signed in as that user, with the app decrypting that user's credentials for them. Treat a leaked recent dump as a session compromise too (delete the `Session` rows); an old enough backup, whose sessions have all expired, exposes only ciphertext.
- **Missing key:** `STAGECRAFT_CREDENTIALS_REQUIRED` (`true` / `false`; unset means on exactly when `NODE_ENV=production`) makes a write with no current key throw instead of storing plaintext. An explicit flag with a production default, not `NODE_ENV` alone, so an operator who must deploy before the key exists can say so (`false`) without a code change. Old keys set without a current key always throw on write: that is a half-done rotation. Reads are unaffected.
- **Strict keys:** key material must be canonical standard base64 of 32 bytes (`^[A-Za-z0-9+/]{43}=$`), checked before decoding, for the current and the old keys, since Node's decoder silently skips characters it doesn't recognise. The issue #354 build accepted any encoding that decoded to 32 bytes (base64url, unpadded), so a deployed key in another encoding is re-encoded as standard base64 under the same id before this build deploys; the runbook gives the check.
- **Hosts:** Netlify and the Cloudflare Worker build the same `apps/web` code, so both behave the same; they share a database but deploy separately, which is why the runbook's rotation makes a new key readable on both hosts before either writes with it.
