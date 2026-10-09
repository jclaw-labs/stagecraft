---
name: pr-body-rules
description: Rules for what goes in a pull request body when it belongs to a stack, and for writing any body back without destroying edits the author made in the browser, since `gh pr edit --body` replaces the whole body with no conflict detection. Use whenever you edit, revise, tighten, or rewrite a PR body, tick a checkbox in one, splice screenshots into one, add or refresh the stack outline, or backfill a checklist item across a stack — and to recover a body that was clobbered.
---

# PR bodies: what goes in one, and how to write it back

Single source of truth for two things: the stack content every PR in a stack carries, and how to write back any body safely. The skills that actually do the writing — `create-pr`, `capture-pr-screenshots`, `merge-stack`, `refresh-stack` — point here rather than restating these rules.

For stack-outline commands, derive `<pr-body-rules-skill-dir>` from the path used to read this
`SKILL.md`, then derive its sibling `<create-pr-skill-dir>` as
`<pr-body-rules-skill-dir>/../create-pr`. Use `pr-stack-section` when it is available on `PATH`;
otherwise invoke `bash <create-pr-skill-dir>/pr-stack-section`. The sibling carries its required
`lib/restack-common.sh`, including in a fresh personal-project vendor.

## Why this needs a rule

**`gh pr edit --body` replaces the entire body.** There is no patch API and no compare-and-swap: whatever you send becomes the body, so any edit you didn't fetch is destroyed silently. The user edits bodies in the browser often, including while you're mid-task, and you both write through the same GitHub account — so GitHub reports no conflict, keeps no merge, and neither of you gets a warning.

This has already cost two rounds of the user's writing: a checkbox tick that re-applied a body fetched half an hour earlier, and a screenshot splice that landed three seconds after a browser save. Both times the agent's change itself was correct and tiny. What did the damage was the text it carried along with it.

## The rules

Every write, without exception:

1. **Take an authorizing pre-write snapshot immediately before the write.** Not at the start of the step, not before you asked the user a question — right before. Any body file already sitting in `/tmp` from earlier in the session is stale by definition; refetch instead of reusing it. `guard-pr-body-clobber.sh` sees literal shell command text, not process boundaries: a command substitution, `bash -c`, or a pipeline primes it when the literal `gh pr view … --json body` remains visible in the shell tool call. A helper script or language runtime that constructs argv and hides that literal read does not prime the guard. Internal scripts and tools do not receive this shell-guard snapshot protection. A hidden body writer must implement its own immediate freshness check or compare-and-swap. `pr-stack-section` does not currently do that: it fetches, transforms, and then writes without rechecking, so it can race with a concurrent browser edit.
2. **Edit the text you just fetched.** Apply your change as a targeted transformation of that exact string — replace the one line, the one section, the one `- [ ]` — and send the result. Never assemble a fresh body from your own draft or from your memory of what the body said; that's what turns "tick a checkbox" into "revert the user's rewrite".
3. **Diff against what you last saw.** If you've fetched this body before in the session and it now differs in ways you didn't make, the user edited in between. Their version is the base: re-apply just your own change on top of it, and say so in your reply. Compare with `diff -q <saved> <fresh>` against the copy you kept, not with a byte count — `wc -c < file` pads its output with spaces, so the obvious `[ "$(wc -c < f)" = "5421" ]` is false for a file that is exactly 5421 bytes and reports a clobber that never happened.
4. **Treat the screenshot flow as a guaranteed race.** After you've asked the user to drag-drop images, you have literally sent them to the pencil. Fetch after they say they're done, and write immediately.
5. **Use non-authorizing post-write verification.** Read the live body through the strictly read-only API command below and confirm it has both your change and everything else that was there. This verification must not prime the clobber guard for a later write: do not use the authorizing `gh pr view … --json body` shape here. If verification fails, someone wrote between your fetch and your write — recover per below.

Snapshot, write, and verify with:

```bash
gh pr view <number> --json body --jq .body

CREATE_PR_SKILL=1 gh pr edit <number> --body "$(cat <<'EOF'
<new body>
EOF
)"

gh api repos/<owner>/<repo>/pulls/<number> --jq .body
```

