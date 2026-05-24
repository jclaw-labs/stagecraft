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
| T1 | Retarget migrate-site flow to musician-site | ⛔ blocked — needs human design + validation | gating prerequisite; see below |
| T2 | Repoint/retire `recreate-artist-site` + `crawl-artist-site` skills; drop legacy branch of `create-pr` helper | 🔒 gated on T1 | same content-model dependency as T1 |
| T3 | Drop `"musician-site-legacy"` from `ArtistTemplate` union + comments (`site-scaffold.ts`, `template-reader.ts`, `iframe-utils.ts`) | 🔒 gated on T1 | `migrate-site.ts` still passes `"musician-site-legacy"` |
| T4 | Remove `musician-site-legacy` CI job + its `security-audit` audit-loop/cache entries | 🔒 gated on T1 | |
| T5 | Trim `CLAUDE.md` §6/§7 legacy sections + repo-structure block; mark legacy refs in ADR-003/007/009 superseded | 🔒 gated on T6 | |
| T6 | Delete `templates/musician-site-legacy/` | 🔒 gated on T1–T5 | destructive; last |

## T1 — why it's blocked (the gating task)

`migrate-site.ts` reads `templates/musician-site-legacy/` as its
`TEMPLATE_DIR` and `migration/mapper.ts` converts crawled content into the
**legacy Astro/Markdoc** shape:

- `src/content/config/{site,nav,theme}.json`
- `src/content/pages/{home,about,music,press,contact}.md` (frontmatter + Markdoc)

musician-site stores content completely differently (unified collection
model, ADR-009):

- Pages are item JSON at `src/content/collections/pages/items/<slug>.json`,
  with field-wrapped `values` and a `fld_pages_body` of `type:"puckContent"`
  holding a **Puck `Data` tree** — nested `Section` → `Heading` / `RichText`
  / `Button` / `Eyebrow` / … blocks whose prop schemas are defined in
  `src/puck/config.tsx`.
- Plus collection scaffolding (`_collection.json`, `items/_order.json`,
  `_singleton.json`) for site/header/appearance and the
  releases/tour-dates/posts/photos/videos/store-items collections.

So a retarget is **not an edit to the mapper** — it's building a
**crawled-HTML → Puck-unified-collection importer**: generate valid Puck
block trees (matching `config.tsx`), the field-wrapped item values, IDs
(`item_*`, `fld_pages_*`, block ids), and the collection files. It also
needs `migrate-site.ts`'s `TEMPLATE_DIR` + deploy config changed (Astro
`dist` → Next `.next`) and a full mapper-test rewrite.

**Why not auto-merged now:** the generated Puck content can't be validated
in this environment (no Puck runtime / no way to exercise the migrate flow
and confirm pages render and are editable). Shipping a speculative importer
to `main` risks silently breaking the migrate feature. This task needs a
human-owned design pass and real validation against a crawled site.

**Suggested approach when picked up:** define a small set of target Puck
blocks the importer emits (hero `Section` + `Heading` + `RichText` +
`Button`, then prose `RichText`), derive their exact prop shapes from
`templates/musician-site/src/puck/config.tsx` and a seeded example
(`pages/items/home.json`), build the item/collection writers off
`apps/web/src/lib/.../content` helpers, and validate by running a migrate
against a real site and opening `/admin`.
