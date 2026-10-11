# @jclaw-labs/musician-site

The Stagecraft musician site: the public renderer, the `/admin` CMS, the
API routes, and the content and image pipeline, for Next.js 15 and React 19.

An artist's site repo holds its content (`src/content/`), its images
(`public/images/`) and a shell of about ten files that re-export from this
package. Stagecraft creates the repo; don't install the package by hand.
The shell's source is
[`templates/musician-site-shell`](https://github.com/jclaw-labs/stagecraft/tree/main/templates/musician-site-shell),
and the design is
[ADR-016](https://github.com/jclaw-labs/stagecraft/blob/main/docs/adr/016-versioned-musician-site-package.md).

A site depends on an exact version, and takes patch and minor releases
through its Dependabot auto-merge, which merges an update only when
`next build` still passes. Major releases arrive as a pull request from
Stagecraft instead.

## Versioning

Releases follow semver, judged from the artist's repo (ADR-016 §3). Each
change records its level in [CHANGELOG.md](./CHANGELOG.md), and a release
takes the highest level among its changes.

A release is **major** when an artist's repo needs a change the package
can't make by itself:

- the shell changes: a new or renamed shell file, a changed export, or a
  new literal route config (`dynamic`, `dynamicParams`) or middleware
  `matcher`
- a new peer major (Next 16, React 20) or a higher Node `engines` floor
- a new **required** environment variable, or a renamed one
- dropping the reader for an old content `schemaVersion`
- a change to the on-disk layout of `src/content/` or `public/images/`
  that needs files moved

A major that changes the shell also raises `REQUIRED_SHELL_VERSION` in
`src/lib/with-stagecraft.ts` together with the shell's
`stagecraft.shellVersion`, so a site on an older shell fails `next build`
(and with it the Dependabot gate) instead of breaking at runtime.

Everything else is **minor** or **patch**:

- **minor**: new blocks, admin pages or endpoints, new optional
  environment variables, a new content upgrader (content migrates lazily,
  on read), and raising the `next` peer floor within the same major
- **patch**: fixes, including security fixes, and dependency bumps

`@jclaw-labs/content-upgraders` is released in lockstep, at the same
version.

## Release candidates

Prereleases (`1.1.0-rc.0`) publish to the `rc` dist-tag, never `latest`.
Stagecraft only creates sites on a release from `latest`: Dependabot keeps
offering prereleases to a site pinned to one. To try a candidate on a test
site, set its dependency to the exact `rc` version by hand.

## Releasing

Bumping `version` in this package and in `packages/content-upgraders` on
`main` publishes the release from GitHub Actions
(`.github/workflows/release-musician-site.yml`), after building the shell
on the packed tarballs with no lockfile. See `docs/runbook.md` §11 in the
repository.
