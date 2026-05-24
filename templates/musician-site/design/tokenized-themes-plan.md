# Tokenized theming system — plan

Goal: make every part of the comps in `theme-comps/` reproducible from
**individually editable controls** in `/admin/appearance`. A theme stops being
"palette + fonts + a few header flags" and becomes a full, artist-tunable
design system. Each named preset is just a bundle of these control values.

Principle: **controls emit CSS custom properties**; the shared blocks +
`Header`/`Footer` *consume* those properties. No block hardcodes a visual
value. Presets and the admin form both write the same singleton; the renderer
doesn't care which set it.

---

## 1. The control set

Existing today (`site-config-types.ts` → `AppearanceStyles.tsx`): the 9 colors,
`bodyFont`/`headingFont`/`headingMode`, body+heading weights, and header
`mode`/`layout`/`uppercase`/`foreground`. Everything below is the **addition**
(grouped). Enums use the repo's `as const` + derived-union pattern.

### Color (extend)
| Control | Values | CSS var(s) | Reproduces |
| --- | --- | --- | --- |
| `accentMode` | solid · gradient | `--accent`, `--gradient-accent` | Candy/Aurora gradients vs solid |
| `accentGradient` | {from, via, to} | `--gradient-accent` | Candy iridescent, Cobalt two-tone |
| `onAccent` | hex | `--color-on-accent` | dark-text-on-gold (Concrete) vs white |
| `footerStyle` | surface · inverse · accent | `--footer-bg`, `--footer-text` | Meadow green / Concrete black / Candy grape footers |

### Typography (extend)
| Control | Values | CSS var(s) | Reproduces |
| --- | --- | --- | --- |
| `displayFont` | font name (optional 3rd slot) | `--font-display` | Obsidian blackletter wordmark, Riot Anton hero, Concrete heavy |
| `headingCase` | none · upper | `--heading-transform` | Riot/Concrete/Obsidian/Vinyl caps |
| `headingTracking` | tight · normal · wide | `--tracking-heading` | condensed metal vs airy serif |
| `headingScale` | modest · balanced · dramatic | `--scale-display` (×h1) | Paper/Ink huge thin serif vs Meadow modest |
| `labelStyle` | case + tracking for eyebrows/nav | `--tracking-label`, `--label-transform` | small-caps labels everywhere |

### Layout & spacing
| Control | Values | CSS var(s) | Reproduces |
| --- | --- | --- | --- |
| `density` | compact · comfortable · spacious | `--density` (scales `--space-*`), `--section-pad-y` | Riot dense vs Paper airy |
| `contentWidth` | narrow · medium · wide | `--max-content` | Paper narrow measure vs Riot wide |
| `sectionAlign` | left · center | `--content-align`, `text-align` | centered editorial vs left |
| `gutter` | tight · normal · airy | `--gap` | Riot 6px grid vs Meadow generous |

### Header chrome (extend `headerConfig`)
| Control | Values | CSS var(s) | Reproduces |
| --- | --- | --- | --- |
| `headerHeight` | compact · standard · tall | `--header-h` | Pulse compact vs Meadow tall |
| `headerBorder` | none · hairline · bold · accent | `--header-border` | Riot 3px lime, Obsidian crimson, Paper hairline |
| (`headerMode` already incl. `glass-sticky`; `displayFont` styles the wordmark) | | | |

### Shape
| Control | Values | CSS var(s) | Reproduces |
| --- | --- | --- | --- |
| `radius` | sharp(0) · soft · round | `--radius`, `--radius-lg` | Riot/Paper sharp vs Meadow/Aurora round |
| `buttonShape` | square · rounded · pill | `--btn-radius` | pill (Meadow) vs square (Riot) |
| `buttonFill` | solid · outline · underline | `--btn-bg`/`--btn-border`/`--btn-deco` | Paper underline-only vs solid |
| `shadowStyle` | none · soft · glow · hard-offset | `--shadow` | Meadow soft, Aurora/Pulse glow, Riot brutalist |

### Rules & images
| Control | Values | CSS var(s) | Reproduces |
| --- | --- | --- | --- |
| `ruleStyle` | none · hairline · bold · accent | `--rule-width`, `--rule-color` | Vinyl hairline, Riot/Concrete bold, Obsidian crimson |
| `imageTreatment` | plain · rounded · framed | `--img-radius`, `--img-frame` | Vinyl/Oak/Obsidian framed, Aurora rounded |
| `galleryLayout` | grid · portrait · masonry | gallery block layout | Redwood "trunk" portraits, Frame masonry |

### Effects (opt-in)
| Control | Values | CSS var(s) | Reproduces |
| --- | --- | --- | --- |
| `grain` | on · off | grain overlay element | Aurora/Obsidian film grain |

~28 controls. That's the cost of "fully tokenized" — see §3 for how the admin
surface stays manageable.

---

## 2. What is NOT a theme token

Some comp signatures are **content/structure**, not look — they map to blocks
or page choices, not the theme singleton:

