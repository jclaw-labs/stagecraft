---
name: with-codex
description: Run another skill or task on Codex tokens instead of Claude, as Codex CLI runs that this Claude session starts, reports and steers on Jackson's Mac. Use when Jackson says to do something "using /with-codex", "with Codex", "on Codex tokens", or "/with-codex <task>", for example "run /deep-review-orchestrate using /with-codex".
---

# Run a skill with Codex

The named skill or task stays the same. What changes is who executes it: a fresh **Codex CLI**
session on the Codex model, routed through the CCR gateway on Jackson's Mac and billed to his
ChatGPT Codex quota. This Claude session only starts the run, reports its summary and steers it,
so Claude tokens go on orchestration, not on the work itself. Runs cost roughly 60k to 110k Codex
tokens each.

Claude Code pointed at the Codex model (`ccr "Claude Code" -- --model "Codex API/<model>"`) was
tried and rejected: it stalled after describing steps instead of doing them, needed approval for
every write, died on compaction, and moved tens of millions of tokens. Use the Codex CLI.

## One-time setup on the Mac

Check each item; do the ones you can and ask Jackson for the rest in one message.

1. **CCR gateway** is listening on `127.0.0.1:3456` (`nc -z 127.0.0.1 3456`); if not, Jackson runs
   `ccr start`. The CCR profile named `Codex` must exist (`ccr Codex -- --version` prints a version).
2. **Codex CLI** is installed (`codex --version`); if not, Jackson runs `npm install -g @openai/codex`.
3. **Python shim**, if the task runs Python 3.10+ scripts such as the queue or provenance tools:
   macOS ships 3.9.
   `mkdir -p ~/.codex-queue-bin && ln -sf /opt/homebrew/bin/python3.13 ~/.codex-queue-bin/python3`
4. **`codex-run` on PATH.** On a `personal` or `substack` machine, local-config links
   `~/.local/bin/codex-run` to `codex-run.sh` beside this file. Auto mode may need a
   `Bash(codex-run *)` allow rule; Jackson adds it (Claude can't edit its own settings).

## Start a run

1. Settle everything the skill would ask up front: the PR, branch, repo, choices. A Codex run is
   non-interactive and can't ask Jackson anything mid-way.
2. Pick the checkout. Use the worktree or slot the skill would use anyway, clean and exclusively
   owned, claimed through the usual worktree or slot rules. The run works only there.
3. Write the brief to a file in your scratchpad:

   ```text
   You are running on Jackson's Mac as a Codex CLI session started by a Claude session.
   Jackson asked: "<his request, quoted>". That request carries the same authorization it would
   for a Claude session.
   Follow the <skill> skill in .agents/skills or ~/.agents/skills and the skills it depends on,
   for <PR / task / arguments>. <Anything settled in step 1.>
   - Provenance: this harness is the Codex CLI. Its authoritative runtime source is the
     launcher's environment: $CODEX_RUN_MODEL is the model and $CODEX_RUN_ENVIRONMENT is the
     environment. Build agent context with agent-provenance normalize --model "$CODEX_RUN_MODEL"
     --environment "$CODEX_RUN_ENVIRONMENT", and use that model wherever a skill asks for a
     model shorthand or this session's runtime.
   - Work only in this checkout. Never merge, force-push or touch other repositories.
   - Your login shell resets PATH. Run Python scripts and agent-provenance with
     PATH=$HOME/.codex-queue-bin:$PATH in front.
   - You cannot ask Jackson anything. When you need a decision, or a fresh-context subagent you
     cannot start, stop there and say exactly what you need in your summary.
   - If a permission or sandbox limit blocks a step, record it in your summary instead of
     working around it.
   - End with a short summary: what you did, links, the state you left, and anything that needs
     a person.
   ```

4. Start it in the background: `codex-run <checkout> <brief-file>`. One run per checkout at a
   time; the script refuses an overlapping one.

`codex-run` makes the checkout's git dirs writable in the sandbox, including a worktree's common
dir, and swaps in a minimal git config when the global one lives where the sandbox can't read.
Optional environment: `CODEX_RUN_MODEL` (default `gpt-6.1-sol`), `CODEX_RUN_LOG_DIR` (default
`~/.codex-runs/logs`), `CODEX_RUN_WRITABLE_ROOTS` (colon-separated extra writable paths, such as a
tool cache).

## When it finishes

The output ends with the exit code, the Codex session id, tokens used and Codex's own summary.
Post one short reply: what it did, links, state left, anything that needs Jackson, tokens. Keep
the session id for steering. Read only the log lines you need; logs are large.

- **Steer or continue** a finished or stopped run with its full context: write the message to a
  file, then `codex-run resume <checkout> <codex-session-uuid> <file>`. Do this when it stopped
  on something you or Jackson can fix (a sandbox path, a missing tool, a decision), and to relay
  Jackson's answers. A run can't be interrupted mid-way.
- **Fresh-context subagents.** Codex exec may not be able to start one (deep-review-orchestrate's
  reviewer, for example). When the run stops asking for one, write a new brief from the step-3
  template with the subagent's prompt as the task, start it as its own fresh `codex-run` in the
  same checkout, and wait for it. Then resume the parent run with a message saying the result
  below is the complete output of the fresh-context subagent it asked for, which saw only that
  prompt, and that it should continue from the step where it stopped. A fresh run is a fresh
  context, so it satisfies "never resume an old reviewer".
- **Stale lock:** `codex-run` removes `<git-dir>/codex-run.lock` on normal exit. After a hard
  crash, verify no run in that checkout is still active before removing it.
- Verify the result before reporting it done: check the diff, PR or comments the run says it made.

## Known problems and fixes

| Symptom in a run summary | Cause | Fix |
| --- | --- | --- |
| `TypeError: unsupported operand type(s) for \|` | macOS Python 3.9 | Python shim and PATH prefix |
| `.git/index.lock` or `FETCH_HEAD`: Operation not permitted | Sandbox locks git data | Git dirs as writable roots (built in) |
| `CODEX_RUN_*` absent | Codex strips env from its shell | `shell_environment_policy.inherit=all` (built in) |
| A tool can't write its cache or lock under `~` | Sandbox | Add the path to `CODEX_RUN_WRITABLE_ROOTS` |
| Chromium exits on Mach-port registration | Sandbox | Unsolved; no screenshots unless Jackson approves `danger-full-access` |
| `rc=1` with an empty log | `ccr` drops a prompt argument of about 1,000 characters or more | Brief goes on stdin (built in) |
| `502 All target providers failed` | Gateway or upstream; cause not yet confirmed | Resume the run later; report if persistent |
