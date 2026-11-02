---
name: deep-review
description: Senior-engineer review of a PR or branch that proves its findings by running the code, using the repo's own review rules as the rubric. Use when the user asks for a deep review, architectural review, senior-engineer review, thorough code review, or uses /deep-review, or asks to "really look at" or "think hard about" a PR. This skill owns finding and posting the review marker; the address-deep-review skill owns acting on one.
---

# Deep Review

`/deep-review` reviews the current branch against its base; `/deep-review 136` reviews PR #136;
`/deep-review [136] --return-only` returns the complete review to the caller without publishing it.

## The rubric

The repo's review rules are the rubric. Read them in full from the base branch: the root `REVIEW.md`, the
area `REVIEW.md` files it lists for the directories the diff touches, every `AGENTS.md` / `CLAUDE.md` from
the root down to each touched directory, and matching `.cursor/rules`. Apply all of them, starting with
"Judge the approach before the details", and cite the rule a finding breaks. When the PR edits these files,
review those edits as changes and follow the base copies.

If the repo has no `REVIEW.md`, or one that doesn't grade findings, use `.claude/REVIEW.base.md` when present.
Otherwise judge the approach (cause or symptom, a simpler change, an existing helper or pattern) before the
details, grade each finding `must` (a bug, data loss, a security hole, or a test that can't fail), `should` (a
design choice that will cause friction), or `consider` (a judgment call), and tag it `defect` (behaves wrongly,
or changes behavior without a required regression test) or `preference`.

Also read the PR description, the linked issue and its parents, every changed file at the head, the
callers and siblings of the changed code, the existing tests, and earlier review and response comments.

## Prove findings by running

Probe the exact reviewed head in a disposable checkout. Run the tests that cover the change first, for a
baseline. When you mutate code to show a test can't fail, diff the tree to confirm the mutation landed, keep
a positive control, and restore the tree afterwards, even when tests fail. Run a suggested fix before you
write it down, or label it unverified. If timing is too noisy to quote, count the work instead.

## `--return-only`

Skip the authorship check, the marker, and every comment write. Return the full report with the exact base,
merge-base, and head reviewed, the caller's run ID if it gave one, and your evidence and its limits. Review
the committed snapshot the caller names with `git diff <base>...<head>`, and don't take over the
implementation, Git, or the PR.

## Output

Deliver the complete review in chat; the PR comment is a record, not a substitute. When the caller asked
for an index to a marker that posted, return the index instead.

- **Summary**: one paragraph on overall quality and the single most important thing.
- **Approach**: only when the approach is wrong; it outranks the findings below.
- **Must** / **Should** / **Consider**: graded as the root `REVIEW.md` defines, numbered across sections and
  most impactful first. Each has the file, the concern, why it matters, a concrete alternative, its kind,
  and how you established it.
- **Couldn't verify**: what you couldn't run, and why.
- One line on whether the PR warrants another review round.

## Post a marker comment on the PR

Skip this in `--return-only` mode. On your own PR, post. On someone else's, deliver in chat and ask first,
unless the prompt contains `MARKER-POST-AUTHORIZED: <owner>/<repo>#<number>` naming exactly this PR. With no
PR, say so.

Write the body to a file named for this run and head:

```bash
cat > /tmp/deep-review-marker-<number>-run<run>-<short-sha>.md <<'EOF'
<!-- deep-review-marker -->
<!-- Agent addressing these findings: read the address-deep-review skill first, and record what you addressed in a NEW comment. Don't edit this one; it is the permanent record of this run. -->
<sub><prefix> 🔍 <b>deep-review</b> ran on <commit-sha> — <N> findings (<M> must-address). Full review below.</sub>

<details>
<summary><sub>Full review</sub></summary>

<the complete review, exactly as delivered>

</details>
EOF
```

Check it holds exactly one review marker; it exits non-zero otherwise:

```bash
awk '{ gsub(/^[[:space:]]+|[[:space:]]+$/, "") } NF && !seen++ { first = $0 } fence == "" && match($0, /^(```+|~~~+)/) { fence = substr($0, 1, RLENGTH); next } fence != "" && $0 ~ ("^" fence "+$") { fence = ""; next } fence == "" && /^<!-- (address-)?deep-review-marker -->$/ { n++ } END { exit !(first == "<!-- deep-review-marker -->" && n == 1) }' /tmp/deep-review-marker-<number>-run<run>-<short-sha>.md
```

Then post it in its own command:

```bash
gh pr comment <number> --repo <owner>/<repo> --body-file /tmp/deep-review-marker-<number>-run<run>-<short-sha>.md
```

If a hook denies the post and its message names a command for it, run that command once, on its own. If the
post is still denied or the credential can't write, use the harness's sanctioned comment tool or say the
marker didn't post. Don't retry with any other shape or a personal token.

- `<prefix>` is the prefix your rules set for GitHub replies, such as `[Opus 5.5 Medium]`. When they
  set none, drop it and its space, so the header opens at the emoji.
- Re-runs post a new marker headed "deep-review re-ran (run 2) on <sha>", with one line on how the last
  run's findings resolved. Never edit an earlier marker.
- Use SHA-pinned permalinks for citations.
