#!/usr/bin/env bash
# restack-common.sh: shared primitives for the restack family (restack,
# restack-detect, restack-refresh). SOURCE this file; do not execute it.
#
# Callers own `set -euo pipefail` and set RC_PROG (used in error prefixes).
# Functions write human-readable progress to stderr and machine-usable values to
# stdout or RC_* globals, so command substitution stays clean.
#
# Conventions:
#   - "bottom-up" means children are ordered closest-to-trunk first.
#   - A "stack" is a single linear chain (child.base == parent.head). Trees
#     (two PRs sharing a base) are refused — the caller must pick one path.

rc_die() { echo "${RC_PROG:-restack}: error: $*" >&2; exit 1; }
rc_log() { echo "$*" >&2; }

rc_require() {
  local c
  for c in "$@"; do command -v "$c" >/dev/null || rc_die "$c not found"; done
}

rc_required_checks_state() {
  local checks
  checks="$(gh pr checks "$1" --required --json bucket 2>/dev/null || true)"
  if ! jq -e '
    type == "array" and
    all(.[]; .bucket == "pass" or .bucket == "fail" or .bucket == "pending"
      or .bucket == "skipping" or .bucket == "cancel")
  ' <<<"$checks" >/dev/null 2>&1; then
    printf 'unknown\n'
  elif jq -e 'any(.[]; .bucket == "fail" or .bucket == "cancel")' <<<"$checks" >/dev/null; then
    printf 'terminal\n'
  elif jq -e 'any(.[]; .bucket == "pending")' <<<"$checks" >/dev/null; then
    printf 'pending\n'
  else
    printf 'clear\n'
  fi
}

rc_required_checks_pending() {
  [ "$(rc_required_checks_state "$1")" = pending ]
}

# rc_trunk: echo the trunk branch (TRUNK override > origin/HEAD > GitHub > master).
rc_trunk() {
  if [ -n "${TRUNK:-}" ]; then printf '%s\n' "$TRUNK"; return; fi
  local t=""
  t="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's#^refs/remotes/origin/##')" || true
  if [ -z "$t" ] && command -v gh >/dev/null; then
    t="$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name 2>/dev/null)" || true
  fi
  printf '%s\n' "${t:-master}"
}

# rc_pr_list: echo JSON for open PRs by AUTHOR (default @me) with the fields the
# detector and callers need. One gh round-trip; pass the result around.
rc_pr_list() {
  gh pr list --state open --author "${AUTHOR:-@me}" --limit 100 \
    --json number,title,headRefName,headRefOid,baseRefName,mergeStateStatus,url
}

# rc_oid_for_branch <prs-json> <branch>: echo the headRefOid for <branch>, or empty.
rc_oid_for_branch() {
  jq -r --arg b "$2" 'map(select(.headRefName == $b)) | .[0].headRefOid // empty' <<<"$1"
}

# rc_ensure_obj <branch> <oid>: best-effort make <oid> available locally, fetching
# <branch> if needed. Returns 0 if the commit is present afterward, else 1.
rc_ensure_obj() {
  local branch="$1" oid="$2"
  [ -n "$oid" ] || return 1
  git cat-file -e "${oid}^{commit}" 2>/dev/null && return 0
  git fetch --quiet origin "$branch" 2>/dev/null || true
  git cat-file -e "${oid}^{commit}" 2>/dev/null
}

