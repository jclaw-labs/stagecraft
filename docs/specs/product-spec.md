# AI-Orchestrated Static Website Platform for Musicians

> **Status (2026-10-10): partly superseded.** This is the original product
> spec. The goals it states still hold: artist-owned repos and hosting,
> structured content, low cost. One part of how it gets there doesn't:
> **AI edits through pull requests** (natural-language change requests,
> the request classifier, the AI worker, PR review, §16, §17.2, and the
> AI wording elsewhere) were cut in issue #344. Artists edit their site
> directly in its built-in editor; saves go to a draft branch and Publish
> merges them (ADR-010). §15.3 says this; the other AI sections are kept
> as originally written.
>
> The stack is current: §1, §7.2, §8.2, §8.4, §9, §10, §13.3, §21.2 and
> the stack lines in §25–§29 describe the Next.js + Puck template
> (ADR-007) that replaced the original Astro template (ADR-014). The
> file paths in §11 and §12 are
> still the original design; `templates/musician-site/CLAUDE.md` lists
> where content and images actually live.
>
> `docs/specs/technical-architecture.md` describes the system as built.
> §14 (seeded site and themes) and §15.1 (new site creation) are current.

## 1. Overview

This document specifies a platform for creating, migrating, editing, previewing, and publishing simple musician websites using an AI coding agent (Claude Code) as the primary implementation engine.

The platform should target non-technical users who currently pay too much for simple brochure-style websites built on site builders such as Squarespace or Wix. The product should allow users to own their website code and hosting setup while making site creation and editing as simple as possible through natural-language requests.

The platform itself should act as an orchestration layer around:

- GitHub repos
- Vercel or Netlify deployment
- AI-driven code and content changes
- Structured content and asset workflows
- A lightweight backend for contact form delivery

The generated websites should be:

- static-first
- portable
- easy to edit manually
- easy to edit through AI prompting
- strongly constrained by framework, typing, schemas, and tests

The technical stack for generated websites is (ADR-007):

- Next.js (App Router) with React and TypeScript
- Puck as the built-in visual editor at `/admin`
- Vercel or Netlify hosting, in the artist's own account
- repo-owned content (JSON files) and assets
- no CMS database for site content

## 2. Product Vision

The platform should provide musician websites that users fully own, while letting them request changes in plain English.

The key product promise is:

> Own your website outright, keep hosting simple, and request changes in plain English with preview links before anything goes live.

The platform should not primarily be positioned as a generic AI website builder. It should be positioned as an AI site steward for simple musician websites.

## 3. Goals

### 3.1 Primary goals

1. Allow a non-technical musician to create a custom static website with minimal setup friction.
2. Allow a non-technical musician to edit their website through plain-language requests.
3. Ensure every site is fully portable via a normal GitHub repository the user owns.
4. Ensure changes are safe and reviewable through Git branches, pull requests, and Netlify deploy previews.
5. Keep site content database-free and repo-native.
6. Make the generated code maintainable for humans and constrained enough for reliable AI edits.
7. Support migration from existing brochure-style musician sites.

### 3.2 Secondary goals

1. Support image-heavy musician websites with responsive image handling.
2. Support lightweight custom interactivity.
3. Support contact forms without introducing a content database.
4. Allow advanced users to manually edit their own repos outside the platform.

## 4. Non-goals

The initial version should not optimize for:

1. arbitrary business websites
2. ecommerce
3. memberships / user accounts on the generated sites
4. blog/CMS editing through a traditional admin panel
5. multi-user collaborative editing within a site
6. complex server-rendered applications
7. arbitrary plugin ecosystems
8. full visual drag-and-drop site editing
9. heavy custom backend logic per customer site
10. a proprietary content database for customer site content

## 5. Target user

The target user is a non-technical or lightly technical musician with a simple public website. Their site typically contains some combination of:

- home
- about / bio
- music / discography
- videos
- photos / gallery
- press / EPK / resume
- teaching
- tour dates
- contact form

They want:

- a better and cheaper website than a site builder
- a custom look and feel
- ownership of code and hosting
- the ability to request edits in plain language
- the ability to upload images and paste text content
- the ability to approve changes before they go live

## 6. Product principles

1. **Repo is source of truth**
   Customer site content and code should live in the Git repo.

2. **Preview before publish**
   All meaningful changes should go through preview URLs before merge to production.

