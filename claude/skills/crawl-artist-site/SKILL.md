---
name: crawl-artist-site
description: Use when the user wants to visit and capture a musician's (or any) website as visual design reference. Crawls every unique internal page at desktop resolution, takes full-page screenshots, and exercises interactive elements (photo lightboxes, video players, expandable sections, hover states) to capture their playback states. Output is organized under .claude/crawls/<site-slug>/<YYYY-MM-DDTHH-MM>/ with a manifest.json, so repeat crawls of the same site accumulate as dated subdirs rather than overwriting. Trigger phrases include "crawl this site", "capture this artist's site", "take screenshots of...", "visit and screenshot", or any task where the user provides one or more URLs and wants visual reference material before recreating the design.
---

# Crawl Artist Site

Capture a complete desktop design reference for an external website. The output is screenshot-based design reference material for an external site.

## How it runs

Crawling is performed by a Playwright-based Node script that ships with this skill:

```bash
node ~/.claude/skills/crawl-artist-site/crawler.mjs <startUrl> <outputDir> [--max-pages N] [--no-interactions]
```

Running the script handles everything described in the workflow below — no MCP browser tools needed. The script is the source of truth; this document explains intent and decisions baked into it. If the script's behavior diverges from this doc, fix one or the other.

If multiple sites need crawling, run them in parallel via Bash (`&` + `wait`) — Playwright handles concurrent contexts cleanly.

First-run setup (idempotent):

```bash
ls ~/.claude/skills/crawl-artist-site/node_modules/playwright >/dev/null 2>&1 \
  || (cd ~/.claude/skills/crawl-artist-site && npm install --silent && npx playwright install chromium)
```

For ad-hoc interactive browsing (not exhaustive crawls), `mcp__Claude_in_Chrome__*` tools remain appropriate.

## Inputs

- One or more URLs (homepage URLs are ideal starting points)
- Optional caps: max pages (default 30), max depth (default 2)
- Optional: a list of must-capture sub-URLs the user calls out
- Optional: `output-dir=<path>` — explicit override for this crawl's output directory. When omitted (the usual case), output lands at `.claude/crawls/<site-slug>/<YYYY-MM-DDTHH-MM>/` using the current local time. Emit the resolved output directory in your summary so downstream skills can reference it.

**This skill always crawls.** It is the producer of crawl data. If the user wants to reuse an existing crawl (skip this phase), they should invoke the `artist-site-pipeline` skill with `skip-crawl` or invoke `recreate-artist-site` directly with `crawl-dir=<path>` pointing at the existing crawl.

