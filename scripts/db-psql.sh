#!/usr/bin/env bash
# Open a psql session against the Stagecraft DB.
#
# Usage:
#   npm run db:psql                # connects to packages/db/.env's DATABASE_URL
#                                    (the local Docker DB by default)
#   npm run db:psql:prod           # connects to packages/db/.env's NEON_DATABASE_URL
#                                    (production Neon DB; use the *direct*
#                                    /unpooled/ URL — psql + pgbouncer
#                                    transaction-mode breaks prepared statements)
#
#   bash scripts/db-psql.sh                   # same as `npm run db:psql`
#   bash scripts/db-psql.sh NEON_DATABASE_URL # same as `npm run db:psql:prod`
#   DATABASE_URL='postgresql://...' bash scripts/db-psql.sh   # ad-hoc override
#
# The optional first argument is the *name* of an env var that holds the
# connection string (default: DATABASE_URL). The script loads
# packages/db/.env so that var doesn't have to be exported in your shell.
set -euo pipefail

URL_VAR="${1:-DATABASE_URL}"

# Load packages/db/.env so the chosen URL_VAR resolves without requiring
# the user to export it in their shell first.
if [ -f packages/db/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source packages/db/.env
  set +a
fi

# Resolve the chosen var via indirect expansion.
URL="${!URL_VAR:-}"

if [ -z "$URL" ]; then
  HINT_SCRIPT="db:psql"
  [ "$URL_VAR" != "DATABASE_URL" ] && HINT_SCRIPT="db:psql:prod"
  echo "$URL_VAR is not set." >&2
  echo "Either populate packages/db/.env with $URL_VAR=postgresql://..." >&2
  echo "or export it inline:" >&2
  echo "  $URL_VAR='postgresql://...' npm run $HINT_SCRIPT" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install with: brew install libpq && brew link --force libpq" >&2
  exit 1
fi

exec psql "$URL"
