# ADR-007: Musician Site Template — File-Based Visual Editor

## Status
Accepted

## Context
The current `templates/musician-site/` is Astro + Keystatic + Markdoc. Content lives on disk under `src/content/`, validated by Zod schemas in `src/lib/schemas.ts` (per the schema-first conventions in `templates/musician-site/CLAUDE.md`). Keystatic's admin is form-driven; editing page layout means editing `.mdoc` files with custom Markdoc tags.

We want to keep file-based content (artist owns their files via git, no hosted CMS backend) but give artists a true WYSIWYG layout editor: drag-to-reorder blocks, inline preview, controls for image and section sizing, accessed from the production domain rather than local dev.

Astro's `.astro` components are server-only — they don't run in browsers — which is structurally incompatible with a browser-side WYSIWYG that manipulates the same component tree as the production renderer. This forces a runtime change for the template; the platform app (`apps/web`) is unaffected.

## Decision
Rebuild the musician-site template on **Next.js + Puck**, with content stored as JSON / Markdown in the artist's repo, edited via Puck mounted at `/admin`, and published via a Stagecraft-owned **GitHub App** that commits on the artist's behalf.

The existing Astro template is renamed to `templates/musician-site-legacy/`; the new template takes its place at `templates/musician-site/`. Cross-repo references to the existing path (CI workflows, platform code, skills, ADRs) update to `templates/musician-site-legacy/` in the same change set so the legacy template stays operational.

### 1. Runtime framework: Next.js (App Router)
- One deployable unit serves the public site, the `/admin` editor, and the `/api/*` functions for publish + image upload.
- Static export for public pages where possible; functions for the editor's write path only.
- Same framework as the platform app (ADR-001), reducing context-switch for contributors.

### 2. Editor: Puck (`@puckeditor/core`; published as `@measured/puck` up to 0.20)
- MIT-licensed React library; embedded as a route component at `/admin`. No vendor backend.
- Block schema = React components + typed props. Output is plain JSON.
- Ships a complete editor UI (drag handles, inspector, preview, undo) — avoids months of editor-UI work.
- **Set up Puck on its happy path.** Block configs are written natively as Puck `Config` objects (`fields`, `defaultProps`, `render`); we don't force Puck to mirror the existing Markdoc tag set or auto-generate from Zod. The existing tags are a reference for *what kinds of blocks an artist needs*, not a contract for how Puck blocks are configured.
- Rich text within a block: **Tiptap**, wired as a Puck custom field component.

### 3. Schema split: Puck-native blocks, Zod for collections
- **Page-level block schemas live in Puck's `Config`** (`templates/musician-site/src/puck/config.ts`). That config is the source of truth for blocks: their fields, defaults, allowed values, and render. No `zodToPuckField` adapter; no derivation from `src/lib/schemas.ts` for block fields. Idiomatic Puck wins over cross-system DRY.
- **Structured content collections** (releases, tour dates, posts, store items) keep using Zod schemas in `src/lib/schemas.ts` with `as const` enums (per the existing CLAUDE.md rule). These collections feed dynamic blocks (e.g. a `TourDates` block that lists upcoming shows) but the block's *config* — what props the artist sets in the editor — is pure Puck.
- Where a Puck block needs to reference a collection enum (e.g. a "filter by status" prop), the block config can import the const array and map it to Puck `select` options inline. That's a one-line lookup, not an adapter.

### 4. Authentication: magic link via Resend
- Single allowed email per site, set as an env var. No user table.
- Function emails a short-lived signed token; click sets a session cookie; middleware gates `/admin` and `/api/publish`.
- Resend is already a dependency in the current template.
- GitHub OAuth was considered but rejected: it requires a per-site OAuth app and adds a token-refresh story for an editor model that has exactly one user.

### 5. Publish flow: GitHub App + Git Data API
- One Stagecraft-wide GitHub App; artists install it on their site repo at onboarding.
- `POST /api/publish` validates the payload, generates files, commits via Octokit's Git Data API (blob → tree → commit → update ref) in a single commit.
- Commits are authored as the artist (email from session) with the GitHub App as committer.
- Site rebuilds via the existing Netlify/Vercel git integration (~30s–2min propagation; acceptable per requirements).

### 6. Image processing: `sharp` at upload time, variants in repo
- `POST /api/upload-image` runs `sharp().rotate()` (EXIF-correct) and produces variants `400 / 800 / 1600` in **webp + avif**, plus a tiny LQIP placeholder.
- Originals are committed alongside variants so variants can be regenerated if the scheme changes.
- Layout on disk:
  ```
  public/images/<content-slug>/<image-id>/
    original.<ext>
    {400,800,1600}.{webp,avif}
    placeholder.webp
  ```
