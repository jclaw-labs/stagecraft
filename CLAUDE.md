# CLAUDE.md — Monorepo Coding Standards

Code-quality rules for the Stagecraft monorepo. These override general
defaults.

## Repo structure

```
apps/
  web/              Next.js platform app
packages/
  shared/           Cross-cutting types, enums, constants, utilities
  db/               Prisma schema + client
  queue/            Async job queue
templates/
  musician-site/         Next.js + Puck template (per ADR-007)
claude/
  skills/           Repo-only tooling skills (crawl-artist-site)
.claude/skills/     Agent skills vendored from local-config (do not edit here)
docs/
  adr/              Architecture decision records
  specs/            Product and technical specs
  screenshots/      PR screenshot convention (README.md)
  runbook.md        Ops + env setup
```

---

## 1. Narrow types — never `string` for fixed value sets

Any prop, field, parameter, or variable that accepts a **fixed set of
values** MUST use a TypeScript union — never `string`.

```ts
// Wrong
status: string

// Right
status: JobStatus          // from @stagecraft/shared
provider: 'github' | 'netlify'
```

- Check `packages/shared/src/types.ts` first. `JobStatus`, `JobType`,
  `EditMode`, `ChangeRequestStatus`, `SiteStatus`, `BlueprintType`,
  `IntegrationProvider`, `AssetUploadStatus`, `PreviewStatus`, and
  others already exist — import them.
- A union used in one file only can live locally; if it ends up in
  two, promote it to `packages/shared` (see §4).

---

## 2. DRY — don't repeat yourself

### Check before defining

Before writing a new type, enum, constant, or utility:

1. Check `packages/shared/src/`.
2. Check the app where the code will live.
3. Import what already exists.

### Extract when shared

If the same type / enum / constant / utility is needed in **more than
one file**, it MUST live in `packages/shared` and be imported
everywhere. No copy-paste across files.

### Use the shared UI component library

Use existing components rather than reimplementing patterns inline:

| Component      | Use for                                              |
| -------------- | ---------------------------------------------------- |
| `Button`       | All clickable actions — links, submits, icon buttons |
| `FormGroup`    | All form fields — never raw `<input>` / `<label>`    |
| `Image` (React)| Images inside React components                       |

Only build a new component if none of the existing ones fit.

### Extract generic helpers

Generic helpers (date formatting, string manipulation, validation,
error handling) belong in `packages/shared/src/` as utilities, not
local to one file.

---

## 3. Test coverage

Every PR must include tests for:

- **New utility functions** — unit tests for all exports.
- **API route handlers** — tested directly; success + error paths.
- **Non-trivial logic branches** — a case per meaningful branch.

### What tests cover

- Happy path (expected in → expected out)
- Error and edge cases (invalid input, missing fields, out-of-range)
- Boundary conditions

### Conventions

- **vitest** with relative imports, matching existing patterns.
- Co-locate: `foo.ts` → `foo.test.ts`.
- Skip trivial pass-through code (simple getters, re-exports).

---

## 4. Shared package (`packages/shared`)

### When to add

- Any type, enum, or constant used in more than one package or app.
- Any utility generic enough to be useful outside its origin file.

### How to add

1. Add the export to `packages/shared/src/types.ts` (for types / enums)
   or a new file (for utilities).
2. Re-export from `packages/shared/src/index.ts`.
3. Import via `@stagecraft/shared`.

```ts
// packages/shared/src/index.ts
export * from "./types.js";
export * from "./your-new-module.js";

// elsewhere
import { JobStatus, JobType } from "@stagecraft/shared";
```

### Don't

- Define shared types locally and import across package boundaries.
- Duplicate a type that already exists in `packages/shared`.
- Forget to add new exports to `index.ts`.

---

## 5. Pull requests

PRs that change rendered UI (marketing site, platform dashboard, or
artist-site admin) must embed screenshots from a public gist, since this
repo is private and in-tree / `raw.githubusercontent.com` URLs don't
render anonymously.

Full workflow in `docs/screenshots/README.md`: capture → upload to gist → embed
in PR body → verify URLs return 200. Refactor-only or backend-only
PRs may omit screenshots — note this explicitly in the PR body.

