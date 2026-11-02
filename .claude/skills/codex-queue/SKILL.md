---
name: codex-queue
description: Run a repository's task queue (work-task-queue and review-task-queue) on Codex tokens instead of Claude, with Codex CLI runs started, reported and steered from a Remote Control thread on Jackson's Mac. Use when Jackson asks to run, start, pause, steer or check the Codex queue workers, or to move queue work off Claude tokens.
---

# Codex-powered queue workers

The queue skills (`work-task-queue`, `review-task-queue`, `claim-task`, `create-pr`, `deep-review`)
stay the same. Each worker or reviewer run is a Codex CLI run as `with-codex` describes, so read
that skill first; this one adds the queue roles, clones, schedule and briefs.

First proven in jclaw-labs/mycelium-suits: a worker run claimed an issue, was resumed after a
sandbox fix, passed tests and five firmware builds, and handed its PR to Needs review; reviewer
runs validated, read the queue and handled an empty Needs review cleanly.

## Why not the other routes

- **Project threads on Codex:** not possible. Project sessions talk to Anthropic directly and the
  project only offers Claude models.
- **launchd running Codex alone:** works, but the project can't see or steer it.

## Roles

**Coordinator (project chat).** Cannot run commands on the Mac. To start the Codex queue, start
one thread that runs on Jackson's Mac over Remote Control, titled "Codex queue", with a brief that
says to follow this skill's "Thread" section for the repository in question. Route anything about
the Codex workers (pause, steer a run, change priorities, "what is it doing") to that thread with
`message_thread`. Make sure no Claude worker or reviewer threads for the same queue are running at
the same time, or tasks get claimed and reviewed twice. Relay steward priorities (for example
"take #65 next") to the thread rather than acting on them yourself.

**Thread (on the Mac).** Runs the loop below. It is the only place runs are started, reported and
steered. Each role has one active run at a time; `codex-tick` rejects overlapping runs for that role.

## One-time setup on the Mac

Do `with-codex`'s setup first, including the Python shim, then:

1. **One clone per role**, with git data outside the work tree so the Codex sandbox can write it:
   ```bash
   for role in worker reviewer; do
     H=~/.codex-queue-$role; mkdir -p $H/logs
     git clone -q https://github.com/<owner>/<repo>.git $H/<repo>
     git -C $H/<repo> init -q --separate-git-dir=$H/gitdir
     for kv in "credential.helper=!/opt/homebrew/bin/gh auth git-credential" \
               "user.name=Jackson Clawson" "user.email=jclaw3456@gmail.com" \
               "core.excludesFile=/dev/null" "core.attributesFile=/dev/null"; do
       git -C $H/<repo> config "${kv%%=*}" "${kv#*=}"
     done
   done
   ```
   The `core.*File=/dev/null` lines matter because Jackson's global git config and ignore file live
   under `~/Documents`, which sandboxed processes cannot read; runs set `GIT_CONFIG_GLOBAL=/dev/null`.
   One queue per Mac at a time: the script uses whichever clone it finds under each role's folder.
2. **`codex-tick` on PATH and the allow rule.** On a `personal` or `substack` machine, local-config
   links `~/.local/bin/codex-tick` to `codex-tick.sh` beside this file, which runs `with-codex`'s
   `codex-run.sh`. For mycelium-suits on a `personal` machine it also links the repo's
   `.claude/settings.local.json` to a managed copy that allows `Bash(codex-tick *)`, so auto mode
   doesn't refuse runs. For a repo without a managed settings file, Jackson adds that rule himself
   (Claude can't edit its own settings).

## Thread: the run loop

- **Start a run** in the background: `codex-tick worker` or `codex-tick reviewer`.
  Run worker and reviewer concurrently; they use separate clones.
- **When a run finishes**, read its output (it ends with Codex's own summary, the Codex session id
  and tokens used) and post one short reply: what it claimed or reviewed, PR links, Queue state
  left, anything that needs a person, tokens. Keep the run's Codex session id and queue session
  token (`codex_<timestamp>_<hex>`, printed in the log) for steering.
- **Reviewer merge handoff:** the reviewer must arm and verify the PR's live merge watcher before
  moving an issue to `Ready to merge`, then wait for the merge and reconcile the owner before its
  run ends. A reviewer run can therefore remain active for longer than one tick. Do not start or
  resume another reviewer run while it is active. The next 30-minute tick is only for finding
  new reviews; it is not the merge watcher required by `review-task-queue` section 7.
- **Schedule** each role's next run 30 minutes after its last one ended, with a background
  `sleep 1800` that wakes the thread. Start a reviewer run early when a worker has just handed
  something to Needs review.
- **One-off instructions** for the next run: write them to a file and pass it as the second
  argument: `codex-tick worker /path/to/extra.txt`. Use this for steward priorities.
- **Steer a finished or stopped run** by resuming it with its full context and the same queue
  identity: write the message to a file, then
  `codex-tick <role> resume <codex-session-uuid> <queue-session-token> <file>`.
  Do this when a run stopped on something you or Jackson can fix (a sandbox path, a missing tool,
  a decision), instead of letting the claim go stale. A run can't be interrupted mid-way.
- **Pause** by not scheduling the next run; say so in the thread. **Stop** by stopping the pending
  timers with TaskStop.
- **Stale role lock:** `codex-tick` removes its `~/.codex-queue-<role>/run.lock` on normal exit.
  After a hard crash, verify no run for that role is still active before removing the lock and
  starting another one.
- **Watch Claude tokens:** read run summaries and only the specific log lines you need; logs are
  large.
- **Stale run lock:** `codex-run` also holds `<git-dir>/codex-run.lock` in the clone; see
  `with-codex`.

## What each run is told

`codex-tick` builds the brief. Besides "follow work-task-queue" or "follow review-task-queue",
it tells the run to:

- validate its queue session token before tracker access;
- build provenance from the launcher: the Codex CLI has no agent-provenance adapter, so the
  script exports `CODEX_QUEUE_MODEL` and `CODEX_QUEUE_ENVIRONMENT=local`, and the run uses
  `agent-provenance normalize --model ... --environment ...` and that environment as its runtime.
  Without this the reviewer refuses every PR;
- take work-task-queue's "no subagent tool" path: the schedule is the worker's idle monitor, so
  do one unit, hand off and exit;
- follow review-task-queue's merge watcher requirement inside the reviewer run; keep it active
  through the merge and issue reconciliation, then exit rather than arming another idle monitor;
- stay in its clone, never merge, force-push or touch other repos, and leave the clone clean;
- prefix queue scripts with the Python shim, because its login shell resets PATH;
- record sandbox blocks in its summary instead of working around them.

## Known problems and fixes

See `with-codex` for sandbox, Python and gateway problems. Queue-specific:

| Symptom in a run summary | Cause | Fix |
| --- | --- | --- |
| PlatformIO can't write `~/.platformio/platforms.lock` | Sandbox | `~/.platformio` writable root (built in) |
| A PR has no agent context block | Created before provenance was wired up | Reviewer skips it; open a fresh draft PR from the same branch with the block |
