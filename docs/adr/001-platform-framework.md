# ADR-001: Platform Application Framework

## Status
Accepted. 2026-10-10, #362: the generated customer sites no longer use Astro. They are built from the Next.js + Puck template (ADR-007), and the legacy Astro template was removed (ADR-014), so the "Next.js vs Astro" split below is historical.

## Context
The Stagecraft platform needs a web application framework for the user-facing dashboard, API endpoints, and backend orchestration. The platform app is separate from the generated customer sites (which use Astro).

## Decision
Use **Next.js 15 with App Router and TypeScript** for the platform application.

### Chosen: Next.js + App Router
- Unified frontend/backend in one deployable unit
- Server components reduce client bundle for dashboard pages
- API routes and server actions for backend endpoints
- Strong TypeScript support
- Large ecosystem and deployment flexibility
- Route handlers work well for webhook ingestion

### Rejected alternatives
- **Separate frontend + API**: Adds deployment complexity for v1 with no clear benefit
- **Remix**: Viable but smaller ecosystem; Next.js has more deployment options
- **SvelteKit**: Smaller hiring pool and ecosystem; team is TypeScript/React-oriented

## Consequences
- Platform app and generated customer sites use different frameworks (Next.js vs Astro), which is intentional per the spec
- Server components and server actions reduce the need for a separate API layer in v1
- Background jobs still need a separate execution model (see ADR-004)
