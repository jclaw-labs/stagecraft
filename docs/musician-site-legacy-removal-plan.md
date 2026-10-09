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
| T1 | Retarget migrate-site flow to musician-site | ✅ done | PR #277 |
| T2 | Retire the legacy recreation skills (`recreate-artist-site`, `evaluate-artist-site-recreation`, `artist-site-pipeline`); de-legacy `crawl-artist-site` + `create-pr` | ✅ done | this PR — `crawl-artist-site` kept (generic), reframed |
| T3 | Drop `"musician-site-legacy"` from `ArtistTemplate` union + comments | ✅ done | PR #278 |
| T4 | Remove `musician-site-legacy` CI job + its `security-audit` audit-loop entries | ✅ done | PR #278 |
| T5 | Trim `CLAUDE.md` §6/§7 legacy sections + repo-structure block | ✅ done | this PR — §6 removed, §7→§6; historical ADRs left intact (ADR-014 supersedes) |
| T6 | Delete `templates/musician-site-legacy/` | ✅ done | this PR |

## Completion notes

**Done.** `musician-site-legacy` is removed: the legacy Astro template, its CI
job, the legacy migration mapper (replaced by `musician-site-mapper.ts`, which
emits unified-collection overlay files reusing create-site's provisioning), the
`ArtistTemplate` legacy member, and the legacy recreation skills
(`recreate-artist-site`, `evaluate-artist-site-recreation`,
`artist-site-pipeline`) are all gone; `crawl-artist-site` + `create-pr` are
de-legacied. Historical ADRs (003/007/009) are left intact — ADR-014 supersedes
them on the record rather than rewriting history.

**Why deleting the template was safe without a live check:** #277 already
removed the legacy *migration path* (the old mapper), so the remaining
`musician-site-legacy/` directory was an orphan — used only by the
now-retired recreation skills + docs, not a live fallback. The deletion is
fully git-reversible.

**Still worth a human check (independent of the removal):** the new migrate
flow's generated Puck content + Netlify/Vercel deploy can't be exercised in CI.
Run a real migration and open `/admin` + the deployed site to confirm pages
render and are editable. If it needs fixing, that's a forward fix on
`musician-site-mapper.ts` (the legacy fallback is in git history if ever needed).

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
- **Required-check stub.** Done (#306). `Template (musician-site-legacy)` was
  dropped from the required status checks on `main`, and the no-op stub job
  in `.github/workflows/ci.yml` that kept it green was deleted.
