#!/usr/bin/env bash
# One Codex CLI run in a checkout, routed through the CCR gateway on Jackson's Mac.
#   codex-run.sh <checkout> <brief-file>
#   codex-run.sh resume <checkout> <codex-session-uuid> <message-file>
usage() { echo "usage: codex-run.sh <checkout> <brief-file> | resume <checkout> <codex-session-uuid> <message-file>"; exit 2; }
if [ "${1:-}" = resume ]; then
  [ $# -eq 4 ] || usage
  R="$2"; SESSION="$3"; MSG_FILE="$4"
else
  [ $# -eq 2 ] || usage
  R="$1"; MSG_FILE="$2"
fi
[ -f "$MSG_FILE" ] || { echo "missing $MSG_FILE"; exit 2; }
MSG_FILE="$(cd "$(dirname "$MSG_FILE")" && pwd)/$(basename "$MSG_FILE")"
R="$(cd "$R" 2>/dev/null && pwd)" || { echo "missing checkout"; exit 1; }
GIT_DIR_ABS="$(git -C "$R" rev-parse --absolute-git-dir 2>/dev/null)" || { echo "$R is not a git checkout"; exit 1; }
GIT_COMMON="$(cd "$R" && cd "$(git rev-parse --git-common-dir)" && pwd)"
nc -z 127.0.0.1 3456 || { echo "gateway down; run: ccr start"; exit 1; }

LOCK="$GIT_DIR_ABS/codex-run.lock"
mkdir "$LOCK" 2>/dev/null || { echo "Codex run already active in $R (or stale lock at $LOCK)"; exit 1; }
trap 'rmdir "$LOCK"' EXIT

LOGS="${CODEX_RUN_LOG_DIR:-$HOME/.codex-runs/logs}"
mkdir -p "$LOGS"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)_$(openssl rand -hex 4)"
LOG="$LOGS/$RUN_ID.log"; LAST="$LOGS/$RUN_ID.last.md"
export PATH="$HOME/.codex-queue-bin:/opt/homebrew/bin:$PATH"
export CODEX_RUN_MODEL="${CODEX_RUN_MODEL:-gpt-6.1-sol}"
export CODEX_RUN_ENVIRONMENT="local"

# The sandbox cannot read a global git config under ~/Documents, ~/Desktop or ~/Downloads.
HOME_REAL="$(realpath "$HOME")"
if [ -z "${GIT_CONFIG_GLOBAL:-}" ] && git config --global --includes --list --show-origin 2>/dev/null \
  | sed -n 's/^file:\([^	]*\)	.*/\1/p' | sort -u | while read -r f; do realpath "$f" 2>/dev/null; done \
  | grep -qE "^$HOME_REAL/(Documents|Desktop|Downloads)/"; then
  KV=("core.excludesFile=/dev/null" "core.attributesFile=/dev/null")
  for k in user.name user.email; do v="$(git -C "$R" config "$k")" && KV+=("$k=$v"); done
  GH="$(command -v gh)" && KV+=("credential.helper=!$GH auth git-credential")
  while read -r k v; do KV+=("$k=$v"); done < <(git config --global --includes --get-regexp '^filter\.lfs\.')
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_COUNT=${#KV[@]}
  for i in "${!KV[@]}"; do
    export "GIT_CONFIG_KEY_$i=${KV[$i]%%=*}" "GIT_CONFIG_VALUE_$i=${KV[$i]#*=}"
  done
fi

ROOTS="\"$GIT_COMMON\""
[ "$GIT_DIR_ABS" = "$GIT_COMMON" ] || ROOTS="$ROOTS,\"$GIT_DIR_ABS\""
IFS=: read -r -a EXTRA <<<"${CODEX_RUN_WRITABLE_ROOTS:-}"
for p in "${EXTRA[@]}"; do [ -n "$p" ] && ROOTS="$ROOTS,\"$p\""; done
SANDBOX=(-c 'sandbox_mode="workspace-write"' -c sandbox_workspace_write.network_access=true
  -c shell_environment_policy.inherit=all
  -c "sandbox_workspace_write.writable_roots=[$ROOTS]")

cd "$R" || exit 1
if [ -n "${SESSION:-}" ]; then
  echo "resume $SESSION in $R log $LOG"
  ccr Codex -- exec resume "${SANDBOX[@]}" -m "$CODEX_RUN_MODEL" --skip-git-repo-check -o "$LAST" -- "$SESSION" - <"$MSG_FILE" >"$LOG" 2>&1
else
  echo "run in $R log $LOG"
  ccr Codex -- exec "${SANDBOX[@]}" -m "$CODEX_RUN_MODEL" --skip-git-repo-check -C "$R" -o "$LAST" -- - <"$MSG_FILE" >"$LOG" 2>&1
fi
rc=$?
echo "rc=$rc"
[ -s "$LOG" ] || echo "log is empty: ccr exited before Codex wrote anything"
grep -m1 'session id:' "$LOG"
echo "tokens $(grep -A1 'tokens used' "$LOG" | tail -1)"
echo ----
cat "$LAST" 2>/dev/null || tail -20 "$LOG"
exit $rc
