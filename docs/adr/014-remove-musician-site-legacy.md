# ADR-014: Retire the Legacy Musician-Site Template

## Status
Accepted

## Context
ADR-007 rebuilt the musician-site template on Next.js + Puck and renamed the
original Astro + Keystatic template to `templates/musician-site-legacy/`, with
the explicit plan that legacy "stays operational until the new template reaches
parity." That coexistence was always meant to be temporary.

Carrying two templates is a standing cost that compounds:

- **Duplicated conventions.** `CLAUDE.md` maintains a whole legacy section (§6)
  plus a separate per-location design-token source (§7); the enum/schema
  single-source-of-truth rules are effectively doubled.
- **Separate build + dependency surface.** Legacy has its own
  `package-lock.json`, its own CI job, and — as of the dependency-hardening
  work (PR #270) — its own Dependabot config and release-age cooldown. Every
  supply-chain or dependency-automation change now has to reason about two
  different (Astro vs Next.js) toolchains.
- **Split tooling.** The `recreate-artist-site` and `crawl-artist-site` skills,
  the `create-pr` build helper, and the platform's migrate-site job all target
  the legacy template.

Continuing to invest maintenance in a superseded template dilutes effort that
belongs on musician-site.

## Decision
Remove `templates/musician-site-legacy/` and consolidate on
`templates/musician-site/`.

Removal is **gated on retargeting or retiring the legacy template's consumers** —
deleting the directory while anything still points at it breaks those paths
(most importantly the platform's migrate-site job, whose `TEMPLATE_DIR` *is* the
legacy template). The work proceeds consumers-first, deletion-last:

1. **Migrate flow (gating prerequisite) — retarget to musician-site.**
   `apps/web/src/lib/jobs/migrate-site.ts` (its `TEMPLATE_DIR`) and
   `apps/web/src/lib/migration/mapper.ts` currently target the legacy
   Astro/Markdoc layout. The migrate-an-existing-site feature is **kept** and
   retargeted to musician-site: point `TEMPLATE_DIR` at
   `templates/musician-site/` and rewrite the mapper to emit Puck JSON (and the
   Next.js deploy config) instead of Astro `src/content/*`. The mapper rewrite
   is the bulk of the work and is the gating prerequisite — legacy cannot be
   deleted until the migrate flow no longer reads from it. Lands as its own
   change.
2. **Skills.** Repoint or retire `recreate-artist-site` and `crawl-artist-site`
   (both aim at the legacy template) and drop the legacy branch of the
   `create-pr` build helper.
3. **Platform code.** Drop `"musician-site-legacy"` from the `ArtistTemplate`
   union (`apps/web/src/lib/site-scaffold.ts`) and update the
   `template-reader.ts` / `iframe-utils.ts` comments that reference it.
4. **CI.** Remove the `musician-site-legacy` job and its entry in the
   `security-audit` audit loop and cache paths.
5. **Docs + conventions.** Remove `CLAUDE.md` §6 and the legacy entries in §7
   and the repo-structure block; mark the legacy references in ADR-003,
   ADR-007, and ADR-009 as superseded by this ADR.
6. **Delete** `templates/musician-site-legacy/` once 1–5 land.

## Consequences
- **One template to maintain.** Simpler `CLAUDE.md`, one fewer CI job and
  lockfile, and a single template in the Dependabot/cooldown surface.
- **The migrate-from-existing-site feature is retained** and retargeted to
  musician-site (Puck JSON). The mapper rewrite is the main implementation task
  and the gating prerequisite for deletion; it lands as its own change.
- **Already-deployed legacy sites are unaffected.** Each deployed artist site
  is an independent copy in its own repo (ADR-007, ADR-008); removing the
  template from the monorepo does not touch them — they keep building from
  their own checked-in copy.
- **The crawl/recreate skills lose their target** until repointed at
  musician-site; until then they should be treated as legacy-only.
- **Recovery.** The template stays in git history if a reference is ever
  needed.

## Rejected alternatives
- **Keep both templates indefinitely.** Permanent duplication of conventions,
  CI, and dependency surface for a template ADR-007 already superseded.
- **Delete the directory now and fix consumers afterward.** Breaks the
  migrate-site job (and the skills) the moment the directory is gone.
  Sequencing is the point — consumers first, deletion last.
- **Retire the migrate-an-existing-site feature** instead of retargeting it.
  Rejected — the feature is kept so existing sites can still be migrated onto
  musician-site.
