# CLAUDE.md — `templates/musician-site-shell`

The artist-repo shell (ADR-016 §1): what an artist's site repo holds on
top of the `@jclaw-labs/musician-site` package. Everything else, including
the conventions for the code these files re-export, is in
`../musician-site/CLAUDE.md`.

- `src/content/` is the starter content new sites begin with. It is the
  artist's, so it lives here rather than in the package.
- Once a release of the package is on npm's `latest`, provisioning
  copies this directory into new site repos, without the monorepo-only
  files below and with the package pinned to that release. Until then it
  copies the full template plus this `src/content/`
  (`apps/web/scripts/generate-template-bundle.mjs`).
- Every other file re-exports from the package. Route config Next.js
  reads statically (`dynamic`, `dynamicParams`, the middleware
  `matcher`) stays a literal in the route file. Changing any of these
  files is a major release of the package: see "The artist-repo shell"
  in `../musician-site/CLAUDE.md`.
- `stagecraft.shellVersion` in `package.json` is this shell's version.
  `withStagecraft()` fails the build when it is older than the package
  requires.

## Monorepo-only

These exist so the shell runs the package from this checkout. A site
repo gets none of them: it installs the package from npm.

- The `file:../musician-site` dependency.
- `overrides`, which points the package's own
  `file:../../packages/content-upgraders` dependency at the monorepo copy
  (that relative path can't resolve from an installed copy).
- `.npmrc`: `install-links` installs a packed copy of the package with
  its dependencies in this `node_modules`, as a site gets from npm, and
  `package-lock=false`, since sites ship no lockfile.

## Running it

```bash
npm run shell:install   # at the repo root: build both packages, install them here
npm run dev             # here
```

The installed package is a snapshot of the build, so run
`npm run shell:install` again after changing the package. The template's
e2e suite and screenshot capture (`templates/musician-site`) run against
this shell.
