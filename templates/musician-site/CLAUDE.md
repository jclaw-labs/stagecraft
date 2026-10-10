# CLAUDE.md — `templates/musician-site` (Next.js + Puck)

Conventions for the musician-site template per ADR-007.

## Stack

- Next.js 15 (App Router)
- React 19
- Puck (`@puckeditor/core`) — visual block editor at `/admin`
- Files only; no database. Content lives in `src/content/`.

## Editor philosophy

Set up Puck on its happy path. Block configs are written natively as
Puck `Config` objects (`fields`, `defaultProps`, `render`). The
existing legacy template's tags are a reference for *what* artists need,
not a contract for *how* Puck is configured.

The block library at `src/puck/config.tsx` is the source of truth for
block schemas — one library for pages, collection templates and item
bodies (#349). `buildPuckConfig` (`src/puck/build-config.tsx`) is the only
place a Puck `Config` is assembled: an `editor` variant per surface (page,
body, item template, detail template) and a `render` variant. Don't auto-generate it from Zod; don't share block
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
      not-found.tsx         Themed 404 body
    global-not-found.tsx    404 for unmatched URLs, in the public layout.
                            No root not-found.tsx: Next would put it in
                            every admin response's RSC payload.
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
      publish-status/       Vercel/Netlify deploy state proxy
      upload-image/         sharp-based image processor + dedup
      collections/[slug]/items/             generic CRUD for any collection
                                            (pages included)
      collections/[slug]/items/[itemSlug]/  per-item GET / PUT / PATCH / DELETE
      collections/[slug]/order/             PUT: write `_order.json`
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
    config.tsx              Block library — every block, page root
                            fields, drawer categories
    build-config.tsx        buildPuckConfig: the one config factory
                            (editor surfaces + render)
    ImagePickerField.tsx    Custom field for image picking
  lib/
    fs-helpers.ts           Shared filesystem primitives used by every
                            content-store layer + publish:
                            contentDir, localPathForRepoPath,
                            readJson, writeJson, unlinkIfExists,
                            readdirFiltered, stringifyContent, isNotFound
    content.ts              Read helpers for pages + singletons +
                            multi-page summary listings
    page-data.ts            Puck page shape (`PageData`), `emptyPageData`,
                            `pageValuesForSave` (client-safe)
    save-content.ts         `saveContent`: the one admin save path
    site-config-types.ts    Zod schemas for site / header / appearance
                            singletons and pages list contract
    collections/            ADR-009 Collection abstraction (foundation
                            + template renderer + generic editor UI):
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
                              migrate-block-library.ts
                                          #349 content migration:
                                          old template-primitive
                                          vocabulary → the one block
                                          library (run via
                                          scripts/migrate-block-library.mjs)
                              migrate-from-legacy.ts
                                          Pure converters between the
                                          legacy PageData/SiteConfig/
                                          HeaderConfig/Appearance
                                          shapes and the new Item shape
                              template/   Template renderer. Walker
                                            resolves Bindables top-down
                                            (pages, templates and item
                                            bodies alike); Puck's
                                            <Render> then renders the
                                            resolved data. Block
                                            components are pure (no
                                            context, no "use client"),
                                            see only literal props.
                                binding.ts    Bindable<T> resolution
                                              (resolveBindable,
                                              resolveStringBindable)
                                bindable-slots.ts  Which block props
                                              take a Bindable<T>
                                              (BINDABLE_SLOTS)
                                tiptap-render.tsx  Tiptap doc → React
                                renderer.tsx  <TemplateRenderer> +
                                              `resolveTemplate` walker
                                item-detail.tsx  Default detail page
                                              for items whose collection
                                              has no detailTemplate
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

`/admin` is the editor surface. The sidebar in `AdminShell` lists two
groups:

1. **Custom admin surfaces** (top, curated UX) — Pages, Site Settings,
   Header & Navigation, Appearance.
2. **Collections** (under a header) — every other collection
   registered in `_collections.json`, listed alphabetically by plural
   name. Each links to the generic
   `/admin/collections/<slug>` list view (or
   `/admin/collections/<slug>/items/_singleton` for singletons).

### Custom admin surfaces

Every editable collection has a generic editor at
`/admin/collections/<slug>/items/<itemSlug>`. For collections where we
want a richer, hand-authored UX, the platform ships a dedicated panel
at a stable URL. These are registered in
`src/components/admin/admin-surfaces.ts` (`CUSTOM_ADMIN_SURFACES`),
which is the single source of truth for which collections have one.
Registering a collection there:

- Adds it as a top-level sidebar entry in the "Custom" group, before
  the generic Collections group. Order in the array is the sidebar
  order.
- Bounces direct visits to
  `/admin/collections/<slug>/items/_singleton` to the registered
  `route` (same pattern as `/admin/pages` being canonical for the
  pages collection).
- Hides the collection from the generic Collections sidebar group, so
  Site Settings doesn't appear twice.

The four custom surfaces today:

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
component, posting to the generic
`PUT /api/collections/<slug>/items/_singleton` endpoint — the same
path the generic editor uses. One save API, two surfaces. Adding a
new custom panel is a small file: route at `/admin/<name>`, an entry
in `admin-surfaces.ts`, a call to `useSettingsForm({ collectionSlug,
toValues })`.

The PagesPanel's drag-reorder uses
`PUT /api/collections/pages/order` (writes `_order.json`); the
eye-toggle does `GET` → flip `showInNav` → `PUT` against the
per-item endpoint. Both paths live under `/api/collections/...` —
the legacy `/api/save-config` endpoint is gone.

## Collections (ADR-009)

Every editable surface — pages, singletons, tour dates, releases,
posts, store items, photos, videos — is an instance of the unified
**Collection** abstraction. Each Collection owns its schema, items,
and Puck-edited templates. Full design in
`docs/adr/009-unified-collection-model.md`; the eight-PR shipping plan
is at §15.

The full ADR-009 stack landed; storage is collection-backed for every
surface. The legacy `src/lib/content.ts` shim translates the
collection store back into the `PageData` / `SiteConfig` / `HeaderConfig`
shapes the public renderer + the legacy Pages admin consume — those
two consumers haven't been rewritten to read `Item` directly. New
admin work goes through the generic collection routes
(`/admin/collections/<slug>`); the `/admin/pages` editor is kept as
canonical because of its drag-and-drop / nav-toggle UX.

**Client-bundle discipline.** `schema.ts` imports `node:crypto` for
`generateFieldId` / `generateItemId`; `store.ts` imports `node:fs`. As
of ADR-011 the barrel also transitively reaches `next/headers`
(server-only): `read-store.ts` → `publish.ts` → `draft-branch.ts` →
`auth.ts` (which imports `cookies`). Same hazard as the node imports — a
*value* import of `@/lib/collections` from a `"use client"` file drags
these into the client bundle and fails the build.
Client components that need types or runtime helpers from those files
import via sibling submodules that have no node imports:

- `lib/collections/filter-schema.ts` — `filterSchema` + Filter types
- `lib/collections/field-classification.ts` — `SLUG_SOURCE_COMPATIBLE_TYPES`,
  `SORTABLE_FIELD_TYPES`, `FIELD_TYPE_OPTIONS` / `fieldTypeLabel`,
  `LOSSLESS_TYPE_TRANSITIONS` / `canTransition` (re-exported by
  `schema-changes.ts`)
- `lib/collections/template/view-requirements.ts` — which fields each
  specialised card view (`specialized-views.tsx`) reads, by role and
  accepted type (plus the tour-dates `status` the default block filters
  on). A role resolves by field id, or by a same-name field once that id
  is gone; that brings the card back, but the default Collection
  block's saved sort and filter still name the old id. Drives the
  default-card fallback and the schema editor's remove / retype warnings
- `lib/collections/puck-content-value.ts` — `puckContentValue(data)` helper
- `lib/collections/field-ids.ts` — stable field-id constants for the
  prebaked collections (`PAGES_FIELD_IDS` etc.). `seeds.ts` re-exports
  for source-compat.
- `lib/collections/migrate-from-legacy-values.ts` — `*ToItemValues` /
  `*FromItem` conversion helpers used by the three custom singleton
  panels at save time. `migrate-from-legacy.ts` re-exports for
  source-compat + adds the crypto-using `pageDataToItem` helper.

When you need a value (not just a type) from `schema.ts` in a
`"use client"` file and there's no client-safe submodule yet, either
(a) inline a tiny local helper, as `SchemaEditor.tsx:newFieldId` does,
or (b) split the value out into a new node-import-free file alongside
the three above.

## Design tokens

Follows the monorepo-wide rule in the root `CLAUDE.md` §6. All visual
values (colors, fonts, spacing, sizes, radii, shadows) come from CSS
custom properties — no hardcoded hex, sizes, or weights in CSS, in
inline `style={...}` props, or in HTML returned from route handlers.

The token set is defined at `src/app/globals.css` (imported from
`src/app/layout.tsx`, and from `src/app/global-not-found.tsx`, which
bypasses the root layout). Naming follows the shared prefix conventions
(`--color-*`, `--font-size-*`, `--font-weight-*`, `--space-*`,
`--radius-*`) so it stays consistent with `apps/web/`.

## Validation

```bash
npm run typecheck
npm run lint
npm run test       # vitest unit + component tests
npm run test:e2e   # Playwright admin e2e (needs `npx playwright install chromium` first)
npm run build
```

Run before committing.

## E2E tests (Playwright)

The admin surface — wizard completion, danger-zone reset — has
end-to-end coverage under `e2e/`. Specs drive the real Next dev
server against an isolated content directory.

| Path                          | Purpose                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `playwright.config.ts`        | Test runner config. Pins `STAGECRAFT_CONTENT_DIR` to a tmpdir so specs can wipe/seed without touching `src/content/`. Single worker — serial specs against one content dir. |
| `e2e/setup/global-setup.ts`   | Signs in once via `/api/auth/dev-login`, saves `storageState.json`. Every spec arrives authenticated. |
| `e2e/setup/seed.ts`           | `wipeContentDir` (fresh-site state), `seedCompletedSite` (post-wizard state), `seedDemoContent` (checked-in demo site) and `seedDetailPageFixtures` (one item per unlinked detail-page collection). Specs call these from `beforeEach` / `beforeAll`. |
| `e2e/welcome.spec.ts`         | Walks the 4-step wizard end-to-end; asserts the redirect to `/admin/pages` + the seeded Home page. Plus: a completed site bypasses the wizard. |
| `e2e/reset.spec.ts`           | Three-stage danger-zone confirm (idle → warned → confirming) + the type-to-confirm gating + the post-reset return to `/admin/welcome`. |
| `e2e/not-found.spec.ts`       | Admin HTML and RSC payloads carry no public layout or theme; unknown admin and public URLs get their own 404s with status 404. |
| `e2e/puck-editors.spec.ts`    | Smoke test of the real Puck editors (unit tests mock Puck): the page editor and the tour-dates item template editor each load, take a block dragged in from the drawer, edit it in the fields panel, save via Publish, and log no console errors. Run it after any Puck upgrade. |
| `e2e/canvas-matches-public.spec.ts` | The Puck canvas iframe and the public page lay the demo home page out the same at 1280px: body margin and background, plus each Section's position, width, padding and radius. The canvas gets the theme by wrapping its root in `.stagecraft-site` with `AppearanceStyles` (`Editor.tsx`'s `iframe` override). |