- **Marquee ticker** (Riot/Concrete) → opt-in `Marquee` Puck block.
- **Hero style** (full-bleed image vs split vs centered vs overlay) → a
  `Hero` block variant the artist picks per page.
- **Portfolio masonry / one-pager** (Frame, Card) → *page layout*: which
  sections exist + `galleryLayout` + `density`/`contentWidth`. A "Start
  simple" / "Portfolio" first-run path seeds these.
- **Cobalt Blue-Note circle, Vinyl record** → decorative; cut or a future
  decorative block. Not in v1.

So: **theme tokens drive the look; blocks + page content drive the structure.**
The two compose.

---

## 3. Architecture & files

1. **Schema** — extend `appearanceSchema` (`site-config-types.ts`) with nested
   `layout`, `shape`, `rules`, `effects` objects + the new color/type fields,
   and add the header fields to `headerConfigSchema`. One singleton, so one
   injector + one admin panel. (Alternative: separate `design` singleton —
   rejected: more infra, another collection seed + drift entry + admin route.)
2. **Injector** — `AppearanceStyles.tsx` emits every new var via enum→value
   lookup tables (e.g. `density: { compact:.82, comfortable:1, spacious:1.25 }`
   multiplying a base space scale). Loads up to 3 Google families
   (`appearanceFontFamilies` gains `displayFont`).
3. **`globals.css`** — the structural tokens themes now own (`--space-*`,
   `--radius*`, `--shadow*`, gallery gaps) become *defaults* that
   `AppearanceStyles` overrides on `.stagecraft-site`. Editor/admin chrome
   keeps the static defaults (unchanged).
4. **Consumers** — refactor `puck/config.tsx` blocks (Button, Section,
   Card, Divider, Image, Gallery, Heading, Spacer), `Header.tsx`, `Footer.tsx`
   to read the vars. Add the `grain` overlay + `Marquee` block.
5. **Admin** — `/admin/appearance` grows grouped sections (Color · Type ·
   Layout · Shape · Rules) — mostly `SelectField`s off the enums (mechanical;
   the form primitives already exist). Header fields → `/admin/navigation`.
6. **Presets** — rebuild `theme-presets.ts` as the locked directions from
   `theme-comps/INDEX.md`, each `{ appearance(color+type+layout+shape+rules+
   effects), header }`. `resolveTheme` applies all. Repoint `DEFAULT_THEME_ID`;
   drop classic/midnight/marquee/lantern.
7. **Seeds/tests** — regenerate `appearance`/`header` `_collection.json` seeds
   (drift guard); extend `theme-presets.test`, `site-config-types.test`,
   `AppearanceStyles`/Header/block tests; wizard picker auto-covers new
   `THEME_IDS`.

---

## 4. Preset mapping (samples — proves sufficiency)

| | density | contentWidth | radius | buttonShape | buttonFill | shadow | ruleStyle | headingCase | accentMode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Meadow** | spacious | medium | round | pill | solid | soft | hairline | none | solid |
| **Riot** | compact | wide | sharp | square | solid | hard-offset | bold | upper | solid |
| **Paper** | spacious | narrow | sharp | square | underline | none | hairline | none | solid |
| **Pulse** | comfortable | wide | sharp | square | solid | glow | bold | upper | solid |
| **Obsidian** | comfortable | medium | sharp | square | solid | none | accent | upper | solid |
| **Candy** | comfortable | medium | round | rounded | solid | glow | none | none | gradient |

(+ each carries its colors, body/heading/display fonts, header mode/layout.)

---

## 5. Phasing (stacked PRs, each independently green)

1. **Tokens land** — schema + `AppearanceStyles` injection. Defaults = today's
   look, so zero visual change. Pure foundation.
2. **Consumers** — refactor blocks + Header/Footer + globals to read the vars
   (still defaults). Add `Marquee` block + `grain`.
3. **Admin** — grouped controls in `/admin/appearance` (+ header fields).
4. **Presets** — the locked directions; drop the four old ones; repoint
   default + seeds + wizard. Per-preset QA against the comps.
5. **Polish** — curated font picker, preset preview thumbnails, a11y/contrast
   guardrails.

---

## 6. Decisions (resolved)

1. **3rd font slot (`displayFont`)** — **yes.** Optional display/wordmark slot
   so Obsidian (blackletter), Riot (Anton), Concrete (heavy) render true.
   `appearanceFontFamilies` loads up to 3 families.
2. **Admin surface** — **grouped + defaults + "Advanced" disclosure.** Casual
   artists touch a handful; the long tail is tucked away. Sensible defaults so
   an untouched theme still looks coherent.
3. **Granularity** — **3 named steps per scale** (e.g. compact/comfortable/
   spacious). Keeps presets legible and prevents incoherent layouts; no numeric
   sliders in v1.
4. **v1 scope** — **the full system + all 17 presets in one push**, then review.
   (PR4 below builds all 17, not a subset.)
