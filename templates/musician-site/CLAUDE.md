# CLAUDE.md — `templates/musician-site` (Next.js + Puck)

Conventions for the new musician-site template per ADR-007. The legacy
Astro + Keystatic template lives at `templates/musician-site-legacy/` —
its conventions don't apply here.

## Stack

- Next.js 15 (App Router)
- React 19
- Puck (`@measured/puck`) — visual block editor at `/admin`
- Files only; no database. Content lives in `src/content/`.

## Editor philosophy

Set up Puck on its happy path. Block configs are written natively as
Puck `Config` objects (`fields`, `defaultProps`, `render`). The
existing legacy template's tags are a reference for *what* artists need,
not a contract for *how* Puck is configured.

The Puck config at `src/puck/config.tsx` is the source of truth for
block schemas. Don't auto-generate it from Zod; don't share block
schemas with the legacy template. ADR-007 explicitly exempts Puck
block configs from the cross-system SSOT rule in the top-level
`CLAUDE.md` §1.

## Where things live

```
src/
  app/
    (public)/
      layout.tsx            Public layout: injects appearance CSS vars +
                            Google Fonts <link>
      [[...slug]]/page.tsx  Catch-all for every public URL:
                              /         → splash page or 'home'
                              /<slug>   → src/content/pages/<slug>.json
    admin/
      page.tsx              Redirects to /admin/pages
      login/page.tsx        Magic-link sign-in form
      pages/page.tsx        Pages list — add / delete / open in editor
      pages/[slug]/page.tsx Puck editor for one page
      settings/page.tsx     Site Settings form (artistName, social, footer)
      navigation/page.tsx   Header & Nav form (mode, layout, subtitle).
                            Nav order + per-page visibility live on the
                            Pages list (drag handle + eye toggle per row).
      appearance/page.tsx   Colors + typography form
    api/
      publish/              Per-page publish (back-compat)
      publish-status/       Vercel/Netlify deploy state proxy
      upload-image/         sharp-based image processor + dedup
      pages/                GET list, POST create
      pages/[slug]/         DELETE
      save-config/          POST: site-config | header-config | appearance
      collections/[slug]/items/             PR 4 — generic CRUD
      collections/[slug]/items/[itemSlug]/  for any collection
  components/
    Image.tsx               Public <picture> renderer for ImageMetadata
    Header.tsx              Public site header (artist name + nav)
    Footer.tsx              Public site footer (social links + copyright)
    AppearanceStyles.tsx    Inline <style> + Google Fonts <link>
    admin/                  Reusable admin form primitives:
      AdminShell.tsx          sidebar + panel chrome
      AdminAccountButton.tsx  signed-in avatar + sign-out menu
      form.tsx                TextField, SelectField, CheckboxField,
                              NumberField, ColorField, Field, FieldGroup
      SaveBar.tsx             sticky bottom save bar (idle/saving/saved/error)
      useSettingsForm.ts      dirty-tracking + POST hook (shared by all
                              singleton forms)
  puck/
    config.tsx              Puck Config — blocks, root fields, render
    ImagePickerField.tsx    Custom field for image picking
  lib/
    fs-helpers.ts           Shared filesystem primitives used by every
                            content-store layer + publish:
                            contentDir, localPathForRepoPath,
                            readJson, writeJson, unlinkIfExists,
                            readdirFiltered, stringifyContent, isNotFound
    content.ts              Read/write helpers for pages + singletons +
                            multi-page summary listings
    site-config-types.ts    Zod schemas for site / header / appearance
                            singletons and pages list contract
    collections/            ADR-009 Collection abstraction (foundation
                            + template renderer + PR 3 wrappers — no
                            generic editor UI yet):
                              schema.ts   Zod schemas as SSOT; TS types
                                          inferred via z.infer
                              store.ts    Filesystem layer (uses
                                          fs-helpers)
                              accessors.ts Runtime-narrowing field
                                          accessors (getText, getImage,
                                          ...)
                              seeds.ts    Prebaked CollectionDefs for
                                          pages / site / header /
                                          appearance + their field-id
                                          maps
                              migrate-from-legacy.ts
                                          Pure converters between the
                                          legacy PageData/SiteConfig/
                                          HeaderConfig/Appearance
                                          shapes and the new Item shape
                              template/   PR 2 — template renderer.
                                            Walker resolves Bindables
                                            top-down; Puck's <Render>
                                            then renders the resolved
                                            data. Block components
                                            are pure (no context, no
                                            "use client"), see only
                                            literal props.
                                binding.ts    Bindable<T> resolution
                                              (resolveBindable,
                                              resolveStringBindable)
                                primitives.tsx  Primitive block library
                                              (Section, Stack, Text,
                                              Image, Button, Link,
                                              RichTextRender) +
                                              PRIMITIVE_BLOCKS registry
                                              (frozen).
                                puck-config.ts  templatePuckConfig
                                              built from the registry
                                tiptap-render.tsx  Tiptap doc → React
                                renderer.tsx  <TemplateRenderer> +
                                              `resolveTemplate` walker
                              index.ts    Public API
                              test-fixtures.ts  Shared fixtures
                                          (tourDatesDef, tourDateItem)
    publish.ts              Multi-target publish flow (page,
                            site-config, header-config, appearance,
                            delete-page; plus collection-def,
                            collection-item, collection-order,
                            delete-collection-item) over the broker →
                            GitHub path with dev-disk fallback
    git-commit.ts           Octokit blob/tree/commit/update-ref helper;
                            supports `deletePaths` for page deletion
    auth.ts                 JWT signing/verifying for magic links +
                            sessions (jose, Edge-runtime safe)
    image*.ts               sharp pipeline + ImageMetadata schema
  content/
    pages/<slug>.json       One Puck JSON file per page
    config/site.json        Site Settings singleton
    config/header.json      Header & Navigation singleton
    config/appearance.json  Appearance (colors + typography) singleton
```

