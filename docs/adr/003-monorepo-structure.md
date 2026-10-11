# ADR-003: Monorepo Structure

## Status
Accepted. 2026-10-10, #362: `templates/musician-site-legacy/` (the Astro template) was removed (ADR-014); `templates/musician-site/`, the Next.js + Puck template (ADR-007), is the only template.

## Context
The platform has multiple concerns: web app, database layer, job queue, shared types, and eventually generated site templates. These need to be organized for clear boundaries while keeping development simple.

## Decision
Use a **monorepo with npm workspaces and Turborepo** for build orchestration.

### Structure
```
/
  apps/
    web/              # Next.js platform app
  packages/
    db/               # Prisma schema + generated client
    queue/            # Job abstraction layer
    shared/           # Shared types and utilities
  templates/
    musician-site-legacy/  # Legacy Astro template (superseded by ADR-007)
    musician-site/         # Current Next.js + Puck template (per ADR-007)
    musician-site-shell/   # Artist-repo shell over the template's package, plus starter content (ADR-016)
  docs/
    specs/            # Product and technical specs
    adr/              # Architecture decision records
```

### Chosen: npm workspaces + Turborepo
- npm workspaces: native, no extra package manager needed
- Turborepo: fast incremental builds, caching, simple config
- Clear workspace boundaries enforce separation of concerns

### Rejected alternatives
- **Single app, no workspaces**: DB schema, queue, and shared types benefit from being importable packages
- **pnpm workspaces**: Viable but npm is already available and sufficient
- **Nx**: More powerful but heavier than needed for this project's scale

## Consequences
- Each workspace has its own `package.json` and can define its own scripts
- `packages/*` are imported by `apps/web` via workspace references
- Turborepo handles build ordering and caching
- The `templates/` directory is not a workspace — it's a standalone project used as a source template