3. **Constrain the AI**
   The platform should give Claude Code structured tasks, repo conventions, schemas, and limited surface area.

4. **Portability is a feature**
   Customers should always be able to clone their repo and continue without the platform.

5. **Static-first**
   Sites should be generated as static-first brochure sites with optional small interactive islands.

6. **No customer content DB**
   Page content and media metadata should live in the repo instead of a hosted CMS. This includes v1: no Keystatic, no Contentlayer, no headless CMS integration. Content files are the CMS.

7. **Human-auditable changes**
   Every change should correspond to a branch, commit set, PR, and deploy preview where possible.

8. **Schema-first content**
   Content should be declared before it is rendered. Every editable piece of information should have a named field in a validated schema. AI edits target schema fields; component code is not the editing surface.

## 7. High-level architecture

The system consists of two layers:

### 7.1 Platform application

A web app that users interact with. Responsibilities:

- user authentication into the platform
- linking external accounts (GitHub, Vercel or Netlify, Resend)
- onboarding and site creation
- migration flow from an existing site URL
- gathering user content and assets
- collecting edit requests in natural language
- orchestrating Claude Code tasks
- showing PR / preview / status information
- allowing user approval / rejection / revision

### 7.2 Generated customer site repos

Each customer site is a normal GitHub repo that the customer owns or has access to. Responsibilities:

- Next.js + Puck site code (from `templates/musician-site`)
- content files
- image assets
- tests
- lint / typecheck / build scripts
- deploy configuration

The platform should not make the generated sites dependent on a proprietary runtime.

## 8. External integrations

### 8.1 GitHub

GitHub is required or strongly preferred.

Use GitHub for:

- repo creation
- branching
- pull requests
- commit history
- ownership and portability
- collaboration with technical users

The platform should prefer a GitHub App or OAuth-based integration with appropriate permissions.

### 8.2 Deploy target: Vercel or Netlify

The artist connects either Vercel or Netlify. The chosen host is used for:

- site hosting
- production deploys, rebuilt when the editor publishes to `main`
- environment variables for the site's editor sign-in and contact form

### 8.3 AI provider

The platform should directly call the model provider itself rather than depending on the customer’s own Claude subscription/session.

Rationale:

- simpler UX
- more predictable orchestration
- less fragility
- easier support
- easier observability and retries

### 8.4 Email / contact form delivery

Use Resend plus a serverless endpoint for form submission delivery.

The template's architecture:

- prerendered public pages
- the site's own `POST /api/contact` route handler, running as a serverless
  function on the artist's host