## Admin shell

`/admin` is the editor surface. The sidebar in `AdminShell` lists four
sections:

- **Pages** — `/admin/pages` is the landing page. Lists every page on
  disk; each row carries a drag handle (reorder = nav order +
  Pages-list order, persisted to `siteConfig.pageOrder`), an eye toggle
  (`siteConfig.hiddenFromNav`), an Edit button into Puck, and a Delete
  button. Inline "Add page" form (auto-slug from title); after creating
  a page the artist stays on the list — Edit opens the Puck editor at
  `/admin/pages/<slug>` (which fills the viewport).
- **Site Settings** — `/admin/settings` — Identity (artist name, site
  title, description, contact email), Social links (9 platforms),
  Footer (copyright holder, hide-footer site-wide).
- **Header & Navigation** — `/admin/navigation` — Wordmark + sizing,
  Header style (mode, layout, uppercase, subtitle, transparent
  foreground color). Nav order + per-page nav visibility live on the
  Pages list — the single editor for both keeps the source-of-truth
  obvious.
- **Appearance** — `/admin/appearance` — 9 named color tokens (each
  with a swatch + text input) and Typography (body font/weights +
  optional split heading font/weights).

Each singleton panel uses the same `useSettingsForm` hook + `SaveBar`
component, so adding another singleton later is a small file. Per-page
settings (title, isSplashPage, isFooterHidden) live on the Puck `root`
fields and surface in the editor's right-hand inspector when no block
is selected.

## Collections (ADR-009)

The template is moving to a unified **Collection** abstraction where
pages, singletons, tour dates, releases, posts, store items, photos, and
videos are all instances of the same type. Each Collection owns its
schema, items, and Puck-edited templates. Full design in
`docs/adr/009-unified-collection-model.md`.

Shipping order (per ADR-009 §15):

1. **Foundation** *(current PR)* — types, dynamic Zod builder, item
   store, runtime-narrowing accessors, publish target kinds. Lives at
   `src/lib/collections/`. No UI; no public renderer changes; nothing
   currently consumes it.
2. Item template renderer + data binding primitives.
3. Pages migration (Pages becomes a Collection).
4. Generic item editor.
5. Schema editor UI.
6. Template Puck editors (item + detail).
7. First non-pages collection (tour dates) end-to-end.
8. Prebaked collections (releases, posts, store items, photos, videos).

Until PR 3 lands, pages and singletons keep their existing storage
(`src/content/pages/`, `src/content/config/`) and existing code paths
(`content.ts`, `site-config-types.ts`). The new `collections/` module is
parallel — empty on disk by default and unreachable from any UI.

## Design tokens

Follows the monorepo-wide rule in the root `CLAUDE.md` §7. All visual
values (colors, fonts, spacing, sizes, radii, shadows) come from CSS
custom properties — no hardcoded hex, sizes, or weights in CSS, in
inline `style={...}` props, or in HTML returned from route handlers.

The token set is defined at `src/app/globals.css` (imported once from
`src/app/layout.tsx`). Naming follows the shared prefix conventions
(`--color-*`, `--font-size-*`, `--font-weight-*`, `--space-*`,
`--radius-*`) so it stays consistent with `apps/web/` and the legacy
template.