- Image metadata (`width`, `height`, `blurhash`, `alt`) lives inline in the content JSON; `imageMetadataSchema` extends to include it.
- A single `<Image>` React component reads the metadata and renders a `<picture>` with `srcset` / `sizes` and the placeholder.
- No external image CDN; `public/` is the CDN.
- **Dedup by content hash.** `<image-id>` is the first 16 chars of the SHA-256 of the original bytes. Before processing, the function checks GitHub for an existing `original.<ext>` at the target path (one `GET /contents` call); if present, `sharp` is skipped, no commit is made, and the existing metadata is returned. Re-uploading the same file is a no-op. Byte-level dedup only — re-encodes of the same photo are reprocessed, which is acceptable.
- **Variant-scheme migrations are out of band.** Adding or changing widths/formats is a one-shot maintenance script that walks `public/images/`, reads each `original.<ext>`, and writes the new variants. Not part of the live publish path.

### 7. Drafts: `localStorage` (v1)
- Single-editor, single-device assumption — drafts persist in `localStorage` until publish.
- Cross-device drafts deferred. Future evolution path: drafts as commits to a `drafts/<page>` branch, publish = merge to `main`. Requires no backend, just more publish-flow code.

### 8. Markdoc: removed
- Page bodies become Puck JSON, not `.mdoc`. The Markdoc cross-schema consistency tests (`check:markdoc-config`) and sync script are dropped from the new template.
- Structured-content collections (releases, tour dates, posts, store items) stay as JSON / Markdown files validated by Zod, unchanged.

## Rejected alternatives

- **Stay on Astro + Keystatic.** Form-based editing only; cannot satisfy the WYSIWYG / direct-manipulation requirement. Rejected as the goal.
- **Astro (production) + Puck (admin), shared React blocks.** Architecturally clean and preserves Astro's static output, but maintains two renderers (Astro pages importing React block components vs Puck rendering them in-editor). For a one-developer template, the duplication cost outweighs the perf win, especially since the user explicitly deprioritized SSR.
- **Sanity + Visual Editing.** Best-in-class editor, but Content Lake is proprietary SaaS — not file-based. Fails the "artist owns the files" requirement.
- **TinaCMS.** File-based and Astro-compatible, but its visual editing for Astro is experimental and the editor leans form-driven. Closer to where we are with Keystatic than where we want to go.
- **Plasmic / Builder.io.** Excellent visual editors, but the editor itself is hosted on the vendor's infrastructure. Fails the "no backend" requirement.
- **Craft.js.** Headless framework — gives more flexibility than Puck but ships no UI; we'd build drag handles, inspector, undo, etc. ourselves. Maintainer has openly questioned the project's future ([prevwong/craft.js#483](https://github.com/prevwong/craft.js/issues/483)). Yellow flag for a multi-year foundation.
- **BlockNote.** Excellent Notion-style editor, but optimized for prose-with-blocks, not free-form layout with section/column/width controls. Wrong shape for musician landing pages.
- **GitHub commits direct from browser (no functions).** OAuth token exchange requires a `client_secret` that can't live in the browser, so a function is needed regardless. Once the function exists, having it own the commit simplifies auth and avoids exposing the artist to PAT management.

## Consequences

- **Two templates coexist during migration.** The Astro template moves to `templates/musician-site-legacy/` and stays operational; the new template builds up at `templates/musician-site/` until it reaches parity. Skills that reference Keystatic config (e.g. `recreate-artist-site`) update their paths to `templates/musician-site-legacy/` in the rename change set.
- **Platform app unchanged.** ADR-001 (Next.js for `apps/web`) stands. ADR-006 (NextAuth + GitHub OAuth for the platform) stands. Site-level auth is independent (magic link, single email).
- **New shared concerns surface in `packages/shared`.** Image-metadata types and GitHub-commit helpers belong there if they're used by both the template and platform tooling. Puck `Config` itself stays inside the template — it's template-specific, not cross-package.
- **Block schemas diverge from the SSOT rule in `templates/musician-site/CLAUDE.md` §1.** That rule continues to apply to Zod-validated collection content. Puck block configs are exempt: they're written idiomatically per Puck's docs, even when that means duplicating an enum literal at a block-config site. The trade is intentional — fighting Puck's idioms costs more than the duplication it would prevent.
- **Repo-size growth.** Image variants live in the artist's git repo. Manageable for one artist over years; if Stagecraft hosts many high-volume sites in a single repo later, Git LFS becomes the answer.
- **No SSR for the public site.** Pages are statically exported. Acceptable per requirements; revisit only if dynamic per-request behavior becomes necessary.
- **GitHub App is a new platform-level artifact.** App registration, installation flow at onboarding, and credential storage are net-new platform work — separate ADR when designed.
- **Markdoc tooling removed from the new template.** Tests and scripts under the old template still apply to the old template; the new template doesn't inherit them.
