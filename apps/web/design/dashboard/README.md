# Stagecraft dashboard — redesign comps

High-fidelity static comps for a redesign of the **Stagecraft platform
dashboard** (`apps/web` — the artist's control panel for managing their
sites). The HTML files are the source of truth; the PNGs are
regenerable (git-ignored) via `render.mjs` — the same convention as
`templates/musician-site/design/theme-comps`.

These are **design artifacts, not wired-up React.** Porting them to
`apps/web/src/app` (and extracting a shared app-shell component) is a
follow-up.

## Why

Today's dashboard (`apps/web/src/app/dashboard/page.tsx`) is an
unstyled, single-column `<ul>` of sites with per-page headers, no app
shell, and **no mobile layout** (the global CSS has no small-screen
media queries). This redesign gives the platform a real shell and a
scannable, responsive surface.

## Screens

| File | Screen |
| --- | --- |
| `dashboard.html` | **Sites overview** — app shell (brand · nav · account), a summary stat strip, and a responsive card grid. Each card carries a site preview, a status badge, the production URL, provider chips, and quick actions. Covers every `Site` status: live · building · deploy-failed · archived. |
| `site-detail.html` | **One site** — deployment status, connections (repo · host · domain · email), site details, and a clearly separated danger zone. |
| `empty-state.html` | **First run** — no sites yet; primary "New site" + "Import existing site". |

## Direction

A calm, content-first control room. One confident brand blue
(`--color-brand`) for actions and the active state; everything else is
neutral so the artist's own work (the site previews) carries the
colour. Status is legible at a glance — a coloured dot + pill, with a
pulsing dot while building. Soft cards (subtle border + shadow, lift on
hover) sit on a near-white canvas. The whole thing reflows to a single
column on mobile.

The comps reuse the **token names** from `apps/web/src/app/globals.css`
(`--color-*`, `--space-*`, `--radius-*`, `--shadow-*`) so a comp doubles
as an implementation reference. Additive proposals, called out here so
they're not mistaken for existing tokens: **Inter** as the UI typeface,
a softer `--color-border`, a couple of extra radii, and the per-site
thumbnail gradients. Dark mode is included via `prefers-color-scheme`.

## Responsive

Each comp is a single responsive document. `render.mjs` shoots it at
two viewports — desktop (1440) and mobile (390) — producing
`<name>.desktop.png` and `<name>.mobile.png`. Breakpoints:

- **1024px** — site-detail's two-column layout collapses to one.
- **768px** — top-bar nav collapses to the account chip + a hamburger,
  card/stat grids go single-column, and primary CTAs go full-width.

## Design-director review (applied)

- **"Needs attention" stat** tinted to the error tone with a marker dot
  — a count of problems should pull the eye, not sit neutral among the
  other figures.
- **Empty state** vertically centred in the viewport — reads as an
  intentional composition rather than floating at the top.

Open follow-ups (noted, not done): swap the gradient placeholders for
real site screenshots; build out the account dropdown + a mobile nav
drawer; make "Needs attention" a filter on the grid.

## Render

Requires `playwright`. PNGs are written next to the HTML:

```bash
# Use Playwright's own Chromium:
node apps/web/design/dashboard/render.mjs

# …or point at a specific binary (cloud sessions where the download is blocked):
CHROMIUM_PATH=/path/to/chrome node apps/web/design/dashboard/render.mjs

# Render a subset:
node apps/web/design/dashboard/render.mjs dashboard empty-state
```

Or just open any `.html` in a browser — they're self-contained (only an
Inter web-font link is external).
