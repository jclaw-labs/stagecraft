# Theme comps — index

Static, self-contained design comps for the musician-site theming work. Each
`*.html` is one fully art-directed page (same fictional artist, "Aurelia
Wren") expressing a complete **design system** — not just a palette. They are
exploration artifacts, not wired into the template; the tokenized system that
reproduces them is planned in `TOKENS.md`.

Render to PNG with `node render.mjs` (PNGs are git-ignored — HTML is the
source of truth). Imagery in the comps is greyboxed with CSS gradients.

## Two axes

These comps vary along **two independent axes**, and the system must too:

- **Vibe** — the aesthetic (palette, type, mood, shape). Most comps below.
- **Structure** — the site *type*: a rich artist site vs. a work-first
  **portfolio** (`frame`) vs. a single-screen **one-pager** (`card`). Any
  vibe should be able to collapse toward portfolio/simple via layout tokens
  (density, content width, which sections are present, gallery layout).

## The library

| Theme | Mode | Best for | Palette | Type (display / body) | Header | Signature |
| --- | --- | --- | --- | --- | --- | --- |
| **Meadow** | light | indie folk, singer-songwriter | cream / forest green / terracotta / amber | Fraunces / Nunito Sans | logo-left, sticky, hairline | airy + spacious, round corners, pill buttons |
| **Riot** | dark | punk, hardcore, DIY | black / acid-lime | Anton / Space Mono | full-bar, 3px lime rule, marquee ticker | oversized bleeding caps, 0-radius, brutalist offset shadows |
| **Paper** | light | classical, art-pop, writers | white / black / grey (mono) | Playfair Display / Inter | centered masthead, small-caps nav | huge thin serif, max whitespace, narrow measure, underline links |
| **Ink** | dark | same as Paper, moody | near-black / off-white | Playfair Display / Inter | centered masthead | luxe nocturne, lit-panel imagery, hairlines |
| **Aurora** | light | dream-pop, shoegaze, ambient | dusty lavender / muted rose-periwinkle | Cormorant Garamond / Inter | transparent, centered | atmospheric hazy hero + film grain, italic serif, quiet underline links |
| **Vinyl** | light | soul, Americana, reissue | oat / rust / ochre / espresso | Bricolage Grotesque / DM Sans | warm bar, single rust rule | refined-warm editorial, framed art, hairlines |
| **Ember** | dark | late-night jazz/soul | espresso-black / amber-rust glow | Bricolage Grotesque / DM Sans | warm dark bar | warm glow on dark, framed art |
| **Redwood** | light | folk, ambient, outdoorsy | fog-cream / red-bark / sage | Spectral / Libre Franklin | transparent over hero | misty full-bleed hero, tall vertical rhythm, portrait "trunk" tiles |
| **Mahogany** | dark | classical, jazz crooner, orchestral | deep red-brown / brass gold | Bodoni Moda / Inter | centered, gold hairline | old-world luxe, polished sheen, Didone, ornament rules |
| **Oak** | light | acoustic, honest songwriter | golden oat / oak brown / olive | Zilla Slab / DM Sans | logo-left, solid, 2px rule | sturdy slab serif, grounded grid, framed art |
| **Pulse** | dark | electronic, techno, DJ/producer | near-black grid / electric blue / cyan | Space Grotesk / JetBrains Mono | precise bar, live status dot | cold technical grid, mono data rows, event flyer, track timestamps |
| **Concrete** | dark | hip-hop, rap | black / brass gold / espresso | Archivo (800–900) | black bar, photo-forward split hero | luxe-rap, heavy gold caps, portrait hero, numbered drops + feat. credits |
| **Candy** | light | bright pop, mainstream | iridescent pink→violet→blue / acid | Outfit / Inter | glossy, blurred | iridescent gloss hero, sleek bold type, gradient-clip headings, rounded cards |
| **Obsidian** | dark | metal, heavy, gothic | black / crimson / steel | UnifrakturCook (blackletter) + Oswald / Inter | sticky, crimson rule, film grain | blackletter wordmark, crimson blades, condensed caps, Roman-numeral tracks, gritty |
| **Cobalt** | light | modern jazz, contemporary | cream / cobalt / ochre | Familjen Grotesk / Inter | structured, cobalt rule | Blue Note two-tone, circle motif, mid-century geometric grid |
| **Frame** | light | photographers, visual artists | white / near-black / tonal | Inter | minimal sticky bar | **portfolio** — masonry work-grid, captions+years, chrome recedes |
| **Card** | light | any artist, minimal | warm paper / clay | Fraunces / Inter | none (one screen) | **one-pager** — avatar, name, link stack, socials (link-in-bio) |

## Genre / discipline coverage

- **Covered:** folk/Americana (Meadow, Vinyl, Oak, Redwood), classical/orchestral
  (Mahogany, Paper/Ink), jazz — warm (Ember) and cool/modern (Cobalt), dream-pop
  /ambient (Aurora), punk (Riot), electronic/club (Pulse), hip-hop (Concrete),
  bright pop (Candy), metal (Obsidian).
- **Disciplines beyond musicians:** photographer / visual artist (Frame),
  writer (Paper/Ink), minimal/link-in-bio (Card).
- **Possible future gaps:** R&B/neo-soul (sleek-modern), country (distinct from
  Americana), comedian/podcast, maker/shop-first commerce.
