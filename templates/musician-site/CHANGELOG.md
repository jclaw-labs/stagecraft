# Changelog

Changes to `@jclaw-labs/musician-site`, for the people running sites on it.

Every pull request that changes `src/` (tests aside) adds a line under
`## Unreleased`, marked with the release it needs under the semver rules in
[README.md](./README.md#versioning):

```md
- patch: Fix the contact form's error message on a rejected address.
- minor: Add a Spotify embed block.
- major: Rename the API catch-all; sites need the new shell.
```

CI (`scripts/check-changelog.mjs`) fails a pull request that changes `src/`
without adding one. To release, move the Unreleased lines under a heading
for the new version, bumping by the highest level among them, in the same
pull request that bumps `version` (docs/runbook.md §11). Keep `src/` changes
out of that pull request: the lines move away from Unreleased, so the check
finds no new one.

## Unreleased

## 1.0.0-rc.0

- major: First release candidate. The musician-site template as an npm
  package, with the admin pages and API routes behind two routers and a
  shell of about ten files for the artist's repo (ADR-016).
