# PR screenshots (transient)

Cloud Claude Code sessions drop PR screenshots here. The
`.github/workflows/pr-screenshots.yml` relay uploads them to a per-PR
public gist, rewrites the PR body to embed the gist URLs, and then
removes this directory from the branch (the repo is private, so
in-tree / raw.githubusercontent URLs don't render anonymously in a PR
body). Nothing here is meant to live on `main`.
