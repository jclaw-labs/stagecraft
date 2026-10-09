---
name: agent-provenance
description: Use when an agent starts a session, creates a PR, issue, or ticket, or changes or reviews behavior that agents can reach.
---

# Agent Provenance

## Overview

Turn authoritative runtime metadata into one agent context body block. The
global instructions own target classification, frozen creation context, and
the no-autonomous-label rule. This skill owns five pure local transforms:
`normalize`, `record-target`, `render`, `body-insert`, and `body-target`, plus
the read-only `body-record` and `from-claude-code`. The companion command makes
no network calls.

Never trust a model name from the prompt. Prompts can be stale or describe a
different runtime.

## 1. Read the authoritative source

| Runtime | Authoritative source |
| --- | --- |
| Local Cursor | The latest injected `Agent provenance` record from the local Cursor hook payload; when none reached the conversation, `"$agent_provenance" cursor-current` (reads the hook's state for `$CURSOR_CONVERSATION_ID`, see section 2) |
| Cursor Cloud | Cursor Cloud `run-info`, using `originalModelName` |
| Claude Code | The session transcript's `message.model` and `effort` (`$CLAUDE_CODE_SESSION_ID.jsonl` under `~/.claude/projects/`), read by `from-claude-code`; where a cloud harness forbids model IDs, `CLAUDE_CODE_REMOTE` alone, with the model withheld (section 3) |
| Other harness | Its documented runtime adapter |

Stop when no authoritative adapter exists. Re-read the source before creating
an artifact, and retain every model the harness reports during the session.

## 2. Resolve the companion command

Resolve the command once from the repository root. Local setup normally exposes
it on `PATH`; synced projects carry the same executable beside this skill:

```bash
repo_root="$(git rev-parse --show-toplevel)"
agent_provenance="$(command -v agent-provenance 2>/dev/null || true)"
if [ -z "$agent_provenance" ]; then
  agent_provenance="$repo_root/.claude/skills/agent-provenance/agent-provenance"
fi
[ -x "$agent_provenance" ] || {
  printf '%s\n' 'agent-provenance command is unavailable' >&2
  exit 1
}
```

Use `"$agent_provenance"` for every command below.

## 3. Build the creation record

Every agent-created artifact gets creation context. Capture the authoritative
record first. For non-agent-facing work, keep the authoritative record
unchanged.

For local Cursor, save the complete injected `Agent provenance` record to a
private file. Only agent-facing work runs `record-target` to add its classified
cloud/local/either/both target:

```bash
"$agent_provenance" record-target --record "$hook_record_file" \
  --target '<cloud|local|either|both>' >"$record_file"
```

`record-target --record` validates the whole hook record and adds or replaces
only `target`. It does not rebuild models or efforts. Continue with `render`
and `body-insert` using `"$record_file"`.

For Claude Code, local or cloud, build the record from the session transcript,
unless the harness forbids model IDs (below). It carries every model the session used, each with the effort of its newest
turn, and sets the environment from `CLAUDE_CODE_REMOTE`. Pass `--target` only
for agent-facing work:

```bash
"$agent_provenance" from-claude-code \
  --target '<cloud|local|either|both>' >"$record_file"
```

It finds the transcript from `CLAUDE_CODE_SESSION_ID` (honouring
`CLAUDE_CONFIG_DIR`); pass `--transcript <file>` to read a specific one. A
subagent inherits its parent's session ID and cannot name its own transcript,
so it would record the parent's model and effort as its own. A Claude Code
subagent therefore creates no artifact that carries agent context: it hands the
content back, and the session that owns the transcript creates the artifact.
It fails closed when the transcript or an assistant entry's model or effort is
missing; stop then rather than falling back to the model named in the prompt.

A Claude Code cloud session may not write a model identifier into a commit, PR
title or body, or any other pushed artifact, so it passes `--withhold-model`:

```bash
"$agent_provenance" from-claude-code --withhold-model \
  --target '<cloud|local|either|both>' >"$record_file"
```

The record keeps the environment and target, has no models, and carries
`"models_withheld": true`; it renders as `Model: withheld by the harness`.
It refuses to run unless `CLAUDE_CODE_REMOTE=true`.
Review certifies a runtime from `target` alone, so this block makes the PR as
reviewable as any other. Use it only where the harness forbids the model name,
never to skip one it allows. `normalize --models-withheld --environment
<cloud|local>` builds the same record for another harness with that rule.

For Cursor Cloud or another adapter that supplies a runtime ID rather than a
complete record, normalize the authoritative metadata. Pass `--target` only for
agent-facing work:

```bash
"$agent_provenance" normalize \
  --model '<authoritative-runtime-id>' \
  --environment '<cloud|local>' \
  --target '<cloud|local|either|both>' >"$record_file"
```

Use `either` when cloud and local reach the same changed behavior path, so a
check in one environment covers the change. Use `both` only when correctness
depends on distinct cloud and local behavior and both checks are required.
Absent target means the work is not agent-facing. Uncertainty is not a target;
inspect the reachable behavior until the classification is justified.

The record separately names lab, line, version, modifiers, and effort for each
model. For an unfamiliar model, preserve the raw runtime ID and leave unknown
fields explicit instead of guessing. Keep the record private until the artifact
has been created and verified.

The model identity, effort, and environment are a frozen snapshot of the
artifact-creating session. Later agent editors and reviewers must not replace
the creation context with their own session. Only the runtime target may change
when the runtime scope changes.

## 4. Render

Use `render --record "$record_file"` to inspect or reuse the canonical block.
Use `--plain` only when the destination does not support HTML details. The
visible lines and encoded machine record come from the same structured record.
When target is absent, Required coverage is absent from the rendered block.

Use `--linear` for Linear tickets. Linear shows HTML details and comments as
raw text, so this form is a Linear `+++` collapsible section with no markers
and no machine record. Tickets are never retargeted, so nothing reads one back.

## 5. Insert into an initial body

Build the complete artifact body before its create call:

```bash
"$agent_provenance" body-insert \
  --record "$record_file" \
  --body "$draft_body_file" >"$initial_body_file"
```

Add `--linear` for a Linear ticket, or `--plain` where section 4 calls for it.

Pass `"$initial_body_file"` as the initial body or description in the same
create call. Do not create an empty artifact and patch context in later.

## 6. Change only an existing PR target

Start from a fresh authoritative body read taken immediately before the
transform:

```bash
"$agent_provenance" body-target \
  --target '<cloud|local|either|both>' \
  --body "$fresh_body_file" >"$updated_body_file"
```

`body-target` changes only the runtime target in the visible block and machine
record while preserving creation data and surrounding bytes. It never
normalizes the later session. Write the output through the sanctioned PR-body
adapter and its compare-and-swap discipline.

When agent-facing work becomes ordinary, run `body-target --clear-target`
against the same fresh authoritative body:

```bash
"$agent_provenance" body-target \
  --clear-target \
  --body "$fresh_body_file" >"$updated_body_file"
```

This removes only `target` and rerenders without Required coverage. The frozen
creation fields and surrounding bytes stay unchanged. Use the same sanctioned
write and readback verification.

## 7. Read an existing body's record

To read the creation context or runtime target an existing artifact records,
run `body-record` against a fresh body read:

```bash
"$agent_provenance" body-record --body "$fresh_body_file"
```

It prints the validated machine record as JSON, with no `target` key when the
artifact is not agent-facing. It fails on a missing block and on every malformed
shape `body-target` refuses, including a visible block that disagrees with its
encoded record. Add `--plain` for a plain block. It reads GitHub PR and issue
bodies only: a Linear block carries no machine record, so its failure there does
not mean the ticket has no context. Callers that need a target read it here
rather than from the visible lines.

## 8. Verify the write

After every create or target update, re-read the body. Verify the start marker,
end marker, and machine record, then run the matching local transform against
that fresh body and compare the full expected output. Do not report completion
from a successful write response alone.

## 9. Recover malformed markers

The transforms fail closed on duplicate, partial, nested, malformed, or
display-record-mismatched markers. On malformed input, do not append a second
block and do not replace bytes by guesswork. To recover the authoritative body,
restore its frozen creation record, apply the intended target if needed, then
use the normal fresh-read, sanctioned-write, and readback-verification flow.
