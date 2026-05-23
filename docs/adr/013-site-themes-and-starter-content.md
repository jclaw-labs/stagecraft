# ADR-013: Site themes, richer starter content, and onboarding

## Status
Proposed. Decomposed into four deep-reviewed PRs (see "Decomposition");
this ADR rides along with PR 1.

## Context

ADR-007 stood up the `musician-site` template with a welcome wizard that
asks the new artist for a single **primary colour** (free hex) and then
seeds a near-empty site (Home page + two example tour dates). Two gaps
have surfaced:

1. **The first-run site looks empty and unstyled.** A free hex picker is
   not a *design* — artists land on a bare site with one accent colour
   and no sense of how their content will look.
2. **There is no curated visual identity.** Appearance tokens (the nine
   `--color-*` values + typography) and header settings
   (mode/layout/wordmark) are individually editable in admin *after*
   onboarding, but nothing bundles them into a coherent look an artist
   can pick in one click.

Goal: let an artist pick a **theme** when they create their site (or
deliberately **start empty**), ship a **fuller set of starter content**
so the site looks alive on first load, and give us a **dev path** to
reach the picker and see the result locally.

## Decision

Three coordinated changes, settled with product input:

- **A theme is an appearance preset + a header style.** A theme bundles
  the nine appearance colour tokens + typography *and* the header
  settings (mode / layout / wordmark sizing / transparent+foreground)
  into one named, one-click choice. It does **not** restyle individual
  blocks or change section/layout structure — that is deferred.
- **One starter content set, theme-independent.** The demo content is
  identical regardless of theme; themes change only the look, not the
  copy or structure. No per-theme content variants.
- **Onboarding picks a theme or starts empty.** The wizard's colour step
  becomes a **theme step**: pick a curated preset, fall back to a
  **Custom** colour (today's hex input, used to derive a theme from the
  default), or **Start empty** (default theme, no demo content).
- **Dev reaches the picker via a reset command.** A script wipes local
  content back to fresh-site state (`hasCompletedFirstRun: false`, empty
  collections) so `npm run dev` lands on the wizard; completing it writes
  the demo content into the dev content dir, viewable immediately.

### Themes

A new `lib/theme-presets.ts` defines a small curated set (v1: three —
**Classic** (the platform default: navy/crimson on warm white),
**Midnight** (luminous type on a deep night palette), and **Marquee**
(high-contrast poster look with condensed headlines)). Each preset
reuses the **existing** `Appearance` and `HeaderConfig` shapes — no new
token vocabulary, no parallel type:

```ts
export const THEME_IDS = ["classic", "midnight", "marquee"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const THEME_PRESETS: Record<ThemeId, ThemePreset> = { ... };
```

`THEME_IDS` is the single source of truth for which themes exist; the
`Record<ThemeId, …>` shape makes TypeScript enforce exactly one preset
per id (CLAUDE.md §1's `as const` + derived-union pattern). A preset's
`header` carries only the *style* fields — `wordmark` and
`headerSubtitle` stay artist-owned. `resolveTheme(id, existingHeader)`
replaces the appearance wholesale, overlays the header style, and
preserves the artist's wordmark + subtitle; `DEFAULT_THEME_ID`
(`"classic"`) is the empty / fallback path. The wizard-complete route
writes the appearance + header singletons from the resolved preset
(replacing today's "swap the accent colour only" behaviour).

### Onboarding wizard

The colour step becomes a theme step:

- A grid of preset cards, each previewing its palette + name.
- A **Custom** escape hatch — the existing hex input — which derives a
  theme from `DEFAULT_THEME_ID`'s appearance with the chosen accent.
- A **Start empty** choice — default theme, `seedContent: false`.

The submit payload gains `theme: ThemeId | "custom"` (plus the custom
colour when `custom`) and `seedContent: boolean`.
`/api/welcome/complete` resolves + writes the theme, and seeds the
starter content only when `seedContent` is true.

### Richer starter content (one set)

Extend the first-run seed (today: Home + two tour dates) into a fuller,
theme-independent demo:

- **Pages** — Home + About (and likely Music / Shows landing pages).
- **Tour dates** — several, spanning past + upcoming so status filters
  have something to show.
- **Releases** — a couple, with track listings.
- **Posts** — a couple of news/blog entries.
- **Photos** — a few gallery items.

Seeding is **idempotent** — populate only empty collections, matching
today's tour-date guard, so a reset + re-complete never double-writes.

**Seed image assets** (release cover art, photo gallery) are a genuine
sub-decision deferred to PR 3: either commit a few small placeholder
images processed through the existing image pipeline, or keep image
fields empty with descriptive alt text and a text-forward demo. Decided
in PR 3 with the content itself.

### Dev

A `scripts/reset-content.ts` invoked via `npm run dev:reset` wipes the
dev content dir back to fresh-site state — empties the collection item
dirs and sets the site singleton's `hasCompletedFirstRun: false` —
reusing the e2e `wipeContentDir` logic pointed at `src/content/`. Then
`npm run dev` → `/admin` → dev login → `/admin/welcome` shows the theme
picker; completing it writes the demo content locally. An optional
`dev:fresh` may chain reset + dev.

## Decomposition

Each PR is independently shippable and deep-reviewed:

- **PR 1 — theme infra (+ this ADR).** `theme-presets.ts`,
  `resolveTheme`, `DEFAULT_THEME_ID`; wire `/api/welcome/complete` to
  apply a resolved theme (appearance + header) given a `theme` param.
  Back-compatible: absent a theme param, today's accent-only behaviour
  stands. Unit tests for `resolveTheme` + route success/error paths.
- **PR 2 — wizard theme-step UI.** Preset grid + Custom + Start empty;
  payload wiring (`theme`, `seedContent`). Component tests.
- **PR 3 — richer starter content.** Extend the seed to the fuller set;
  resolve the seed-image strategy. Tests for the seed builder.
- **PR 4 — dev reset command.** `scripts/reset-content.ts` +
  `dev:reset` script + a CLAUDE.md dev-workflow note.

## Known limitations and deferred work

- **Per-theme content sets.** Out of scope — one content set, by
  decision. *Trigger:* a theme whose layout only makes sense with
  bespoke copy.
- **Deeper theming (block/section restyling, layout structure).** v1 is
  tokens + header only. *Trigger:* demand for theme-specific block looks.
- **Post-onboarding theme switcher in admin.** The Appearance form
  already edits tokens individually; a one-click "apply a theme" button
  there is a natural follow-up. *Trigger:* artists asking to re-theme
  after onboarding.
- **Real seed photography.** v1 uses light placeholders (or empty image
  fields). *Trigger:* a marketing-quality demo.

## Relates to

- **ADR-007** (musician-site template — onboarding wizard + appearance).
- **ADR-009** (unified collection model — seeds + singletons reuse the
  same field IDs the collections already define).
