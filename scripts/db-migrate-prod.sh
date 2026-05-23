#!/usr/bin/env bash
# Apply pending Prisma migrations against the production Neon database.
#
# Why this script exists:
#   `npm run migrate:deploy --workspace=@stagecraft/db` applies migrations
#   against `DATABASE_URL` from packages/db/.env, which by default points at
#   the local Docker Postgres. Trying to do `DATABASE_URL=$NEON_DATABASE_URL
#   npm run ...` from the repo root silently misfires, because
#   $NEON_DATABASE_URL only lives inside packages/db/.env (it's not
#   exported into the user's shell). The shell expansion produces an empty
#   string, then Prisma falls back to .env's localhost URL, then 4-12
#   migrations get applied to local instead of prod and the user thinks
#   prod is fixed.
#
# This script:
#   1. cd into packages/db (so Prisma finds the schema + .env)
#   2. source .env to make NEON_DATABASE_URL available
#   3. assert NEON_DATABASE_URL is non-empty
#   4. invoke `prisma migrate deploy` with DATABASE_URL set to NEON_DATABASE_URL
#   5. echo back the resolved host so the operator can verify it ran against Neon
#
# Usage:
#   npm run db:migrate:prod
#
# Pre-req: packages/db/.env contains a `NEON_DATABASE_URL=...` line. Use the
# *direct* (unpooled) URL — the one without `-pooler` in the host. The
# pooled URL works for runtime queries but pgbouncer's transaction-mode
# pooling can break Prisma's migration locking.

set -euo pipefail

cd "$(dirname "$0")/../packages/db"

if [ ! -f .env ]; then
  echo "packages/db/.env not found." >&2
  echo "Create it with at least: NEON_DATABASE_URL=postgresql://..." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if [ -z "${NEON_DATABASE_URL:-}" ]; then
  echo "NEON_DATABASE_URL is not set in packages/db/.env." >&2
  echo "Add it from your Neon dashboard (Connection details → \"Direct connection\")." >&2
  exit 1
fi

# Extract host for the verification echo so we don't print credentials.
HOST=$(printf '%s' "$NEON_DATABASE_URL" | sed -E 's#^[^@]+@([^/?]+).*#\1#')
echo "Applying pending migrations against: $HOST"
echo

DATABASE_URL="$NEON_DATABASE_URL" npx prisma migrate deploy