The `CREATE_PR_SKILL=1` prefix is required on every `gh pr edit` — a `beforeShellExecution` guard (`guard-pr-via-skill.sh`) denies bare invocations. Use the single-quoted heredoc with no escaping: write ` ```bash ` and backticks plain.

A second guard (`guard-pr-body-clobber.sh`) doesn't look at what you're writing. It fetches the live body and compares it with the snapshot your last read took. It denies a write when there's no snapshot, when the live body has changed since that read, or when one command mixes body reads and writes. Each allowed write uses the read up, so the next write needs a fresh read, with two exceptions. A `gh pr edit` missing the `CREATE_PR_SKILL=1` prefix keeps the read, because `guard-pr-via-skill.sh` denies it, so the marked retry passes. And after a `--body-file` write from a regular file (not stdin), run as a command on its own, lands, the next write passes as long as the live body still equals that file. A write some *other* hook denies still uses the read up, so read again before retrying it. When a write is denied, refetch, re-apply your change to the fresh text, and write again. When a read can't fetch the body, the guard says no snapshot was taken. When a write can't fetch it, or can't tell which PR, issue or repo the write names, the guard denies the write rather than let it through unchecked. It logs each decision with its reason to `${TMPDIR:-/tmp}/pr-body-guard/decisions.log`.

## Stack content in a body

Two things in a body describe the stack a PR belongs to. Both are the *same facts* repeated in every PR of that stack, so neither is authored per-PR.

### The stack outline — generated, never hand-written

Every PR in a stack carries a `## PR stack` block drawing the whole stack, so a reviewer who lands on one PR can see the shape and where this one sits — including the parts that have already landed. It's drawn as a tree growing *upward*, one PR per line: the trunk anchors the foot of the drawing and the tip of the stack sits at the top, the same orientation as GitHub's own stack map. Two PRs based on the same branch are a fan-out, rendering as siblings at the same level. Each PR is a node on the rail, and each glyph means exactly one thing:

- **✓** landed
- **✗** closed without landing
- **○** still open
- **●** the one you're reading, whatever its state

So exactly one node is ever filled, and it's always the one you're looking at. Nothing is lost under a ●, because each entry is a bare PR URL and GitHub expands those into rich links carrying the title *and* the live merged/closed icon — which is also why the block holds no titles of its own, and why a retitle or a merge needs no re-run to stay honest. Every PR in the stack gets the same tree; only the ● moves.

**The trunk line is a waterline, not a heading.** Everything below it has landed *into* it; everything above is still stacked *on* it. So it rises through the drawing as the stack lands, and when the last PR merges it disappears — at that point the stack simply *is* the trunk, and a line saying so adds nothing. With nothing merged yet it sits at the very bottom, under the whole stack:

```
nothing landed yet    #100 has landed     the lot has landed
○ #102                ○ #102              ● #102
○ #101                ● #101              ✓ #101
● #100                main                ✓ #100
main                  ✓ #100
```

It's drawn only where it's true, which takes two conditions: every landed PR has to be below it, and no fork may be open across it (the trunk row is unindented, so mid-fork it would cut the `│` rail passing through). Neither can fail in a linear stack. In the rare fan-out where one does — an arm partly landed while its sibling isn't — the line goes back to the bottom and the ✓ glyphs carry the state on their own.

**A long block folds two kinds of rows it doesn't need to draw in full.** Each fold is one row, every PR in it stays a link in that row, and the record line still carries every edge, so folding changes only what's drawn:

- **Merged history.** Every landed PR nothing open is stacked on, plus the landed PRs under the point where the open PRs meet. Once that's three or more, they draw as one row under the trunk line: `✓ 4 merged: #203 #202 #201 #200`. It doesn't matter whether they form a straight foot or a stack that fanned out and then landed, so whole landed arms go into the row too. The tree above it is redrawn from the point where the open PRs meet. If that PR has landed, it stays drawn as the root the open arms fork from. Above that point, a landed PR that still has an open PR on it stays drawn, and so does anything stacked on the PR you're reading.
- **Far arms.** When an arm of two or more PRs forks off two or more fork levels out from the trunk (its root has its own connector), counted in the whole stack even after the merged history has folded, and holds neither the PR you're reading nor its ancestors, its siblings or anything stacked on it, it draws as one `⋯` row at its root's position, keeping the rail and connector that root is drawn with: `⋯ 2 PRs: #305 #303`.

The PR you're reading and its open neighbours are never folded, and a one-PR arm isn't either, since its fold row would be no shorter. The thresholds are `MERGED_FOLD_MIN` and `DEEP_FOLD_DEPTH` in the script.

```bash
pr-stack-section <pr-number | branch>           # resolve the chain, print the block
pr-stack-section --apply <pr-number | branch>   # write it into every PR in the chain
```

Point it at **any** PR in the stack — it walks down to the bottom and then back up over every branch above it, so there is no "run it on the right one". A merged PR is a fine starting point too. `--apply` rewrites nothing when the block is already current, so re-running it is free. Run it after anything that changes the stack's *shape*: opening a PR onto another, merging one, reordering, or retargeting a base.

