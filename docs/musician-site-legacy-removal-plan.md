# Musician-Site-Legacy Removal — Execution Plan & Tracker

Living checklist for carrying out **ADR-014** (retire
`templates/musician-site-legacy/`). The ADR is the decision; this file
tracks the work and records what's blocked and why.

Removal is **consumers-first, deletion-last**: nothing about
`musician-site-legacy` can be deleted until everything that reads from it
either retargets to `musician-site` or is retired.

## Status

| # | Task | State | Notes |
|---|------|-------|-------|
| T0 | ADR-014 accepted | ✅ done | PR #271 |
| T1 | Retarget migrate-site flow to musician-site | 🟡 implemented — pending live validation | this PR; see below |
| T2 | Repoint/retire `recreate-artist-site` + `crawl-artist-site` skills; drop legacy branch of `create-pr` helper | 🟢 ready (T1 done) | content path no longer needs legacy |
| T3 | Drop `"musician-site-legacy"` from `ArtistTemplate` union + comments (`site-scaffold.ts`, `template-reader.ts`, `iframe-utils.ts`) | 🟢 ready (T1 done) | no caller passes `"musician-site-legacy"` anymore |
| T4 | Remove `musician-site-legacy` CI job + its `security-audit` audit-loop/cache entries | 🟢 ready (T1 done) | |
| T5 | Trim `CLAUDE.md` §6/§7 legacy sections + repo-structure block; mark legacy refs in ADR-003/007/009 superseded | 🔒 gated on T6 | |
| T6 | Delete `templates/musician-site-legacy/` | 🔒 gated on T2–T5 | destructive; last |

## T1 — implemented (this PR), pending live validation

migrate-site now targets `templates/musician-site/`. A new pure mapper
(`apps/web/src/lib/migration/musician-site-mapper.ts`) emits unified-collection
overlay files — the site singleton + page items with `Section > Heading +
RichText` Puck bodies + `_order.json` — and the job reuses create-site's
deploy/env/broker provisioning to deploy the Next.js site (only the content
differs from a fresh create). The legacy Astro/Markdoc mapper is removed.

Output shapes are pinned to the template seeds and unit-tested; an independent
review confirmed they satisfy the template's Zod schema
(`templates/musician-site/src/lib/collections/schema.ts`) and Puck config, and
that the overlay replaces the demo seed page items at matching paths.

**Still needs human validation** — the Puck runtime and Netlify/Vercel deploy
can't be exercised in CI. Before relying on it in production, run a real
migration against a live site and open `/admin` + the deployed site to confirm
pages render and are editable.

### Deferred follow-ups (recorded, not done here)

- **Cross-package shape guard.** The mapper output is asserted by hand;
  `apps/web` doesn't depend on `templates/musician-site`, so nothing
  automatically catches drift if the template's Zod schema / Puck props change.
  A real guard needs the template schema shared (or an integration test that
  loads it). Until then, a template schema change can silently break migration
  with green CI.
- **Content fidelity.** v1 maps each page to one `Section` (a `Heading` + a
  single `RichText` of the joined paragraphs); images, embeds, and structured
  collections (releases, tour dates, etc.) are reported but not imported.
  Richer block mapping is a follow-up.