- Resend API for email delivery (the same Resend account also sends the
  editor's magic-link sign-in emails)

Do not introduce a submissions database in v1.

## 9. Framework decision

Generated sites use the Next.js + Puck template at `templates/musician-site`
(ADR-007):

- Next.js (App Router)
- React
- TypeScript strict mode
- Puck (`@puckeditor/core`) for the visual editor

The original plan was Astro + React. The template was rebuilt on Next.js +
Puck, and the Astro template was removed (ADR-014).

### 9.1 Why Next.js + Puck

The artist needs a visual editor on their live site: drag-to-reorder blocks,
inline preview, image and section controls. Astro's `.astro` components
render only on the server, so a browser-side editor can't manipulate the same
component tree the public site renders. Puck can: its blocks are React
components with typed props, and its page output is plain JSON stored in the
artist's repo (ADR-007).

Benefits:

- one renderer: the same Puck block library renders the public pages and the
  editor preview
- one deployable unit serves the public site, the `/admin` editor, and the
  `/api/*` routes the editor and contact form use
- public pages are prerendered at build time (`generateStaticParams`)
- no hosted CMS or vendor backend; content stays as JSON files in the repo
- the same framework as the platform app (ADR-001)

### 9.2 Why React

Puck blocks are React components, so React is the rendering layer for the
whole site rather than an optional add-on. Technical users get a standard
Next.js project they can run and change themselves.

### 9.3 Rendering model

Use:

- Puck blocks (`src/puck/config.tsx`) for page content; block components are
  pure and render on the server
- client components (`"use client"`) only where the browser needs state, such
  as the contact form, image carousel and photo lightbox

## 10. Generated repo requirements

Each customer site repo should follow a standard layout.

Example:

Every repo starts as a copy of `templates/musician-site`. Abridged:

```txt
/
  next.config.ts
  package.json
  tsconfig.json
  CLAUDE.md
  .env.example
  /src
    /app
      /(public)     public pages (one catch-all route)
      /admin        the Puck editor and settings forms
      /api          editor, publish, image upload and contact routes
    /components
    /puck
    /lib
    /content
      /collections
  /public
    /images         added by image uploads
  /e2e
  /.github
    /workflows      added at provisioning
```

### 10.1 Repo conventions

1. `src/app/` holds the routes: the public site, `/admin`, and `/api/*`.
2. `src/puck/` holds the block library, the source of truth for block schemas.
3. `src/components/` contains reusable presentational and interactive components.
4. `src/lib/` contains helper utilities, content reads, and the save and publish paths.
5. `src/content/collections/<slug>/` holds all site content as JSON, one directory per collection (ADR-009).
6. `public/images/` holds uploaded images and their generated variants.
7. Unit tests sit next to the code (`*.test.ts`); `e2e/` holds Playwright tests.
8. `CLAUDE.md` contains agent-specific instructions for editing within the repo.

## 11. Content model

The site content model must be **schema-first**. Every piece of editable content should have a declared shape — named fields, defined types, and a validation contract — before any component renders it.

The platform must not treat arbitrary component code as the primary content-editing surface. Structured content files are the editing surface. Components are rendering code that consumes that content.

### 11.1 Core principles

**Maximally extensible, not maximally abstract.**
Content schemas should be concrete enough to be self-documenting. Use specific named fields (`headline`, `bio`, `altText`) rather than generic blobs. Schemas should expand to cover common musician-site needs without requiring a rewrite.

**Make common edits explicit.**
Anything a user is likely to change — bio, headline, social links, hero image — should be a named field in a schema, not buried in component code. If editing a piece of content requires touching a `.tsx` file, that is a design smell.

**Content should be understandable in Git diffs.**
A change to the artist bio should produce a diff that reads like a content change, not a code change. JSON and Markdown files accomplish this. Inline JSX strings do not.

**One content contract across the stack.**
The same schema drives validation, rendering, AI editing, and any future editor UI. There is no separate “admin schema” vs “code schema.”

**Designed for future human editors — without requiring one now.**
The schema-first content model is intentionally compatible with filesystem/Git-based structured editors (such as a future Keystatic or similar form-based UI) without requiring content migration. v1 ships with no CMS dependency: no Keystatic, no Contentlayer, no headless CMS. If a form-based editing surface is ever added, it plugs into the existing content files as they are. The schema is the integration point.

### 11.2 Content categories

Content in each site falls into four categories. The AI should understand this taxonomy and prefer editing in the correct category rather than reaching for component code.

**1. Structured content** — the editable information about the artist and their work.
Examples: bio, headline, social links, release metadata, photo alt text, press quotes, tour dates, contact page copy, SEO metadata.

**2. Theme and config** — site-level settings that control appearance and navigation.
Examples: site name, contact email, nav items, color palette, font choices, dark/light mode preference.

**3. Layout and component code** — the React components and Puck blocks that render content. These should rarely need editing for routine content requests.

**4. AI-only structural changes** — page additions, nav restructuring, new section types. These require editing both content and component code and must be explicitly classified as structural changes, not content edits.

### 11.3 Singletons and collections

Organize content into two shapes:

**Singletons** — one record per site. Each lives at a predictable, stable file path.

| Singleton | Path |
|-----------|------|
| Site settings | `src/content/config/site.json` |
| Navigation | `src/content/config/nav.json` |
| Theme tokens | `src/content/config/theme.json` |
| Homepage content | `src/content/pages/home.mdoc` |
| About / bio | `src/content/pages/about.mdoc` |
| Contact page | `src/content/pages/contact.mdoc` |
| SEO defaults | `src/content/config/seo.json` |

**Collections** — zero or more items, each with a stable shape.

| Collection | Path pattern |
|-----------|-------------|
| Releases | `src/content/collections/releases/*.json` |
| Photos | `src/content/collections/photos/gallery.json` |
| Videos | `src/content/collections/videos/videos.json` |
| Tour dates | `src/content/collections/tourDates/dates.json` |

### 11.4 Stable field shapes

Schema fields should be named and stable. Each schema should:

- use specific field names that match the content domain (not `text1`, `text2`)
- declare required vs optional fields explicitly
- declare the type of each field (`string`, `string[]`, `boolean`, `url`, `date`, `object`)
- be validated at build time and before any AI-generated change is committed

Example — release schema:
```json
{
  “title”: “Debut Album”,
  “artist”: “Alex Rivera”,
  “type”: “album”,
  “releaseDate”: “2024-03-15”,
  “coverImage”: “src/assets/images/release-cover.jpg”,
  “streamingUrl”: “https://open.spotify.com/album/...”,
  “description”: “Optional short description”
}
```

### 11.5 Normalized image metadata

Every significant image entry in any collection or singleton should carry normalized metadata fields:

| Field | Required | Description |
|-------|----------|-------------|
| `src` | yes | Path to the image file in `src/assets/images/` |
| `alt` | yes | Descriptive alt text for accessibility |
| `caption` | no | Optional display caption |
| `credit` | no | Optional photographer credit |
| `focalPoint` | no | Optional `{ x, y }` hint for responsive cropping |
| `usageSlot` | no | Identifies where the image appears (e.g. `”hero”`, `”gallery”`, `”about”`) |
| `mobileVariant` | no | Optional path to a mobile-specific image file (different crop or composition) |
| `aspectPreference` | no | Optional preferred aspect ratio hint for the rendering component (e.g. `”16:9”`, `”square”`, `”portrait”`) |

This metadata should live alongside the image reference in content files, not only in component code.

### 11.6 Predictable file conventions

File paths and naming follow a strict convention so that the AI and humans can always find content without searching:

- Singletons: `src/content/config/*.json` or `src/content/pages/*.md`
- Collections: `src/content/collections/{collectionName}/*.json` (one file per item) or a single `*.json` array for small collections
- Images: `src/assets/images/{context}/{slug}.{ext}` (e.g. `src/assets/images/gallery/show-2024.jpg`)
- Public assets (favicons, downloads): `public/{type}/`

These conventions must be documented in `EDITING.md` and enforced by the content validation script.

### 11.7 Content-editing principle

Most user requests should map to structured content edits — editing files in `src/content/` — rather than changes to component code.

- “Update my bio” → edit `src/content/pages/about.mdoc`
- “Add these 5 photos” → add files to `src/assets/images/gallery/` and add entries to `photos/gallery.json`
- “Add a Teaching page” → add `src/content/pages/teaching.mdoc` and add a nav entry to `nav.json`
- “Change my homepage button text” → edit the relevant field in `src/content/pages/home.mdoc`
- “Update my Spotify link” → edit `src/content/config/site.json`

The AI should only edit layout or component code when the request explicitly implies a structural or design change that cannot be expressed as a content edit. This preference must be stated in `CLAUDE.md` and reinforced by the request classifier in the platform.

## 12. Asset and image handling

### 12.1 Asset storage strategy

Store source image assets in the repo under `src/assets/` or equivalent.

Do not place user-uploaded source images in `public/` if they should participate in optimization.

### 12.2 Responsive image strategy

For each source image:

1. store the original normalized asset in the repo
2. generate multiple responsive sizes at build time
3. render with `srcset` / `sizes`
4. use `<picture>` for mobile/desktop art direction when needed

### 12.3 Default generated variants

Suggested standard sizes:

- 640w
- 960w
- 1280w
- 1600w
- 2400w for large hero use cases only

### 12.4 Asset metadata

Each significant image should have metadata such as:

- alt text
- usage slot / page section
- crop/focal information if available
- optional mobile-specific variant

Example:

```json
{
  "alt": "Portrait of the artist performing live",
  "image": "photos/hero-desktop.jpg",
  "mobileImage": "photos/hero-mobile.jpg"
}
```

### 12.5 Asset upload rules

The platform should:

- normalize filenames
- constrain image file size and dimensions
- optionally compress / transcode on upload
- reject extremely large source files
- preserve good portability and repo hygiene

### 12.6 Asset portability

All site-critical images should remain repo-owned so that users can clone the repo and retain their assets.

## 13. Interactivity and custom JS

### 13.1 Default approach

Generated sites should remain mostly static.

### 13.2 Allowed interactivity types

Support lightweight custom interactions such as:

- mobile nav toggles
- image lightboxes
- slideshows / carousels
- audio player widgets
- embedded media interactions
- simple animated homepage elements
- enhanced form feedback states

### 13.3 Implementation hierarchy

Use the least complex tool that satisfies the request:

1. server-rendered component (the default for Puck blocks)
2. a small client component (`"use client"`) for the interactive part only

### 13.4 Constraint

Avoid turning the site into a client-heavy SPA unless the user has a very strong reason.

## 14. Seeded site and themes

There are no per-artist-type site blueprints. Every new site is built from the
one musician-site template and gets the same seeded shape; a theme, not a
blueprint, sets the look. Artists then add, remove, and edit pages from there.

The seeded content is written by the template's first-run welcome wizard
(`templates/musician-site/src/lib/first-run-seeds.ts`). The wording below
matches the marketing copy in
`apps/web/src/app/(marketing)/_components/site-sections.ts`; keep the three in
step.

The list below is the marketing wording. In the seed itself, the home page
takes its title from the wizard's first-page title ("Home" by default), About
and Contact are two separate starter pages, and tour dates are not a page: the
seed adds two items to the tour-dates collection, shown on the home page.

### 14.1 What a new site contains

- **Home** — a hero with your name, your latest release, upcoming shows, and a
  photo gallery.
- **Music** — your releases, listed automatically as you add them.
- **Tour dates** — add a show once and it appears wherever your site lists
  dates.
- **Updates** — news posts for announcements, interviews, and studio notes.
- **About & Contact** — a bio page, plus a contact form that sends to the email
  you set.

The seed is illustrative starter copy that uses the artist's name, two example
tour dates, and empty image slots that render a theme-driven placeholder until
the artist uploads. The artist edits or deletes all of it in place.

### 14.2 Starting point: theme, custom color, or "Start empty"

The welcome wizard asks for one starting point:

- **A theme** — pick a ready-made theme preset
  (`templates/musician-site/src/lib/theme-presets.ts`), which sets colors,
  fonts, and header in one go. The starter content above is added.
- **"Custom colour"** (the wizard's label) — one accent color on the
  template's built-in base appearance (not a theme preset; the header style is
  left as is). The starter content above is added.
- **Start empty** — a blank home page with the Meadow theme (the default
  theme preset) and no demo content (no starter pages or tour dates); the
  artist builds the site themselves.

Whichever start is chosen, fonts and colors can be changed any time from
Appearance.

### 14.3 Constraint

The AI should edit within the template's page, block, and content schema
rather than inventing an unconstrained site structure from scratch.

## 15. User workflows

### 15.1 New site creation

1. User signs into the platform.
2. User connects GitHub, a deploy target (Vercel or Netlify), and Resend (for
   sign-in on the artist's site).
3. User names the site. That is the only input the platform asks for; there is
   no blueprint to choose.
4. Platform runs the `create_site` job: it creates the artist's repo from the
   one musician-site template as-is, links the host, and sets environment
   variables. The site then deploys.
5. User opens the site's admin, where the first-run welcome wizard asks for:
   - artist name
   - a starting point (a theme, a custom color, or "Start empty" — see §14)
   - an optional wordmark image
   - the first page's title
6. The wizard writes the seeded content (§14) and the artist edits pages,
   releases, tour dates, and images in place from the site's admin.

### 15.2 Migration from an existing site

1. User enters current site URL.
2. Platform crawls and extracts:
   - routes/pages
   - text content
   - media references
   - embeds
   - navigation
3. Platform maps extracted content into the musician-site template's pages and content schema.
4. AI generates a migrated site repo.
5. Platform creates preview.
6. User reviews and requests fixes.
7. User approves production launch.

### 15.3 Editing a site

Artists edit their site in its own editor at `/admin` (Puck, ADR-007):
saves go to a draft branch and Publish merges them to `main` (ADR-010).

## 16. AI orchestration requirements

Claude Code should not be treated as a freeform autonomous designer. It should be guided by structured tasks, repo conventions, and a strict content hierarchy.

### 16.1 AI task types

Define separate modes:

1. content edit mode
2. asset update mode
3. new page mode
4. navigation change mode
5. style/theme adjustment mode
6. interactivity/widget mode
7. migration/import mode
8. repair/debug mode

### 16.2 AI execution constraints

Claude Code should:

- **prefer editing schema-driven content files over component code** — the content model exists precisely so that the vast majority of requests never require touching a `.tsx` file
- **prefer editing a named schema field over freeform string insertion** — if a piece of content has a dedicated field (e.g. `bio`, `headline`, `altText`), edit that field rather than finding where it's interpolated in a template
- preserve template architecture unless a structural change is requested
- avoid broad refactors unless necessary
- produce small, reviewable diffs
- follow existing repo conventions
- keep accessibility high
- keep performance good
- maintain type safety
- run content schema validation after any content-file change before committing

### 16.3 AI output requirements

Each change operation should produce:

- git branch
- commit(s)
- machine-readable status
- human-readable summary of changes
- list of files changed
- test/build status
- preview URL when available

### 16.4 Human-readable summary example

Summaries shown to users should look like:

- Updated homepage headline and intro text
- Added 4 gallery images to the Photos page
- Created a new Teaching page and added it to navigation
- Changed button styles and heading typography site-wide

## 17. Review and publishing model

### 17.1 Safety model

All significant changes should go through a reviewable preview flow.

### 17.2 Branch / PR model

Each change request should:

1. create a branch
2. commit the generated changes
3. open a PR
4. attach validation status and preview URL

### 17.3 Preview model

Netlify deploy previews should be surfaced prominently in the platform UI.

The user should be able to:

- open preview
- compare with current production site
- review plain-language change summary
- approve or reject

### 17.4 Publish model

Once approved, merge to main and trigger production deployment.

## 18. Validation and testing requirements

The generated repos must be strongly constrained.

### 18.1 Required checks

Every repo should include scripts and CI for:

- `typecheck`
- `lint`
- `build`
- content schema validation
- asset existence validation
- link validation where practical
- smoke tests

### 18.2 Testing philosophy

Optimize for reliability rather than maximum test count.

The most valuable test/validation layers are:

1. schema validation
2. static build validation
3. TypeScript strictness
4. small Playwright smoke suite
5. selective visual checks later

### 18.3 Smoke test examples

At minimum:

- homepage loads
- primary nav works
- key pages return success
- major images render
- contact form UI appears and submits client-side correctly

### 18.4 Accessibility requirements

Generated sites should be accessible by default.

At minimum:

- semantic headings
- alt text requirements for key images
- color contrast checks in design tokens
- keyboard-navigable menus/dialogs
- labeled form inputs
- reduced-motion respect where animation exists

## 19. Error handling requirements

The platform must treat failure handling as a first-class product feature.

### 19.1 Failure categories

Handle at least:

1. AI generated an unwanted direction
2. build failed
3. preview deploy failed
4. content schema invalid
5. missing/invalid asset
6. user changed mind mid-request
7. user wants to revert
8. GitHub/Vercel/Netlify auth issues

### 19.2 Required responses

For each failure, surface:

- plain-language explanation
- likely cause
- safe next actions
- option to retry, revise, or discard

### 19.3 Example: build failure UX

Instead of showing raw logs only, summarize:

- A newly added image file could not be found
- A page config entry is missing a required title
- A React component was added without the expected props

Then offer:

- auto-fix
- revert last change
- open technical details

### 19.4 Example: AI drift UX

If the user says “I don’t like where this is going,” allow:

- discard branch
- return to last approved state
- retry with stricter constraints such as:
  - keep layout, only edit copy
  - keep colors and fonts
  - do not change navigation

## 20. Manual-editing guarantee

This is a critical product promise.

Users must always be able to:

- clone the repo
- install dependencies
- run locally
- make manual edits
- commit/push outside the platform
- continue using their Vercel or Netlify account independently if they choose

Every repo should therefore include:

- clear README
- clear setup instructions
- explanation of content structure
- explanation of image handling
- explanation of deployment flow

## 21. Contact form design

### 21.1 Requirements

Each site may include a contact form.

The contact form should:

- work on a static site
- send email to the artist or designated inbox
- avoid storing content in a site-specific database
- be simple to configure

### 21.2 Architecture

Preferred initial architecture:

- `ContactForm` component on the public site
- the site's `POST /api/contact` route handler
- Resend API call from the route handler
- recipient read from the site settings (`contactEmail`)

### 21.3 Spam considerations

v1 should include lightweight anti-spam measures such as:

- honeypot field
- rate limiting if feasible at the platform or function layer
- optional Turnstile/reCAPTCHA later if needed

## 22. Platform persistence and internal backend

The customer site content should be repo-native, but the platform itself will still require persistence.

The platform backend likely needs to store:

- user account records
- linked integration metadata
- site records
- repo identifiers
- job execution history
- PR/preview status records
- billing records

This persistence should remain separate from customer site content.

## 23. Security and permissions

### 23.1 Principle of least privilege

External integrations should request the minimum required permissions.

### 23.2 Secrets handling

Store secrets such as:

- GitHub app credentials
- Vercel or Netlify tokens
- Resend API keys
- environment variables for generated sites

securely in the platform backend and/or the host's environment config.

Do not commit secrets to customer repos.

### 23.3 User ownership

The user should own the repo and the production deploy target whenever possible.

## 24. Design system and styling

Generated websites should use a constrained design system rather than arbitrary one-off styling.

### 24.1 Design token requirements

Each site should define:

- colors
- typography scale
- spacing scale
- border radius
- shadow usage
- button styles
- content width rules

### 24.2 Styling goals

- attractive default modern design
- clear hierarchy for media-heavy artist sites
- accessible contrast
- consistent responsive behavior

## 25. Initial implementation phases

### Phase 1: Core scaffolding and preview loop

Build:

- platform auth
- GitHub linking
- Vercel or Netlify linking
- repo generator for the Next.js + Puck template
- one or two musician templates
- structured content model
- image upload into repo assets
- AI edit request -> branch -> PR -> preview flow
- build/typecheck/lint/smoke validation

### Phase 2: Migration and richer content workflows

Build:

- existing-site import flow
- page extraction and mapping
- richer photo gallery flows
- page add/remove workflows
- better change summaries
- better error/failure UX

### Phase 3: polish and advanced capabilities

Build:

- optional visual diffing
- more template families
- richer theme controls
- limited advanced widget library
- improved spam protection
- domain/DNS assistance

## 26. Suggested implementation decisions for Claude Code

Claude Code should assume the following defaults unless explicitly changed:

1. framework: Next.js + Puck + TypeScript (ADR-007)
2. hosting: Vercel or Netlify
3. content source of truth: repo files
4. images: stored in `public/images/`, with responsive variants generated at upload time
5. interactivity: server-rendered components, client components only where justified
6. review model: branch + PR + deploy preview
7. contact form: the site's `/api/contact` route + Resend
8. tests: lint + typecheck + build + smoke tests
9. portability: always preserved

## 27. Explicit implementation rules for generated sites

1. Prefer server-rendered components; add a client component only when stateful interactivity is needed.
2. Prefer structured content edits over JSX/component edits.
3. Keep diff surface area as small as possible.
4. Keep all site-critical content and assets in the repo.
5. Do not require a database for the site itself.
6. Make the site run locally with a normal install/dev flow.
7. Do not introduce framework complexity unless justified.
8. Keep the architecture understandable by a competent frontend engineer.
9. Preserve accessibility, performance, and portability in every change.
10. Make it easy for future AI edits by keeping code organized and explicit.

## 28. Open questions / future decisions

These are not blockers for initial implementation, but should be resolved during development:

1. Should the platform use GitHub App permissions or OAuth plus repo access?
2. Should customer repos live in customer-owned accounts only, or can some be bootstrapped under a platform org and transferred?
3. What is the exact migration quality bar for importing existing sites?
4. How should tour dates be modeled if customers want frequent updates?
5. Should downloadable assets such as PDFs/EPKs live in `public/` by default?
6. What level of visual theme customization should be exposed directly in the platform UI?
7. Should the platform support DNS/domain setup guidance in v1 or leave that manual?
8. What is the pricing and billing model for AI usage and hosting orchestration?

## 29. Immediate next step for Claude Code

Claude Code should begin by implementing a minimal but production-shaped v1 foundation with the following sequence:

1. create the platform architecture skeleton
2. implement GitHub, Vercel/Netlify and Resend integration scaffolding
3. implement a canonical Next.js + Puck musician-site template
4. implement structured content and asset conventions
5. implement image upload and repo asset placement
6. implement AI request -> branch -> change -> validate -> PR -> preview flow
7. implement clear status/error reporting
8. implement one polished end-to-end happy path for creating and editing a musician site

## 30. Summary

Build a platform that orchestrates AI-driven creation and maintenance of simple musician websites, while keeping the websites themselves static-first, repo-owned, preview-driven, portable, and easy to edit both manually and through natural language. The platform is an orchestration layer around GitHub, Vercel or Netlify, structured repo content, and AI coding workflows—not a proprietary site runtime or CMS.