- **The block remembers, because GitHub forgets.** The shape comes from base refs, and a merge destroys them: the parent's branch is deleted and the child is retargeted onto trunk, so nothing in the API can still say the two were ever stacked. So the block carries its own record of the tree, as a line of PR-number edges in an HTML comment inside it — `<!-- pr-stack-tree: 100:0 101:100 102:101 -->`, meaning "child:parent", `0` being the trunk. Every PR in the stack carries the same record, so any one body recovers the whole tree; each run unions what it reads with what the live base refs say and writes the union back. The record is only read from *inside* the markers, so a body is free to quote or document the format in its prose without inventing edges out of the example.
- **So run `--apply` when you *open* the stack, not just when you land it.** A stack only has the history that was recorded while its base refs were still intact. Nothing reconstructs it after the fact.
- **A live base ref beats the record**, which is what keeps the memory from becoming a straitjacket: retarget a PR and it really moves. The recorded parent is believed only once that parent has stopped being open — precisely the merge-retarget case, and not a PR you detached on purpose.
- **Merged PRs stay for good; closed ones don't.** A closed PR drops out of the tree as soon as nothing is stacked on it (and `--apply` strips its block), so closing a PR is how you take a dead arm out of the picture. A closed PR that still has a child stays, because the child's base really does point at it.
- **Never write or edit the block by hand.** It sits between `<!-- pr-stack-section … -->` markers and is replaced wholesale on the next run, so a hand edit is lost — and hand-editing the record line corrupts the one copy of the history. To change what it says, change the script; that's what makes it one source of truth instead of N copies.
- **Every entry has to be a bullet.** GitHub only expands a bare PR URL into a rich link — status icon, title, number — inside a list item. A table cell or a `<br>`-joined paragraph collapses it to a bare `#1234`. That's why the tree is drawn *inside* the bullets: plain `&nbsp;` for the indent, then a `<samp>` run holding the rails, the connector and the node, which keeps them aligned without the gray pill a code span would paint over them. Don't rebuild it as a table.
- **Only a fork indents.** A PR stacked singly on its parent sits at the same column with no connector, so a linear stack never drifts right however deep it gets. A `├─`/`┌─` connector appears if and only if a branch starts on that line, which is what keeps two children of one PR from reading as a chain, and vice versa. The corner is `┌─` rather than `└─` because the drawing runs upward: it belongs to the arm furthest from the fork and turns back down toward it.
- **It goes at the top: under the tracker line, above the Summary.** Position is generated too, not chosen per-PR — each run strips the block from wherever it sits and re-inserts it there, so one that ends up further down gets moved back rather than left behind. A body with no tracker line gets it as the very first thing.
- **A PR that was never in a stack loses its block** on the next `--apply`, so a lone PR never advertises a stack that doesn't exist. One that *was* in a stack keeps it — that's the history.
- The script touches only the marked region, but its internal reads and writes are hidden from `guard-pr-body-clobber.sh`, and its apply loop currently fetches each body once before transforming and writing it unconditionally. It is not safe against concurrent browser edits. Do not race `pr-stack-section --apply` with browser edits until the structured-write tool gap is fixed.

### The stack checklist items — kept by hand

Separately, every PR in a stack carries these in the template's `## Checklist`, prepended above the template's own items (which always stay):

1. **Merge mechanism** — on every PR in the stack, character-for-character identical so it stays detectable:

   ```
   - [ ] Merge this stack with the `/merge-stack` skill
   ```

   It flags that the stack lands via the `merge-stack` skill — merge the bottom, rebase the rest — rather than PR-by-PR, which would orphan the children.

2. **Dependency blocker** — only on a PR that sits on another *open* PR:

   ```
   - [ ] Merge <parent-PR-URL>
   ```

   Full GitHub URL, not `#NNNN`, so it's clickable everywhere. This makes the merge dependency a hard, visible blocker instead of a buried mention in the Summary.

Backfill a missing item on any open PR in the chain: a stack opened without `create-pr`, or one that grew a child later, still needs the reminder. Don't duplicate an item that's already there, and don't otherwise rewrite that PR's body. Tick the blocker when the PR it names merges, and repoint it when a mid-stack merge changes which PR this one waits on. Each of those is a whole-body overwrite, so follow the rules above — a stray checkbox tick built from a stale copy is how the user's own rewrite got wiped once already.

## Recovering a body you clobbered

GitHub keeps every revision of a PR body, so a clobbered version is recoverable — never ask the user to retype what you overwrote.

```bash
gh api graphql -f query='
{ repository(owner:"<owner>", name:"<repo>") {
    pullRequest(number:<N>) {
      userContentEdits(first:10) { nodes { editedAt editor { login } diff } } } } }' \
  --jq '.data.repository.pullRequest.userContentEdits.nodes[] | "\(.editedAt)\t\(.diff | length)"'
```

The details here are verified and none of them are guessable:

- **`diff` holds the full body text of that revision**, despite the name — so the listing above (timestamp + length) is how you pick a revision, and swapping the `--jq` for `'…nodes[1].diff'` writes that version out whole.
- **The connection is ordered newest-first**, so `first:N` gets the recent edits and `last:N` gets the oldest ones. A previous session used `last:` and concluded the history was broken, when it was reading edits from days earlier.
- **The newest node is the current live body**, so the version you clobbered is normally the node right after it. If the newest node doesn't match the live body, the history is lagging — trust the live body and look one further back.
- **`editor.login` cannot tell you who wrote what.** Your edits and the user's both show as their account. Discriminate by line endings instead: GitHub's web editor saves CRLF (`\r\n`), `gh pr edit` writes LF. A CRLF revision is theirs.
- The body as originally created isn't in the history — only edits made after creation.

Then reconcile rather than revert: re-apply your change on top of their recovered version, and report what you restored and what you re-applied.