Each invocation produces a **new dated subdirectory** under `.claude/crawls/<site-slug>/`. Never overwrite a prior crawl in place — the dated subdir preserves history so stale crawls can be distinguished from fresh ones (and the pipeline's staleness check relies on it). If the exact minute collides (rare), append `-2`, `-3`, etc.

## Output layout

Outputs go under the canonical top-level `crawls/` directory, grouped by site slug, with one dated subdir per crawl:

```
.claude/crawls/
  artistname-com/
    2026-04-19T23-16/        ← one crawl
      manifest.json
      home/
        scroll-01.png
        scroll-02.png
        lightbox-01.png
        video-01.png
      about/
        scroll-01.png
        ...
      music/
        ...
    2026-05-20T10-00/        ← a later re-crawl of the same site
      manifest.json
      ...
```

The site slug is the domain's hostname with `.` → `-` (e.g. `conorhearnmusic.com` → `conorhearnmusic-com`). Dotfile and `www.` prefix removed.

**Run directories** (`.claude/runs/<id>/`) do not own crawl data — they only symlink the specific crawl chosen for that run into `<run-dir>/crawls/<slug>/`. Run-dir-scoped crawls (eval-phase `--recreation-pre-refine/` and `--recreation/` dirs) are the exception — those stay inside the run-dir because they're tied to a specific recreation version.

## Workflow

### 1. Setup

1. Resize browser to **1440×900** (standard desktop breakpoint — represents the most common production design target).
2. Open a fresh tab.
3. Create the output directory.

### 2. Capture the homepage

1. `navigate` to the starting URL.
2. Wait ~2s for initial load and any JS settle.
3. **Dismiss overlays** (cookie banner, newsletter modal, age gate). Use `javascript_tool` to find and click common dismiss controls. Selectors to try:
   - Buttons with text matching `/^(accept|agree|got it|ok|dismiss|close|no thanks|×|✕)$/i`
   - `[aria-label*="close" i]`, `[aria-label*="dismiss" i]`
   - Common library classes: `.cc-dismiss`, `.cookie-banner button`, `[id*="cookie" i] button`
4. **Lazy-load pass:** scroll to the bottom of the page in 600px increments, pausing 300ms each, to trigger lazy image loads. Then scroll back to top.
5. **Screenshot full page:** scroll top→bottom in viewport-height (900px) increments, screenshotting each as `scroll-01.png`, `scroll-02.png`, etc. (If the screenshot tool supports full-page natively in one call, prefer that.)
6. Save under `home/`.

### 3. Discover internal pages

Use `javascript_tool` to collect candidate URLs:

```js
Array.from(document.querySelectorAll('a[href]'))
  .map(a => a.href)
  .filter(h => new URL(h).origin === location.origin)
  .map(h => new URL(h).pathname)
```

Filter and prioritize:

- **Skip:** `/feed`, `/search`, `/cart`, `/account`, `/login`, `?print=`, `.pdf`, `.zip`, mailto:, tel:, fragment-only links, and obvious external redirects via `/out/`, `/go/`, etc.
- **Prioritize (capture even if not linked from home):** `/about`, `/music`, `/releases`, `/discography`, `/tour`, `/shows`, `/dates`, `/photos`, `/gallery`, `/videos`, `/press`, `/news`, `/contact`, `/store`, `/shop`, `/bio`, `/epk`
- **Dedupe** trailing slashes, query strings (unless the query is structurally meaningful), and case
- **Cap** at the max-pages limit

### 4. For each page

1. `navigate` to the URL.
2. Dismiss overlays (cookie banner may reappear per page).
3. Lazy-load pass (scroll-bottom then scroll-top).
4. Capture scroll-NN screenshots into `<slug>/<page-slug>/`.
5. **Collect all embedded URLs** — use `javascript_tool` to harvest every link and media src on the page, then categorize and record them in the manifest entry. Example harvester:
   ```js
   ({
     links: Array.from(document.querySelectorAll('a[href]'))
       .map(a => ({ href: a.href, text: a.textContent.trim().slice(0, 80), rel: a.rel || null })),
     images: Array.from(document.querySelectorAll('img[src], img[data-src], source[srcset]'))
       .map(el => ({ src: el.currentSrc || el.src || el.dataset.src, alt: el.alt || null })),
     videos: Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="wistia"]'))
       .map(el => ({ src: el.src || el.currentSrc, poster: el.poster || null })),
     audio: Array.from(document.querySelectorAll('audio, iframe[src*="spotify"], iframe[src*="soundcloud"], iframe[src*="bandcamp"]'))
       .map(el => ({ src: el.src || el.currentSrc })),
   })
   ```
   Categorize `links` into:
   - **internal** — same origin, add to crawl queue if not already seen
   - **external** — different origin
   - **media** — `mailto:`, `tel:`, file-extension links (`.pdf`, `.mp3`, `.zip`)
   - **external services** — match against known host patterns: `spotify.com`, `bandcamp.com`, `soundcloud.com`, `apple.com/music`, `music.apple.com`, `youtube.com`, `youtu.be`, `vimeo.com`, `instagram.com`, `facebook.com`, `twitter.com`, `x.com`, `tiktok.com`, `mailchimp.com`, `patreon.com`, `ticketmaster.com`, `seetickets.com`, `eventbrite.com`, `dice.fm`. Promote these to the manifest's top-level `externalServices` map (keyed by service name, value is the URL).
6. **Capture typography and design-token report** — use `javascript_tool` to run the snippet below, write the JSON result to `<slug>/<page-slug>/styles.json`. This is the primary source of typography for the recreate skill — far more reliable than reading pixel heights off screenshots.
   ```js
   (() => {
     const pick = (sel) => document.querySelector(sel);
     const roles = {
       body:    document.body,
       h1:      pick('h1'),
       h2:      pick('h2'),
       h3:      pick('h3'),
       h4:      pick('h4'),
       p:       pick('main p, article p, section p') || pick('p'),
       a:       pick('main a, article a') || pick('a'),
       nav:     pick('nav a') || pick('header a'),
       button:  pick('button, a.button, .btn, [class*="button" i]'),
       caption: pick('figcaption, small'),
       quote:   pick('blockquote, q'),
     };
     const props = ['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textTransform', 'color', 'backgroundColor'];
     const byRole = {};
     for (const [role, el] of Object.entries(roles)) {
       if (!el) continue;
       const cs = getComputedStyle(el);
       byRole[role] = Object.fromEntries(props.map(p => [p, cs[p]]));
     }
     // All unique font-family strings used (cap element walk to keep fast)
     const allFonts = new Set();
     for (const el of Array.from(document.querySelectorAll('*')).slice(0, 800)) {
       allFonts.add(getComputedStyle(el).fontFamily);
     }
     // CSS custom properties declared on :root
     const rootCs = getComputedStyle(document.documentElement);
     const cssVars = {};
     for (const prop of rootCs) {
       if (prop.startsWith('--')) cssVars[prop] = rootCs.getPropertyValue(prop).trim();
     }
     // Dominant color sample — body bg + primary text + first accent (link/button)
     const palette = {
       bodyBackground: getComputedStyle(document.body).backgroundColor,
       bodyForeground: getComputedStyle(document.body).color,
       accent: roles.a ? getComputedStyle(roles.a).color : null,
       buttonBackground: roles.button ? getComputedStyle(roles.button).backgroundColor : null,
     };
     return {
       byRole,
       fontFamilies: [...allFonts],
       cssVars,
       palette,
       viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
     };
   })()
   ```
7. **Save rendered HTML** — write `document.documentElement.outerHTML` to `<slug>/<page-slug>/page.html`. This is the post-JS-render snapshot. The recreate skill uses it to pull exact text (bios, release titles, press quotes, tour dates) without re-fetching. Strip or keep `<script>` tags at your discretion — keeping them is simpler; they don't execute when read back as text.
8. **Save plain-text outline** — also save a slim `<slug>/<page-slug>/text.md` with just headings + paragraph text in order. Use `javascript_tool`:
   ```js
   Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption'))
     .map(el => {
       const tag = el.tagName.toLowerCase();
       const text = el.textContent.replace(/\s+/g, ' ').trim();
       if (!text) return null;
       if (tag.startsWith('h')) return `${'#'.repeat(+tag[1])} ${text}`;
       if (tag === 'li') return `- ${text}`;
       if (tag === 'blockquote') return `> ${text}`;
       return text;
     })
     .filter(Boolean)
     .join('\n\n')
   ```
9. Capture interactive states (next section).
10. Wait ~1s before the next page (politeness).

### 5. Interactive states

For each page, **exercise representative interactive elements** — not exhaustively, just enough to capture the design pattern.

**Photo grids / galleries**
- Find via: `img` inside `a`, clickable `figure`/`img` in grid containers, or elements with class hints (`gallery`, `lightbox`, `photo-grid`)
- Click the **first 1–2** items
- Screenshot the resulting state — usually a lightbox modal
- If next/prev arrows visible, click "next" once and screenshot to confirm carousel behavior
- Close (try ESC via `javascript_tool`, then look for × button)
- Save as `lightbox-01.png`, `lightbox-next.png`, etc.

**Video thumbnails**
- Find via: elements with play-button overlays, `iframe[src*="youtube"]`, `iframe[src*="vimeo"]`, elements with `video`/`player`/`play` in their class or attributes
- Click one representative thumbnail
- Screenshot the playback state (inline player, modal, or external player UI)
- **Pause all media** before moving on:
  ```js
  document.querySelectorAll('video, audio').forEach(m => m.pause());
  ```
- Save as `video-01.png`

**Notable buttons**
- "Listen", "Buy", "Tickets", "Pre-save", "Read more", "Show more", "Expand"
- **DO** click internal buttons that reveal in-page UI (collapse/expand, tab switches, "load more")
- **DO NOT** click buttons that obviously redirect externally (Spotify, Bandcamp, Apple Music, Ticketmaster, etc.) — just record the href in the manifest
- **DO NOT** submit forms (newsletter signup, contact, etc.)

**Hover states** (optional — skip if running long)
- Hero CTA, primary nav links — hover via `computer` and screenshot
- Save as `hover-cta.png`, `hover-nav.png`

### 6. Manifest

Write `<output-dir>/manifest.json` (i.e. `.claude/crawls/<slug>/<YYYY-MM-DDTHH-MM>/manifest.json` by default):

```json
{
  "startUrl": "https://...",
  "domain": "...",
  "crawledAt": "<ISO timestamp>",
  "viewport": { "width": 1440, "height": 900 },
  "pages": [
    {
      "path": "/",
      "title": "...",
      "screenshots": ["home/scroll-01.png", "home/scroll-02.png"],
      "html": "home/page.html",
      "text": "home/text.md",
      "styles": "home/styles.json",
      "interactions": [
        { "kind": "photo-lightbox", "trigger": "first photo in grid", "screenshots": ["home/lightbox-01.png"] },
        { "kind": "video-play", "trigger": "hero video thumbnail", "embed": "youtube|vimeo|native|other", "screenshots": ["home/video-01.png"] }
      ],
      "internalLinks": ["..."],
      "externalLinks": ["..."],
      "imageUrls": ["..."],
      "notable": "Free-text observations: WebGL hero, parallax, custom cursor, autoplaying bg video, sticky nav, etc."
    }
  ],
  "externalServices": {
    "spotify": "https://open.spotify.com/artist/...",
    "bandcamp": "...",
    "instagram": "...",
    "youtube": "..."
  }
}
```

**Typography and palette** live in per-page `styles.json` files referenced from each page entry. The recreate skill consolidates across pages (there's usually one dominant heading font + one body font across the site).

### 7. Politeness and ethics

- ~1s wait between page loads
- **Skip** authenticated pages, payment flows, CAPTCHA — record as skipped in the manifest
- **Don't submit forms**
- **Don't follow external redirects** automatically
- If a page errors heavily (JS bombs, blank page), capture what you can and note in manifest

## Common pitfalls

- **Parallax / scroll-triggered animations:** scroll too fast and elements haven't revealed. Pause between scrolls (300ms+).
- **Lazy-loaded images:** the bottom-then-top scroll pass is mandatory before screenshots, not optional.
- **Sticky headers:** they appear in every scroll screenshot. Note "sticky header" in the page entry and consider one screenshot with the header hidden via `javascript_tool` (`document.querySelector('header').style.display = 'none'`) for layout reference.
- **SPAs (React/Vue):** clicking nav links may not trigger full navigation. Prefer `navigate` directly to candidate paths over clicking links.
- **Cookie banners reappearing per page:** always run the dismiss helper at the start of each page, not just once at the start of the crawl.
- **Auto-playing carousels:** capture the initial state; don't try to pause or step through.
- **Audio autoplay:** pause `<video>` and `<audio>` elements as soon as the page loads to avoid the user hearing things mid-crawl.
- **Modals that take focus:** ESC may not always close them; have a fallback that clicks `[aria-label*="close" i]` or the overlay backdrop.

## When you're done

Summarize to the user:
- Number of pages captured per site
- Number of interactive states captured
- Notable patterns or tech detected (WebGL, custom fonts, video-heavy hero, e-commerce embed, etc.)
- **Crawl output path(s):** absolute path to `.claude/crawls/<slug>/<timestamp>/` for each site — include this explicitly so the user (or the pipeline) can feed it to the recreate and evaluate skills
- Anything skipped and why

Do NOT propose recreating the site in the same turn. Wait for the user's go-ahead.

## Multi-site batching

If the user provides multiple URLs:
- Crawl them sequentially (one at a time — don't open many tabs in parallel; respect the sites)
- Each gets its own `<slug>/` directory
- Summarize all sites together at the end with a quick comparison table (page counts, dominant tech, common patterns)