## Validation

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Run before committing.

## Authentication (ADR-007 §4)

Single allowed email per site, gated by middleware. Magic-link flow:

1. Visit `/admin` → middleware redirects to `/admin/login`
2. Enter email → POST `/api/auth/request` → token emailed
3. Click email link → GET `/api/auth/verify?token=...` → session cookie set, redirect to `/admin`

**Env vars:**

| Var | Required | Notes |
| --- | --- | --- |
| `MAGIC_LINK_SIGNING_SECRET` | prod | Random string, ≥32 bytes. Used to sign JWTs (HS256). Rotate forces re-login. In dev, falls back to a hardcoded placeholder if unset. |
| `ADMIN_EMAIL` | prod | Single allowed email. Anything else gets the same "check your email" response (no enumeration). In dev, when unset, the request handler accepts any submitted email. |
| `RESEND_API_KEY` + `MAGIC_LINK_FROM` | prod | Provisioned automatically by `/create` from the artist's own Resend account (connected at `/settings` on the platform). Each artist site uses its owner's account end-to-end — the platform never sees recipient addresses. Without these, magic links log to the dev server console. |

**Cookie:** `mc_session`, HttpOnly, SameSite=Lax, 7-day max age. `Secure` flag set in production.

Middleware (`src/middleware.ts`) gates `/admin/*` and `/api/save`. `/admin/login` is allowlisted. API routes return 401; pages redirect.

**Server-side session access:** `getSession()` from `@/lib/auth` reads the cookie and verifies it. Use it in Server Components and route handlers.

**Local setup (zero-config):** `npm run dev`, visit `/admin/login`, click **Sign in as dev admin (skip magic link)**. The button only renders when `NODE_ENV !== "production"` and POSTs to `/api/auth/dev-login`, which returns 404 in production. The auth library also falls back to a hardcoded dev secret when both `MAGIC_LINK_SIGNING_SECRET` and `STAGECRAFT_BROKER_SECRET` are unset (dev only), so no env vars are needed to sign in.

**Local setup (production-faithful):** copy `.env.example` to `.env.local` and fill in `MAGIC_LINK_SIGNING_SECRET` + `ADMIN_EMAIL`. Use the regular "Send sign-in link" button — with `RESEND_API_KEY` / `MAGIC_LINK_FROM` unset, the magic-link URL logs to the dev server console; copy/paste it into the browser. In dev only, the request handler emits a `console.warn` when the submitted email doesn't match `ADMIN_EMAIL` (production stays silent to prevent enumeration).

**Logging out:** the editor header shows the signed-in email and a Sign out button that POSTs to `/api/auth/logout`. The endpoint is POST-only by design — a GET logout would be a CSRF foot-gun (any external `<img src>` could log everyone out).

## Images (ADR-007 §6)

**Pipeline.** `POST /api/upload-image` accepts a multipart form with `file`, `contentSlug`, and `alt`. The handler:

1. Validates MIME type (`jpeg`/`png`/`webp`/`avif`) and size (≤25 MB).
2. Computes a 16-char SHA-256 content hash → used as the image id.
3. If the original already exists at the target path, skips processing (dedup; ADR-007 §6).
4. Otherwise, runs `sharp().rotate()` (EXIF-correct) and emits variants `400/800/1600` in **webp + avif**, plus a tiny inline-base64 LQIP placeholder.
5. Returns `ImageMetadata` (zod-validated).

**On disk:**
```
public/images/<content-slug>/<image-id>/
  original.<ext>
  {400,800,1600}.{webp,avif}
```

**Rendering.** `<Image>` from `@/components/Image` consumes `ImageMetadata` and emits a `<picture>` with avif → webp `<source>` tags, lazy loading, async decoding, explicit width/height (CLS-safe), and the LQIP as `background-image` for instant paint. The component is intentionally a thin renderer — alt comes from the metadata, not a separate prop. ESLint's `jsx-a11y/alt-text` rule is overridden to allow this for our `Image` component (see `eslint.config.mjs`).

**Migration.** Variant scheme changes are out of band — a one-shot script that walks `public/images/`, reads each `original.<ext>`, and writes new variants. Not part of the live publish path.

**Editor integration.** The `Image` Puck block uses a custom field (`src/puck/ImagePickerField.tsx`) that wraps `/api/upload-image`: the artist picks a file, types alt text, hits Upload — the field stores the returned `ImageMetadata` as the block's value. The public render path passes that metadata straight to the `<Image>` component above. Editor-side state stays in the field component; the field is `"use client"` since Puck calls it inside the editor surface.