**Adding a new spec.** New admin surfaces follow the same pattern:
`beforeEach` calls one of the seed helpers to put the dev server's
content dir in a known state, then drive the UI. New specs go under
`e2e/` and pick up the auth + config automatically. Field IDs in
`seed.ts` are imported from `src/lib/collections/field-ids.ts` (the
SSOT), so a schema rename propagates through TS rather than via
hand-mirrored strings.

## Authentication (ADR-007 §4)

One or more allowed editor emails per site (the editor allowlist), gated by middleware. Magic-link flow:

1. Visit `/admin` → middleware redirects to `/admin/login`
2. Enter email → POST `/api/auth/request` → token emailed
3. Click email link → GET `/api/auth/verify?token=...` → session cookie set, redirect to `/admin`

**Env vars:**

| Var | Required | Notes |
| --- | --- | --- |
| `MAGIC_LINK_SIGNING_SECRET` | prod | Random string, ≥32 bytes. Used to sign JWTs (HS256). Rotate forces re-login. In dev, falls back to a hardcoded placeholder if unset. |
| `ADMIN_EMAILS` | prod | Editor allowlist — comma/whitespace-separated emails (case-insensitive). Any email off the list gets the same "check your email" response (no enumeration). Re-checked at magic-link verify, so a removed editor's outstanding link can't mint a session (`getAllowedEditorEmails` / `isAllowedEditor` in `auth.ts`). |
| `ADMIN_EMAIL` | prod | Legacy single-editor var. Still honored and unioned into the allowlist, so sites provisioned before `ADMIN_EMAILS` keep working. In dev, when both are unset, the request handler accepts any submitted email. |
| `RESEND_API_KEY` + `MAGIC_LINK_FROM` | prod | Provisioned automatically by `/create` from the artist's own Resend account (connected at `/settings` on the platform). Each artist site uses its owner's account end-to-end — the platform never sees recipient addresses. Without these, magic links log to the dev server console. |

