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
- Integration tokens are stored encrypted in the platform database via `IntegrationAccount`
- Each integration has a service module in the platform codebase
- GitHub and Netlify connections are per-user and validated on each operation
- AI calls are platform-managed, providing observability and retry control

---

## Revision history

**2026-05-03, PR #90 — Vercel as a parallel deploy target.** Smoke testing surfaced friction with Netlify's API for programmatic site creation: there's no public endpoint that exposes the user's Netlify GitHub App `installation_id`, so `createSite`'s repo-linking call falls back to deploy-key (SSH) mode and fails with `Host key verification failed` on the first build. Vercel's API auto-resolves repo linking server-side (`POST /v9/projects` with `gitRepository: { type: "github", repo: "owner/name" }` is enough — no installation_id plumbing).

Added Vercel as an additive parallel target, not a replacement. Schema gains `Site.deployTarget` (defaults to `"netlify"` for existing rows) plus Vercel-specific fields (`vercelProjectId`, `vercelProjectName`, `vercelTeamId`). `/create` picks based on which integration the artist has connected; Vercel preferred when both are. Vercel auth is via Personal Access Token (their first-party Integration model is heavier; PAT is the lighter on-ramp and can be upgraded later).

Netlify's path also got fixed in the same PR — `findGithubAppInstallation(userId, "netlify", repoOwner)` now discovers the installation_id via GitHub's `/user/installations` (using the user's GitHub OAuth token we already have) and threads it into the Netlify create call. Both targets now work cleanly out of the box.
