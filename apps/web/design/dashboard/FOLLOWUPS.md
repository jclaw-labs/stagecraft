# Dashboard redesign — deferred follow-ups

Items surfaced during deep review that were consciously **not** addressed in
the redesign PRs, parked here so they aren't lost.

## Design tokens (root CLAUDE.md §7)

- **`Button.module.css` padding literals** — *investigated, left as-is.* The
  `.sm` / `.md` vertical paddings (`0.375rem` = 6px, `0.625rem` = 10px) are off
  the 4px `--space-*` grid, so tokenizing would either change the rendered size
  or need off-scale tokens; the horizontal values map (`0.75rem` → `--space-3`,
  `1.5rem` → `--space-6`) but a mixed `0.375rem var(--space-3)` reads worse than
  the literal pair. Revisit only if the space scale gains half-steps.
- **Layout max-widths** — *addressed (mostly).* Added `--max-width-page: 72rem`
  (dashboard) and switched onboarding / create from literal `40rem` to the
  existing `--max-width-narrow`. The remaining one-off widths (site-detail
  `56rem`, settings `52rem`, empty-state `32rem` / `28rem`, danger-confirm
  `20rem`) are content-specific one-offs left as literals — §7 doesn't
  enumerate arbitrary layout widths and a token-per-width would be bloat.
- **Border-width literals** — *addressed.* Added `--border-width` (1px),
  `--border-width-thick` (2px), `--border-width-accent` (3px) and applied them
  across the apps/web CSS modules + inline styles. (Focus-ring `outline`
  widths and `transform` offsets stay literal — they aren't border widths.)
- **Two card radii** — inset panels use `--radius-lg`; the dashboard `SiteCard`
  uses `--radius-xl`. Intentional (a site card reads as a tappable object, a
  panel as an inset section) — noted so it isn't "unified" by mistake.

## DRY (root CLAUDE.md §2)

- **Shared `StatusBadge`** — *done (#263).* Extracted a `StatusBadge` component
  + module (tone palette + pulsing building dot); `SiteCard` and the site-detail
  header both render it, and the duplicated badge CSS is gone.

## Accessibility

- **Mobile menu focus management** — *done (#264).* On open, focus moves into
  the menu; `Escape` closes it and returns focus to the toggle; selecting a link
  closes it. Implemented as a disclosure (not a focus trap — a trap is the wrong
  pattern for a non-modal inline dropdown: it strands the toggle and the page
  isn't `inert`).

## UX (carried over from the comp README)

- **Account dropdown** — desktop shows name + an inline "Sign out"; a proper
  avatar dropdown (account · settings · sign out) would be cleaner.
- **Real mobile nav drawer** — the current mobile menu is a simple stacked list.
- **Real site thumbnails** — cards use a deterministic gradient banner; swap for
  actual site screenshots once a per-site capture pipeline exists.
- **"Needs attention" as a filter** — clicking that stat could filter the grid
  to the sites that need action.

## Process note (CI / auto-merge on cloud-session PRs)

Update: a cloud-session `git push` now **does** trigger GitHub Actions in this
environment — observed on #263 / #264, where checks ran on the pushed head and
auto-merge fired without any API commit. The older caveat (push doesn't trigger
CI) only bites when the `pr-screenshots` relay leaves a `[skip ci]` commit at
the head; for code-only PRs a plain `git push` is sufficient. See
`docs/screenshots/README.md`.