**Cookie:** `mc_session`, HttpOnly, SameSite=Lax, 7-day max age. `Secure` flag set in production.

Middleware (`src/middleware.ts`) gates `/admin/*` and `/api/save`. `/admin/login` is allowlisted. API routes return 401; pages redirect.

**Server-side session access:** `getSession()` from `@/lib/auth` reads the cookie and verifies it. Use it in Server Components and route handlers.

**Local setup (zero-config):** `npm run dev`, visit `/admin/login`, click **Sign in as dev admin (skip magic link)**. The button only renders when `NODE_ENV !== "production"` and POSTs to `/api/auth/dev-login`, which returns 404 in production. The auth library also falls back to a hardcoded dev secret when both `MAGIC_LINK_SIGNING_SECRET` and `STAGECRAFT_BROKER_SECRET` are unset (dev only), so no env vars are needed to sign in.

**Local setup (production-faithful):** copy `.env.example` to `.env.local` and fill in `MAGIC_LINK_SIGNING_SECRET` + `ADMIN_EMAILS`. Use the regular "Send sign-in link" button — with `RESEND_API_KEY` / `MAGIC_LINK_FROM` unset, the magic-link URL logs to the dev server console; copy/paste it into the browser. In dev only, the request handler emits a `console.warn` when the submitted email isn't on the allowlist (production stays silent to prevent enumeration).

