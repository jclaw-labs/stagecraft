# PR screenshots (relay staging)

Image files here are uploaded to a public gist by
`.github/workflows/pr-screenshots.yml` and embedded in the PR body via
`<!-- screenshot:NAME -->` placeholders, then dropped by the workflow's
`[skip ci]` cleanup commit.

IMPORTANT (cloud sessions): commit these files with the GitHub API
(`mcp__github__push_files`), NOT `git push`. A cloud session's `git
push` is authored by a token whose pushes do not spawn Actions runs, so
the relay workflow never fires. An API commit does trigger it.