**Agents can capture every UI surface — public and authenticated alike;
there is no rendered UI you cannot screenshot.** A Chromium build ships
at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`), auto-detected by
`apps/web/capture/chromium.ts`, so a cloud session can always render the
app. Two capture paths, both detailed in `docs/screenshots/README.md` — pick by
what the PR touches:

- **Public / static pages** (marketing site `/`, `/examples`, …; public
  artist pages) need no database:
  `cd apps/web && npm run capture:screenshots:public`.
- **Authenticated platform pages** (dashboard, settings, site detail) are
  reached by seeding a NextAuth session row directly in the test database
  — no real OAuth needed. Bring the DB up, then run the harness:
  `docker compose up -d && npm run db:migrate`, then
  `cd apps/web && npm run capture:screenshots`. The session seed lives in
  `apps/web/capture/setup.ts`.

"It's behind auth" and "docker wasn't running" are not reasons to skip —
seed the session / bring the database up. Only omit screenshots for
changes that render nothing visible (refactor / backend / types /
tooling), and say so explicitly in the PR body.

---

## 6. Design tokens

Applies to: `apps/web/` and `templates/musician-site/`. The two have
separate token sets (intentionally — different brand surfaces) but share
the same naming convention so reviewers can verify adherence the same way
everywhere.

All visual values (colors, fonts, spacing, sizes, radii, shadows) use
CSS custom properties. Never hardcode hex colors, font sizes, font
weights, or spacing values — in CSS modules, in `globals.css`, in
inline `style={...}` props, or in inline HTML strings returned from
route handlers. If you need a literal value (e.g. inside an
`@media` query), use a token-equivalent comment.

| Category      | Prefix                                  | Example                                       |
| ------------- | --------------------------------------- | --------------------------------------------- |
| Colors        | `--color-*`                             | `var(--color-text)`, `var(--color-success)`   |
| Font sizes    | `--font-size-*`                         | `var(--font-size-base)`                       |
| Font weights  | `--font-weight-*`                       | `var(--font-weight-semibold)`                 |
| Font families | `--font-*`                              | `var(--font-body)`, `var(--font-mono)`        |
| Spacing       | `--space-*`                             | `var(--space-4)`                              |
| Layout        | `--max-*`, `--radius-*`                 | `var(--max-width-narrow)`, `var(--radius-sm)` |
| Shadows       | `--shadow-*`                            | `var(--shadow-sm)`                            |

CSS custom properties cannot appear in `@media` queries. Use literal
pixel values with a comment:

```css
/* --breakpoint-md (768px) */
@media (max-width: 768px) { ... }
```

### Per-location token source

- **`apps/web/`** — `src/app/globals.css` defines the platform's token
  set. CSS modules (`*.module.css`) and any inline `style={...}` props
  consume `var(--*)` references — no raw hex, sizes, or weights.
- **`templates/musician-site/`** — Theme tokens ship with the
  template's CSS as the styling layer lands. The rule applies the
  moment any styles are introduced; pick token names matching the
  prefixes above.

### Inline HTML returned from route handlers

API routes that return HTML (e.g. one-off transitional pages) must
either (a) reference token classes via a stylesheet `<link>`, or (b)
inline `<style>` blocks whose declarations use `var(--*)` references.
Do not paste raw hex / px values into an inline `<style>` block.

---

## 7. Database migrations — expand, then contract

CI applies migrations to production (`prisma migrate deploy`) at the same
time as the new code deploys, so every migration in
`packages/db/prisma/migrations/` must work with **both** the old and the new
code.

- Add, don't break: new tables, nullable columns, or `NOT NULL DEFAULT ...`
  columns. No `DROP TABLE` / `DROP COLUMN`, column type changes,
  `SET NOT NULL`, `ADD COLUMN ... NOT NULL` without a default, or renames in
  the same PR as the code change.
- Breaking changes go in steps, each in its own PR: expand (add the new
  shape), migrate the code (dual-write, backfill), contract (drop the old
  shape once no deployed code uses it).
- Never edit a migration that has merged; add a new one.

CI enforces this with `scripts/migration-safety.mjs` (run it locally with
`npm run migrations:check`). For a contract step that is genuinely safe, add
the PR label `migration:destructive-ok`, explain why in the PR body, and
re-run the job. Full rule and recipes: `docs/runbook.md` §9.

---

## Validation commands

```bash
npm run typecheck   # TypeScript across all packages
npm run test        # vitest
npm run build       # Full production build
npm run lint        # Lint all packages
```

Run `npm run typecheck` and `npm run test` before committing.