**Production vs dev:** when the platform env vars are configured (see Publishing below), the route commits the original + every variant to the artist's repo through the broker (one commit per upload). Without the env vars (local dev), it writes the same files to `public/images/` so the dev server can serve them.

**TODO (covered by stacked PRs):**
- GitHub-backed dedup check. Today both code paths recompute variants on every upload; the broker path produces a no-op tree for re-uploads (deterministic blob SHAs) but still creates a commit. A `getContent`-based pre-check would skip the commit entirely.

## Publishing (ADR-007 §5, ADR-008)

The publish flow is multi-target by design — one round-trip can write a
page, a singleton, multiple files, or a mix. Each `PublishTarget` has
its known repo path and Zod schema so a bad payload from the API fails
before the GitHub call.

Endpoints:

- `POST /api/publish` — single-page publish from the Puck editor's
  `onPublish` (back-compat path; takes `{ pageSlug, data }`).
- `POST /api/save-config` — write one of `site-config`, `header-config`,
  `appearance` (discriminated body `{ kind, data }`).
- `POST /api/pages` — create a new empty page (writes the file + commits).
- `DELETE /api/pages/[slug]` — delete a page (removes the file +
  commits a tree entry with `sha: null` via `commitFiles`).

Save semantics: every settings/page mutation writes locally **first**,
then publishes through the broker → GitHub path. A publish failure
surfaces as `{ ok: true, publishWarning }` so the artist keeps a
usable local copy — the next save retries the publish.

**Production (platform configured):**
1. Validate magic-link session.
2. POST `STAGECRAFT_PLATFORM_URL/api/publish-token` with `{ siteId }` and `Authorization: Bearer STAGECRAFT_BROKER_SECRET`.
3. Broker mints a short-lived GitHub App installation token + returns `{ owner, repo }`.
4. Octokit Git Data API: blob → tree → commit → update ref. One commit per save, structured trailer `Stagecraft-Publish-Id: <uuid>`. Author is the artist's email; committer is the App.
5. Return `{ ok: true, commitSha }`.

**Dev fallback (platform not configured):** writes JSON directly to
`src/content/pages/<slug>.json` and `src/content/config/*.json`.
Detected by missing `STAGECRAFT_SITE_ID` or `STAGECRAFT_BROKER_SECRET`.

**Env vars:**

| Var | Required | Notes |
| --- | --- | --- |
| `STAGECRAFT_PLATFORM_URL` | prod | Base URL of the broker. Trailing slash tolerated. |
| `STAGECRAFT_SITE_ID` | prod | Platform's `Site.id` for this deployment. Namespaced because Netlify reserves `SITE_ID` for its own injected site identifier. |
| `STAGECRAFT_BROKER_SECRET` | prod | Per-site shared secret with the platform; sent as `Authorization: Bearer`. Generated by platform at install time. |
| `SITE_GIT_BRANCH` | no | Defaults to `main`. |

**Errors:** structured envelope `{ ok: false, code, error }` with codes `unauthorized`, `validation-failed`, `broker-unreachable`, `broker-rejected`, `github-failed`, `no-platform-configured`. Broker rejection → 502; GitHub failure → 500.

**Auth note (vs ADR-008 wording):** ADR-008 §2 sketches the broker auth as "forwarded magic-link cookie." That's not actually verifiable cross-service (the artist site signs sessions with its own secret, which the platform doesn't hold). Implementation uses a per-site `STAGECRAFT_BROKER_SECRET` provisioned at install. ADR-008 should be amended to reflect this; tracked as a follow-up.

## What's intentionally not here yet

- **Platform-side endpoints** (token broker, install callback, webhook) — separate PR; without them, publish runs in dev fallback.
- **Collection editor** (releases, tour dates, posts, store items) — the
  legacy `src/content/collections/` shape is well-defined but a dedicated
  UI surface for editing structured collection entries hasn't landed yet.
  When it does, those collections plug back in through Puck blocks like
  `<TourDatesList>` that read collection JSON at render time.
- **Curated Google Fonts picker** — Appearance currently takes a free-text
  family name. The legacy template's category + curated-per-category
  picker can come back later (the Zod shape we persist is already
  forwards-compatible — just one string).
- **Per-page background image override** — the legacy template let each
  page override the site-wide `pageBackground`. Surfaced through Puck's
  root fields when it lands; the on-disk shape lives in
  `site-config-types.ts`'s `pageRootPropsSchema`.

These ship in stacked PRs.
