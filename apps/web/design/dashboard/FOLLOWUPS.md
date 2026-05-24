# Dashboard redesign — deferred follow-ups

Items surfaced during deep review that were consciously **not** addressed in
the redesign PRs, parked here so they aren't lost.

## Design tokens (root CLAUDE.md §7)

- **`Button.module.css` padding literals** — the pre-existing `.sm` / `.md` /
  `.card` paddings (`0.375rem 0.75rem`, `0.625rem 1.5rem`, `1rem`) are raw
  values, not tokens. Out of scope for the redesign (pre-existing, and the
  redesign only added the `.secondary` variant). Tokenize in a dedicated Button
  cleanup.
- **Layout max-widths** — `dashboard.module.css` uses literal `72rem` (page
  container) and `32rem` / `28rem` (empty state). The `--max-width-*` tokens top
  out at `60rem`, so none fit. Consider adding `--max-width-page: 72rem`. Low
  priority — §7's enumerated categories center on colour / type / spacing /
  radii / shadow, not arbitrary layout widths.
- **Border-width literals** — `1px` (plus a `2px` spinner border and `3px`
  status accents in site-detail) are written literally across the platform
  CSS (Button, SiteCard, AppShell, dashboard, site-detail); there's no
  `--border-width` token anywhere. §7 doesn't enumerate border widths and the
  whole codebase uses literals, so this is a repo-wide convention call:
  introduce `--border-width` / `--border-width-accent` everywhere, or leave
  as-is. Deferred either way (not a site-detail-only issue).
- **Two card radii** — inset panels use `--radius-lg`; the dashboard `SiteCard`
  uses `--radius-xl`. Intentional (a site card reads as a tappable object, a
  panel as an inset section) — noted so it isn't "unified" by mistake.

## DRY (root CLAUDE.md §2)

- **Shared `StatusBadge`** — the colour-coded status badge (dot + tone +
  label) is duplicated in `SiteCard.module.css` and
  `sites/[siteId]/site-detail.module.css`. Extract a shared `StatusBadge`
  component handling both the SiteStatus-based card variant and site-detail's
  richer deploy-state variant (incl. the card's pulse animation). Tones are
  now colour-aligned across the two surfaces; only the CSS is duplicated.

## Accessibility

- **Mobile menu focus management** — the hamburger has `aria-expanded` +
  `aria-controls`, but the open menu isn't focus-trapped and `Escape` doesn't
  close it. Acceptable for v1 (two links + sign out); revisit if the menu grows.

## UX (carried over from the comp README)

- **Account dropdown** — desktop shows name + an inline "Sign out"; a proper
  avatar dropdown (account · settings · sign out) would be cleaner.
- **Real mobile nav drawer** — the current mobile menu is a simple stacked list.
- **Real site thumbnails** — cards use a deterministic gradient banner; swap for
  actual site screenshots once a per-site capture pipeline exists.
- **"Needs attention" as a filter** — clicking that stat could filter the grid
  to the sites that need action.

## Process note (CI / auto-merge on cloud-session PRs)

A cloud-session `git push` does not trigger GitHub Actions, and the
`pr-screenshots` relay leaves a `[skip ci]` commit at the branch head — so the
head can end up with no checks, and auto-merge then can't fire. The **final**
commit on such a branch must be made via the GitHub API
(`mcp__github__push_files`), which fires `pull_request: synchronize` and runs
CI. See `claude/skills/create-pr/SKILL.md`.