**Logging out:** the editor header shows the signed-in email and a Sign out button that POSTs to `/api/auth/logout`. The endpoint is POST-only by design — a GET logout would be a CSRF foot-gun (any external `<img src>` could log everyone out).

## Images (ADR-007 §6)

**Pipeline.** `POST /api/upload-image` accepts a multipart form with `file`, `contentSlug`, and `alt`. The handler:

1. Validates MIME type (raster: `jpeg`/`png`/`webp`/`avif`; vector / icon: `svg+xml`, `vnd.microsoft.icon`, `x-icon`) and size (≤25 MB).
2. Computes a 16-char SHA-256 content hash → used as the image id.
3. If the original already exists at the target path, skips processing (dedup; ADR-007 §6).
4. **Raster only:** runs `sharp().rotate()` (EXIF-correct) and emits variants `400/800/1600` in **webp + avif**, plus a tiny inline-base64 LQIP placeholder.
5. **Vector / icon (SVG, ICO):** bypasses sharp entirely. No variants and no LQIP (sharp can rasterise SVG but the output wouldn't drive the `<picture>` srcSet flow, and sharp can't parse ICO at all). `isVectorExt(originalExt)` is the predicate consumers use to skip variant lookups. **SVGs run through `sanitiseSvg` (DOMPurify, SVG profile) before they land on disk** — strips `<script>`, `<foreignObject>`, `on*` event handlers, and `javascript:` URLs. The dedup branch reads from disk on re-upload, so subsequent reads see sanitised content. ICO bytes are written byte-for-byte (binary; no JS-execution surface through `<link rel="icon">`). Defense-in-depth: `next.config.ts` sets `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` on `/images/<slug>/<id>/original.svg` responses, so a direct top-level URL navigation to a raw SVG triggers a download dialog rather than inline render. Inline `<img src>` requests ignore the disposition, so the gallery flow is unaffected. ICO uploads (artist favicons) get the same `nosniff` + Content-Type pin but NOT the attachment disposition (would break the favicon use case).
6. Returns `ImageMetadata` (zod-validated).

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