# rc_warn_divergence <prs-json> <branch-bottom-up>...
# For each adjacent (lower, upper) pair in the chain, warn when lower's tip is not
# an ancestor of upper's tip — i.e. the upper branch doesn't fork from its parent's
# current tip. That's the squash-merged-ancestor trap: the post-merge rebase will
# need a hand-picked RESTACK_BOUNDARY (merge-base is wrong), so flag it now, while
# it's cheap to fix by rebasing the child first (refresh-stack). Best-effort and
# fail-open: silently skips when not in a git repo or an OID can't be resolved.
rc_warn_divergence() {
  local prs="$1"; shift
  git rev-parse --git-dir >/dev/null 2>&1 || return 0
  local chain=("$@") i lower upper lo_oid up_oid warned=0
  for ((i = 0; i < ${#chain[@]} - 1; i++)); do
    lower="${chain[$i]}"; upper="${chain[$((i + 1))]}"
    lo_oid="$(rc_oid_for_branch "$prs" "$lower")"
    up_oid="$(rc_oid_for_branch "$prs" "$upper")"
    rc_ensure_obj "$lower" "$lo_oid" || continue
    rc_ensure_obj "$upper" "$up_oid" || continue
    git merge-base --is-ancestor "$lo_oid" "$up_oid" 2>/dev/null && continue
    if [ "$warned" -eq 0 ]; then
      rc_log ""
      rc_log "⚠ stack divergence — a post-merge rebase will need a hand-picked RESTACK_BOUNDARY:"
      warned=1
    fi
    rc_log "    $upper does not fork from $lower's tip (${lo_oid:0:9}) — it likely carries"
    rc_log "    un-squashed copies of already-merged commits."
  done
  [ "$warned" -eq 1 ] && rc_log "  Consider rebasing the child(ren) onto their parent first (refresh-stack/restack-refresh)."
  return 0
}

# rc_pr_commit_count <pr-number>: echo the number of commits GitHub attributes to
# the PR (its own commits, i.e. base..head). Empty on failure — callers must treat
# empty as "unknown" and not block on it.
rc_pr_commit_count() {
  gh pr view "$1" --json commits --jq '.commits | length' 2>/dev/null || true
}

# rc_merged_pr_heads [limit]: echo "<number>\t<headRefName>\t<headRefOid>" (TSV, most
# recent first) for the author's recently-merged PRs. headRefOid is the branch tip at
# merge time — GitHub retains it even after the branch is deleted. Used to spot a
# squash-merged parent whose child got auto-retargeted to trunk (the count guard can't
# see that case). Empty/best-effort: callers must fail open on empty.
# shellcheck disable=SC2120
rc_merged_pr_heads() {
  gh pr list --state merged --author "${AUTHOR:-@me}" --limit "${1:-30}" \
    --json number,headRefName,headRefOid \
    --jq '.[] | [.number, .headRefName, .headRefOid] | @tsv' 2>/dev/null || true
}

# rc_squashed_parent_info <start-branch> <start-pr-number> <base-branch>
# Detect whether <start-branch> was retargeted to <base-branch> after a parent PR
# SQUASH-merged — so it still carries un-squashed copies of already-merged
# commits, and a plain rebase onto the base would replay that merged work. The safe
# refresh needs a hand-picked drop-mode boundary (the fork point), which this
# computes. Shared by restack-refresh (fails closed) and restack-detect (warns at
# the confirm step) so both agree on the diagnosis. <base-branch> is whatever the PR
# now targets: trunk usually, or a still-open lower branch when a mid-stack PR was
# merged into its parent.
#
# On detection echoes one TSV line:
#   <parent_num>\t<parent_head>\t<boundary>\t<parent_commits>\t<own_commits>\t<replay>
# Empty in the common, healthy case (no squashed-parent fork found).
#
# Best-effort and fail-open: needs origin/<start-branch> and origin/<base-branch>
# present locally (fetch first), and can only spot a squashed parent whose tip is
# still in the local object store (GitHub deletes the branch on merge, so this is
# reliable right after the merge while you still have the ref — the typical case).
rc_squashed_parent_info() {
  local start_branch="$1" _="$2" base="$3"
  git rev-parse --git-dir >/dev/null 2>&1 || return 0
  local mb replay m_num m_head m_oid mb_parent parent_n own_n
  mb="$(git merge-base "origin/$base" "origin/$start_branch" 2>/dev/null)" || return 0
  [ -n "$mb" ] || return 0
  replay="$(git rev-list --count "$mb..origin/$start_branch" 2>/dev/null || echo 0)"
  [ "$replay" -gt 1 ] || return 0
  while IFS=$'\t' read -r m_num m_head m_oid; do
    [ -n "$m_oid" ] || continue
    git cat-file -e "${m_oid}^{commit}" 2>/dev/null || continue # tip not local; skip
    mb_parent="$(git merge-base "$m_oid" "origin/$start_branch" 2>/dev/null)" || continue
    # Only a parent we forked from shares history past trunk's base: mb_parent must
    # be a strict descendant of mb (mb is its ancestor, and they differ).
    [ -n "$mb_parent" ] && [ "$mb_parent" != "$mb" ] || continue
    git merge-base --is-ancestor "$mb" "$mb_parent" 2>/dev/null || continue
    parent_n="$(git rev-list --count "$mb..$mb_parent" 2>/dev/null || echo '?')"
    own_n="$(git rev-list --count "$mb_parent..origin/$start_branch" 2>/dev/null || echo '?')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$m_num" "$m_head" "$mb_parent" "$parent_n" "$own_n" "$replay"
    return 0
  done < <(rc_merged_pr_heads)
  return 0
}

# rc_enable_parent_merge <pr-number> <base-branch>
# Arm "merge when ready" on the parent so it lands as soon as it's green — WITHOUT
# waiting for the build to finish first. This mirrors the GitHub UI's "Merge when
# ready" button on a merge-queue repo:
#   - while the PR is still pending, `enablePullRequestAutoMerge` sets an
#     autoMergeRequest and GitHub auto-enqueues the PR the moment its required
#     checks pass — so we can arm NOW, with the build still running;
#   - once the PR is already green there's nothing to wait for, so that mutation is
#     rejected ("Auto merge is not allowed for this repository") and we enqueue it
#     directly with `enqueuePullRequest` instead.
# So: try the auto-merge mutation first, then fall back to a direct enqueue. Don't
# use `gh pr merge --auto` — its --squash/--merge flag collides with the
# queue-controlled merge method and the wrapper just errors out.
#
# Returns: 0 = armed, enqueued, or directly merged.
#          2 = required checks still pending before enqueue or direct merge. Transient,
#              so the caller should poll until the PR is green and call again.
#          3 = direct merge is policy-blocked while required checks are pending.
#              Retry as soon as those checks are no longer pending.
#              Dies on any terminal failure (no approval, a failed check, etc.).
rc_enable_parent_merge() {
  local pr="$1" base="$2" id out check_state
  id="$(gh pr view "$pr" --json id --jq .id)"
  [ -n "$id" ] || rc_die "could not resolve node id for #$pr"

  # 1. "Merge when ready" while the build is still running: arm auto-merge so GitHub
  #    enqueues the PR itself the moment its checks go green. Returns immediately —
  #    we never block on the build here. mergeMethod: SQUASH matches restack's
  #    squash-merge assumption (the post-merge rebase drops the squashed commits).
  if gh api graphql \
    -f query='mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) { pullRequest { autoMergeRequest { enabledAt } } } }' \
    -f id="$id" >/dev/null 2>&1; then
    rc_log "  merge-when-ready armed on #$pr (auto-merge, squash) — GitHub enqueues it once green"
    return 0
  fi

  # 2. Auto-merge was rejected — almost always because the PR is ALREADY green (so
  #    there's nothing to auto-wait for), but also if the repo disallows the
  #    auto-merge API outright. Either way the right move is to enqueue directly;
  #    the enqueue's own error handling below distinguishes "not green yet" (retry)
  #    from a terminal failure.
  rc_log "  auto-merge not armable (PR likely already green); enqueueing #$pr via the merge queue ..."
  if out="$(gh api graphql \
    -f query='mutation($id: ID!) { enqueuePullRequest(input: {pullRequestId: $id}) { mergeQueueEntry { position state } } }' \
    -f id="$id" \
    --jq '"  enqueued: position \(.data.enqueuePullRequest.mergeQueueEntry.position), state \(.data.enqueuePullRequest.mergeQueueEntry.state)"' 2>&1)"; then
    printf '%s\n' "$out" >&2
    return 0
  fi
  # Enqueue failed. A merge queue refuses a PR whose required checks haven't passed
  # yet ("Pull request N of M required status checks are expected"). That clears on
  # its own, so report it as retryable and let the caller wait for green + retry.
  # Everything else (missing approval, a failed check, conflicts) is terminal.
  if grep -qiE '[0-9]+ of [0-9]+ required status|status checks? (are|is) expected' <<<"$out"; then
    check_state="$(rc_required_checks_state "$pr")"
    [ "$check_state" = pending ] && return 2
  fi
  if grep -qi 'merge queues are not enabled' <<<"$out"; then
    rc_log "  merge queue unavailable for #$pr; falling back to a direct squash merge into '$base' ..."
    rc_squash_merge_direct "$pr" "$base"
    return $?
  fi
  rc_die "enqueuePullRequest failed for #$pr: ${out} — merge queues reject PRs that aren't approved and green; resolve that first (or hand off to babysit)."
}

# rc_squash_merge_direct <pr-number> <base-branch>
# Merge without a queue, either into an unprotected mid-stack base or in a
# repository where the trunk has no merge queue.
# Returns: 0 = merged. 2 = required checks still pending, so retryable — the caller
#          polls for green and calls again. 3 = a generic policy block with pending
#          required checks; retry once those checks finish. Dies on anything else.
rc_squash_merge_direct() {
  local pr="$1" base="$2" out check_state
  rc_log "  squash-merging #$pr directly into '$base' ..."
  if out="$(gh pr merge "$pr" --squash 2>&1)"; then
    rc_log "  ✓ #$pr squash-merged into $base"
    return 0
  fi
  if grep -qiE '[0-9]+ of [0-9]+ required status|status checks? (are|is) expected' <<<"$out"; then
    check_state="$(rc_required_checks_state "$pr")"
    [ "$check_state" = pending ] && return 2
    rc_die "gh pr merge --squash failed for #$pr (base '$base'): ${out}"
  fi
  if grep -qi 'not mergeable' <<<"$out"; then
    check_state="$(rc_required_checks_state "$pr")"
    [ "$check_state" = pending ] && return 3
  fi
  rc_die "gh pr merge --squash failed for #$pr (base '$base'): ${out}"
}

# rc_resolve_pr <prs-json> <number-or-branch>
# echo the matching PR record (compact JSON), or empty if none.
rc_resolve_pr() {
  local prs="$1" arg="$2"
  if [[ "$arg" =~ ^[0-9]+$ ]]; then
    jq -c --argjson n "$arg" 'map(select(.number == $n)) | .[0] // empty' <<<"$prs"
  else
    jq -c --arg b "$arg" 'map(select(.headRefName == $b)) | .[0] // empty' <<<"$prs"
  fi
}

# rc_detect_children <prs-json> <bottom-head-branch>
# Walk base refs upward from the bottom branch. Prints child head branches
# bottom-up to stdout (one per line); logs each to stderr. Dies on a tree
# (branch point) or a cycle.
rc_detect_children() {
  local prs="$1" cur="$2"
  local children=() matches n c_head c_num c_title c_mss seen
  while :; do
    matches="$(jq -c --arg b "$cur" 'map(select(.baseRefName == $b))' <<<"$prs")"
    n="$(jq length <<<"$matches")"
    [ "$n" -eq 0 ] && break
    if [ "$n" -gt 1 ]; then
      rc_log "  branch point: $n PRs are based on '$cur' — this is a tree, not a linear stack:"
      jq -r '.[] | "    #\(.number)  \(.headRefName)  (\(.title))"' <<<"$matches" >&2
      rc_die "ambiguous stack; pick a single path and pass child branches explicitly"
    fi
    c_head="$(jq -r '.[0].headRefName' <<<"$matches")"
    c_num="$(jq -r '.[0].number' <<<"$matches")"
    c_title="$(jq -r '.[0].title' <<<"$matches")"
    c_mss="$(jq -r '.[0].mergeStateStatus' <<<"$matches")"
    if [ "${#children[@]}" -gt 0 ]; then
      for seen in "${children[@]}"; do
        [ "$seen" = "$c_head" ] && rc_die "cycle detected at '$c_head'"
      done
    fi
    rc_log "child   #$c_num  $c_head  [$c_mss]  ($c_title)"
    children+=("$c_head")
    cur="$c_head"
  done
  # Print nothing (not a blank line) when empty, so the caller's read loop yields a 0-length array.
  [ "${#children[@]}" -gt 0 ] && printf '%s\n' "${children[@]}"
  return 0
}

# rc_detect_ancestors <prs-json> <head-branch> <trunk>
# The inverse of rc_detect_children: follow base refs DOWNWARD from <head-branch>
# to the bottom of its stack. Prints those head branches bottom-up (closest to
# trunk first), one per line; nothing when the branch already sits on trunk.
# Stops at the first base no open PR owns — trunk, a shared integration branch,
# or another author's. Dies on a cycle.
rc_detect_ancestors() {
  local prs="$1" cur="$2" trunk="$3"
  local chain=() base rec seen
  while :; do
    rec="$(jq -c --arg b "$cur" 'map(select(.headRefName == $b)) | .[0] // empty' <<<"$prs")"
    [ -n "$rec" ] || break
    base="$(jq -r '.baseRefName' <<<"$rec")"
    [ -n "$base" ] && [ "$base" != "$trunk" ] || break
    jq -e --arg b "$base" 'any(.[]; .headRefName == $b)' <<<"$prs" >/dev/null || break
    if [ "${#chain[@]}" -gt 0 ]; then
      for seen in "${chain[@]}"; do
        [ "$seen" = "$base" ] && rc_die "cycle detected at '$base'"
      done
    fi
    chain=("$base" ${chain[@]+"${chain[@]}"})
    cur="$base"
  done
  [ "${#chain[@]}" -gt 0 ] && printf '%s\n' "${chain[@]}"
  return 0
}

# --- rebase + push primitive --------------------------------------------------
#
# A rebase runs in a throwaway DETACHED worktree checked out at the branch's
# remote tip (an OID, not the branch), so the branch may stay checked out in a
# pool slot and the caller's HEAD never moves. The push happens from the caller's
# clone afterward, where git hooks (husky, secret scanners) are bootstrapped.

# rc_worktree_dir: mktemp a scratch parent dir and set RC_WT to the worktree path
# inside it (and RC_WT_PARENT to the dir to clean up). Call as a statement, then
# read $RC_WT — NOT via $(...), or the globals get trapped in a subshell and
# rc_worktree_cleanup can't see them. Caller runs rc_worktree_cleanup (via trap).
RC_WT=""
RC_WT_PARENT=""
rc_worktree_dir() {
  RC_WT_PARENT="$(mktemp -d "${TMPDIR:-/tmp}/restack.XXXXXX")"
  RC_WT="$RC_WT_PARENT/wt"
}
rc_worktree_cleanup() {
  if [ -n "${RC_WT:-}" ]; then git worktree remove --force "$RC_WT" 2>/dev/null || true; fi
  if [ -n "${RC_WT_PARENT:-}" ]; then rm -rf "$RC_WT_PARENT"; fi
  return 0
}

# rc_assert_boundary <boundary> <tip>: fail closed if <boundary> is not an ancestor
#   of <tip>. A `--onto <new> <boundary>` rebase only drops/re-points the right
#   commits when the branch actually sits on <boundary>; if it doesn't (a stale or
#   independently-rebased child), the rebase silently replays the wrong commits and
#   we'd force-push the result. Skipped when RESTACK_NO_GUARD is set, or when the
#   boundary object isn't present locally (can't verify — don't block).
rc_assert_boundary() {
  local boundary="$1" tip="$2" rc=0 mb land
  [ -n "${RESTACK_NO_GUARD:-}" ] && return 0
  git cat-file -e "${boundary}^{commit}" 2>/dev/null || return 0
  git merge-base --is-ancestor "$boundary" "$tip" 2>/dev/null || rc=$?
  [ "$rc" -eq 0 ] && return 0   # boundary is an ancestor — ok
  [ "$rc" -ne 1 ] && return 0   # unverifiable — don't block
  # rc==1: the child does not sit on the expected boundary. This is the danger
  # case — `rebase --onto <new> <boundary>` would replay the wrong commits. DON'T
  # just suggest `git merge-base`: when an ancestor PR was SQUASH-merged, the child
  # still carries the original un-squashed commits, and the merge-base sits BELOW
  # them, so a merge-base boundary replays already-landed work onto trunk. The
  # human has to pick the newest already-merged commit as the boundary. Show the
  # candidates to make that pickable.
  land="${RC_LAND_BRANCH:-${TRUNK:-master}}"
  mb="$(git merge-base "$boundary" "$tip" 2>/dev/null || true)"
  {
    echo "${RC_PROG:-restack}: error: boundary ${boundary:0:9} is not an ancestor of ${tip:0:9}."
    echo "  This branch does not sit on the expected fork point — usually because an"
    echo "  ancestor PR was SQUASH-merged and this branch still carries the original,"
    echo "  un-squashed commits. The git merge-base is NOT a safe boundary here: it"
    echo "  would replay every commit below it, including work already on $land."
    if [ -n "$mb" ]; then
      echo
      echo "  Commits a merge-base boundary (${mb:0:9}) would replay onto $land:"
      git log --oneline --no-decorate "$mb..$tip" 2>/dev/null | sed 's/^/      /'
      echo
      echo "  Set RESTACK_BOUNDARY to the NEWEST of these whose work is ALREADY merged"
      echo "  (verify with \`gh pr list --state merged\`); only the commits ABOVE it are"
      echo "  this PR's own and should be replayed. Then re-run:"
    else
      echo "  Identify the newest already-merged commit in this branch's history and:"
    fi
    echo "      RESTACK_BOUNDARY=<that-sha> restack <parent> <children…>"
    echo "  (RESTACK_NO_GUARD=1 skips this check but replays the WRONG commits if the"
    echo "   boundary is off — only use it once you've confirmed the boundary.)"
  } >&2
  exit 1
}

# rc_write_conflict_provenance <worktree> <old-base> <old-tip> <new-onto>
rc_write_conflict_provenance() {
  local wt="$1" old_base="$2" old_tip="$3" new_onto="$4"
  local old_base_oid old_tip_oid new_onto_oid provenance_path provenance_dir
  local temporary expected actual

  provenance_path="$(git -C "$wt" rev-parse --git-path restack-conflict-provenance)" || return 1
  case "$provenance_path" in
    /*) ;;
    *) provenance_path="$wt/$provenance_path" ;;
  esac
  provenance_dir="$(dirname "$provenance_path")"
  [ -d "$provenance_dir" ] || return 1
  if [ -e "$provenance_path" ] || [ -L "$provenance_path" ]; then
    rm -f "$provenance_path" || return 1
  fi

  old_base_oid="$(git -C "$wt" rev-parse --verify "${old_base}^{commit}" 2>/dev/null)" || return 1
  old_tip_oid="$(git -C "$wt" rev-parse --verify "${old_tip}^{commit}" 2>/dev/null)" || return 1
  new_onto_oid="$(git -C "$wt" rev-parse --verify "${new_onto}^{commit}" 2>/dev/null)" || return 1
  git -C "$wt" merge-base --is-ancestor "$old_base_oid" "$old_tip_oid" 2>/dev/null || return 1

  temporary="$provenance_path.tmp.$$"
  expected="$(printf 'old_base=%s\nold_tip=%s\nnew_onto=%s' \
    "$old_base_oid" "$old_tip_oid" "$new_onto_oid")"

  if ! printf '%s\n' "$expected" >"$temporary" ||
     ! mv -f "$temporary" "$provenance_path"; then
    rm -f "$temporary"
    return 1
  fi
  actual="$(cat "$provenance_path" 2>/dev/null)" || {
    rm -f "$provenance_path"
    return 1
  }
  if [ "$actual" != "$expected" ]; then
    rm -f "$provenance_path"
    return 1
  fi
}

# rc_rebase_branch <child> <onto> <boundary> <old-base> <worktree>
#   Fetches <child>, checks out origin/<child> detached in <worktree>, and rebases
#   it onto <onto>. If <boundary> is non-empty, runs `rebase --onto <onto>
#   <boundary>` (drops/re-points everything up to <boundary>, after asserting the
#   branch sits on <boundary>); if empty, runs a plain `rebase <onto>` letting git
#   find the merge-base (bottom-of-stack onto trunk).
#
#   Sets RC_OLD_TIP always. On success: removes the worktree, sets RC_NEW_TIP,
#   returns 0 (does NOT push — call rc_push_branch). On conflict: leaves the
#   worktree in place, sets RC_CONFLICT_WT, returns 1.
RC_OLD_TIP=""
RC_NEW_TIP=""
RC_CONFLICT_WT=""
rc_rebase_branch() {
  [ "$#" -eq 5 ] || rc_die "rc_rebase_branch requires exact old-base provenance"
  local child="$1" onto="$2" boundary="$3" old_base="$4" wt="$5"
  RC_NEW_TIP=""
  RC_CONFLICT_WT=""
  git rev-parse --verify "${old_base}^{commit}" >/dev/null 2>&1 ||
    rc_die "missing or invalid old-base provenance for '$child'"
  git fetch origin "$child"
  RC_OLD_TIP="$(git rev-parse "origin/$child")"
  [ -n "$boundary" ] && rc_assert_boundary "$boundary" "$RC_OLD_TIP"
  # post-checkout hooks may warn in a bare scratch worktree; that's harmless.
  git worktree add --detach --force "$wt" "$RC_OLD_TIP" >/dev/null
  local rc=0
  if [ -n "$boundary" ]; then
    git -C "$wt" rebase --onto "$onto" "$boundary" || rc=$?
  else
    git -C "$wt" rebase "$onto" || rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    if ! rc_write_conflict_provenance \
      "$wt" "$old_base" "$RC_OLD_TIP" "$onto"; then
      rc_die "conflict provenance could not be written for '$child'"
    fi
    # shellcheck disable=SC2034
    RC_CONFLICT_WT="$wt"
    return 1
  fi
  # shellcheck disable=SC2034
  RC_NEW_TIP="$(git -C "$wt" rev-parse HEAD)"
  git worktree remove --force "$wt" >/dev/null
  return 0
}

# rc_push_branch <child> <old_tip> <new_tip>
#   Force-push <new_tip> to <child>, leased on the explicit pre-rebase tip so a
#   remote that moved under us aborts the push instead of clobbering work.
rc_push_branch() {
  local child="$1" old_tip="$2" new_tip="$3"
  git push --force-with-lease="$child:$old_tip" origin "$new_tip:refs/heads/$child"
}
