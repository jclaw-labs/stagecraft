# Stagecraft

A free platform for creating and running musician websites. An artist signs in with GitHub, connects a host (Vercel or Netlify) and Resend, and gets a site in a private GitHub repo in their own account, deployed from their own host account. They edit it in a visual editor at `/admin` on the site itself, and every save and publish is a commit to their repo. The site's content is plain files in that repo; Stagecraft keeps no copy.

## Architecture

- **Platform app** (`apps/web`): Next.js app on Netlify. Sign-in, integrations, site creation and migration, and the token broker that lets artist sites commit to their own repos
- **Database** (`packages/db`): Prisma schema + client for platform metadata (accounts, sites, jobs). Never site content
- **Job queue** (`packages/queue`): Postgres-backed queue for site creation and migration
- **Shared types** (`packages/shared`): Types, enums and helpers shared across packages
- **Artist-site template** (`templates/musician-site`): Next.js + Puck site with a built-in editor; each new site's repo starts as a copy of it

See `docs/specs/technical-architecture.md` for how these fit together.

## Setup

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate --schema=packages/db/prisma/schema.prisma

# Set up credentials — see docs/runbook.md §2 for required env vars
# (uses 1Password: npm run dev resolves op:// refs automatically)

# Run database migrations (requires Postgres)
npm run db:migrate

# Start development server
npm run dev
```

To work on the template on its own, run `npm install` and `npm run dev` in `templates/musician-site`; without platform credentials it saves to local disk. See `templates/musician-site/CLAUDE.md`.

## Project Structure

```
apps/
  web/                  # Next.js platform app
packages/
  db/                   # Prisma schema + client
  queue/                # Job queue
  shared/               # Shared types
templates/
  musician-site/        # Next.js + Puck artist-site template
docs/
  specs/                # Product and technical specs
  adr/                  # Architecture decision records
  runbook.md            # Operations
```

## Key Decisions

See `docs/adr/` for architecture decision records: the platform stack (ADR-001 to ADR-006), the artist-site template and its content model (ADR-007, ADR-009, ADR-013 to ADR-016), the GitHub App and token broker (ADR-008), and the draft and publish model (ADR-010 to ADR-012).

## Operations

See `docs/runbook.md` for environment setup, common failure modes, and recovery procedures.