- `POST /api/collections/<slug>/items` — create an item. The Pages
  panel creates pages here (`{ slug, values }`, values built from
  `emptyPageData`). For `pages` it also refuses a slug that would
  shadow a collection's detail URL prefix (409).
- `PUT /api/collections/<slug>/items/<itemSlug>` — write any
  collection item (used by the generic editor, the three custom
  singleton panels with `itemSlug=_singleton`, and the page editor).
  The page editor's Puck "Publish" button only saves: it reads the
  page item, merges the editor's content over it with
  `pageValuesForSave`, and PUTs it to the draft branch.
- `PATCH /api/collections/<slug>/items/<itemSlug>` — rename an item
  (`{ newSlug }`). For `pages` it runs the same shadow-prefix check as
  create (409).
- `DELETE /api/collections/<slug>/items/<itemSlug>` — delete an item
  (the Pages panel's delete).
- Draft commits for pages read "Create / Update / Delete page <slug>";
  other collections use "<verb> <collection>/<item>"
  (`itemCommitSubject` in `src/lib/collections/commit-subject.ts`).
- `PUT /api/collections/<slug>/order` — write a collection's
  `_order.json` (used by the Pages panel's drag-reorder). Validates
  every slug in the requested order against on-disk items; phantoms
  return 400.

Save semantics (`src/lib/save-content.ts`): every settings/page
mutation builds and validates its files in memory and saves them with
`saveContent`. With the platform configured, the files are committed
to the draft branch and **nothing is written to the server's disk** (it
is read-only or discarded on serverless hosts); a failed commit is
never `ok: true`. The content save routes answer it with
`saveFailureResponse` — `{ ok: false, code, error }`, 502 (409 for
`concurrent-edit`, 503 for `no-platform-configured`). The two welcome
routes save with `publishTo: "main"` (`saveAndPublish` in
`src/lib/publish.ts`), so they publish to `main` as well: when the draft commit lands but the publish
to `main` fails, the save stands, so they answer `ok: true,
published: false, publishWarning` rather than a failure.

Without the platform in a dev build (`NODE_ENV !== "production"`),
local disk is the content store: the route's local write runs, and
then the publish layer's local mode writes the same targets to disk
again. A production build without the platform refuses the save
(503 `no-platform-configured`) instead of writing to disk.

**Local-write atomicity.** Content writes go through
`writeJsonAtomic` (per-file: write to tmp sibling, then `rename` into
place — POSIX atomic for same-filesystem renames). Multi-file writes
that need all-or-nothing-ish semantics (schema saves with per-item
migrations) go through `writeJsonBatchAtomic`, which stages all
tmps in phase 1 before any renames in phase 2. A failure in phase 1
(stringify error, disk full, validation slip) leaves NO final files
touched. Phase 2 is per-file atomic but not all-or-nothing across
files — a crash mid-batch can leave some files new and some old;
true cross-file atomicity needs a journal and isn't worth the
complexity for the sub-second write windows we see in practice.

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

These ship in stacked PRs.

> **Collection blocks on hand-authored pages (ADR-015, done).** Pages embed a
> collection via the generic Collection block (`<Slug>View`, e.g.
> `TourDatesView`): the public catch-all walks the page through the ADR-009
> template renderer (`resolveTemplate` + `buildPuckConfig`'s render variant),
> resolving each block's `sourceCollection`/`sort`/`filter` against the live
> collection; the page editor authors them via `buildPuckConfig`'s page
> surface. This replaced the
> bespoke `TourDatesView`/`ReleasesView`/`PostsView` page blocks +
> `resolvePageCollectionBlocks` (deleted). Any collection is embeddable — no
> per-collection code. Per-slug card layouts live in `specialized-views.tsx`.
