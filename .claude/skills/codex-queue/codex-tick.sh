#!/usr/bin/env bash
# One Codex queue run for a role, started by the thread that owns the Codex queue.
#   codex-tick.sh <worker|reviewer> [extra-instructions-file]
#   codex-tick.sh <worker|reviewer> resume <codex-session-uuid> <queue-session-token> <message-file>
ROLE="$1"
case "$ROLE" in worker|reviewer) ;; *) echo "usage: codex-tick.sh <worker|reviewer> ..."; exit 2 ;; esac
H="$HOME/.codex-queue-$ROLE"
[ -d "$H" ] || { echo "missing $H; see the skill's setup"; exit 1; }
LOCK="$H/run.lock"
mkdir "$LOCK" 2>/dev/null || { echo "$ROLE run already active (or stale lock at $LOCK)"; exit 1; }
trap 'rmdir "$LOCK"' EXIT
R="$(find "$H" -mindepth 2 -maxdepth 2 -name .git -type f -exec dirname {} \; | head -1)"
[ -n "$R" ] || { echo "no clone with a separate git dir under $H; see the skill's setup"; exit 1; }
mkdir -p "$H/logs"
TS=$(date -u +%Y%m%dT%H%M%SZ)
RUN="$(dirname "$(realpath "$0")")/../with-codex/codex-run.sh"
export CODEX_RUN_LOG_DIR="$H/logs" CODEX_RUN_WRITABLE_ROOTS="$HOME/.platformio"
export CODEX_RUN_MODEL="${CODEX_QUEUE_MODEL:-gpt-6.1-sol}"
export CODEX_QUEUE_MODEL="$CODEX_RUN_MODEL" CODEX_QUEUE_ENVIRONMENT="local"
export GIT_CONFIG_GLOBAL=/dev/null

if [ "${2:-}" = resume ]; then
  export CODEX_QUEUE_SESSION="$4"
  echo "role $ROLE"
  bash "$RUN" resume "$R" "$3" "$5"; exit $?
fi
EXTRA_FILE="${2:-}"

if [ -n "$(git -C "$R" status --porcelain)" ]; then echo "clone dirty, skipping"; git -C "$R" status --short; exit 1; fi
if ! git -C "$R" fetch -q origin || ! git -C "$R" checkout -q --detach origin/HEAD; then echo "git prep failed"; exit 1; fi
SLUG="$(git -C "$R" remote get-url origin | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')"
CODEX_QUEUE_SESSION="codex_${TS}_$(openssl rand -hex 4)"
export CODEX_QUEUE_SESSION

COMMON="- Your session identity is \$CODEX_QUEUE_SESSION ($CODEX_QUEUE_SESSION). Validate it with task-queue validate-session before any tracker access and use it unchanged.
- Provenance: this harness is the Codex CLI, launched by a scheduler on Jackson's Mac. Its authoritative runtime source is the launcher's environment: \$CODEX_QUEUE_MODEL is the model and \$CODEX_QUEUE_ENVIRONMENT is the environment. Build agent context with agent-provenance normalize --model \"\$CODEX_QUEUE_MODEL\" --environment \"\$CODEX_QUEUE_ENVIRONMENT\" (plus --target only for agent-facing work), and use \$CODEX_QUEUE_ENVIRONMENT wherever a skill asks for this session's runtime.
- Work only in this checkout. Never merge, force-push or touch other repositories. Leave the checkout clean.
- Your shell is a login shell that resets PATH, and macOS python3 is too old for the queue scripts. Run every queue script, validator and agent-provenance command with PATH=$HOME/.codex-queue-bin:\$PATH in front.
- If a permission or sandbox limit blocks a step, record it in your summary instead of working around it."

if [ "$ROLE" = worker ]; then
  BRIEF="You are one scheduled run of an implementation queue worker for $SLUG. Follow the work-task-queue skill in .agents/skills and the skills it depends on, taking section 9's 'no subagent tool' path. Claim at most one eligible Ready task and carry it through section 8's handoff. Commit, push and open a draft PR as create-pr describes. The coordinator's schedule is your idle monitor: after this unit or an empty selection, exit without arming another worker monitor.
$COMMON
- End with a short summary: what you claimed, PR links, the Queue state you left, and anything that needs a person."
else
  BRIEF="You are one scheduled run of a queue reviewer for $SLUG. Follow the review-task-queue skill in .agents/skills and the skills it depends on. Claim at most one eligible Needs review issue and run its deep-review loop to the skill's stopping rule. Follow section 7's merge-monitor precondition: arm and verify a live PR merge watcher before any Ready to merge handoff, then keep it live, wait for the merge and reconcile the owner through section 8 before exiting. The coordinator's next scheduled tick is not that watcher. If you cannot arm one, keep Under review and its Claim, report the gap and remain in section 7's live retry loop; never hand off without it. After this one review and its merge reconciliation, or if nothing is eligible, exit without arming an idle reviewer monitor.
$COMMON
- End with a short summary: what you reviewed, the verdict and PR links, the Queue state you left, and anything that needs a person."
fi
[ -n "$EXTRA_FILE" ] && BRIEF="$BRIEF
- Extra instructions from Jackson for this run: $(cat "$EXTRA_FILE")"

BRIEF_FILE="$H/logs/codex_${TS}.brief.md"
printf '%s\n' "$BRIEF" >"$BRIEF_FILE"
echo "role $ROLE repo $SLUG"
bash "$RUN" "$R" "$BRIEF_FILE"; exit $?
