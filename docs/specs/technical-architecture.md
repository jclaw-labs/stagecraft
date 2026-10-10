# Musician Site Platform — Technical Architecture, Milestones, and Tickets

## 1. Purpose

This document translates the product specification into an execution-oriented technical architecture plan for implementation. It is intended to guide Claude Code and human contributors through the first production-shaped version of the platform.

This document covers:

- system architecture
- service boundaries
- data model assumptions
- repo/template architecture
- integration architecture
- job orchestration
- deployment model
- validation model
- phased milestones
- ticket backlog
- acceptance criteria

This is an implementation document, not a marketing or product-positioning document.

---

## 2. System Summary

The platform consists of two major layers:

1. **Platform application**
   A web application and backend that orchestrates site creation, site editing, AI-driven repo changes, GitHub pull requests, and Netlify deploy previews.

2. **Generated customer site repos**
   Independent GitHub repositories owned by the customer, containing Astro + React + TypeScript static-first musician websites.

The platform should act as an orchestrator, not a proprietary website runtime.

---

## 3. Architectural Principles

### 3.1 Repo-owned customer sites
Customer website code, assets, and structured content must live in the customer repo.

### 3.2 Orchestration over lock-in
The platform coordinates AI, GitHub, Netlify, and preview workflows. It should not create a dependency on proprietary content storage for customer websites.

### 3.3 Preview-first workflow
Meaningful changes should go through branch creation, validation, PR creation, and deploy preview before publish.

### 3.4 Constrained AI edits
AI changes should be guided by:

- repo conventions
- the musician-site template (one seeded site shape, styled by themes)
- schema-validated structured content files — the primary editing surface
- validation steps (content schema validation must pass before commit)
- limited task scopes
- a strict preference hierarchy: content files first, theme/config second, component code only for structural changes

### 3.5 Static-first delivery
Generated websites should be static-first, with minimal client-side JS and selective interactive islands.

### 3.6 Portability
Customers should be able to clone, run, and edit their site repos without platform dependency.

---

## 4. Proposed Platform Architecture

### 4.1 Top-level components

The platform should be split into the following major components:

1. **Frontend app**
2. **Platform API / backend**
3. **Job orchestration layer**
4. **AI execution worker**
5. **Git provider integration module**
6. **Hosting integration module**
7. **Asset ingestion pipeline**
8. **Generated site template system**
9. **Validation pipeline**
10. **Platform persistence layer**

### 4.2 Suggested implementation shape

A reasonable v1 architecture:

- **Frontend**: Next.js or equivalent app framework for the platform UI
- **Backend/API**: same app backend or route handlers plus background job system
- **Database**: small platform DB for platform metadata only
- **Queue/jobs**: durable background job runner for AI and Git operations
- **AI worker**: containerized or isolated worker process that can clone repos, edit files, run checks, and push branches
- **Generated site repos**: Astro + React + TypeScript templates

The platform app framework does not need to match the generated customer site framework.

---

## 5. Platform Service Boundaries

### 5.1 Frontend app responsibilities

The frontend should handle:

- user authentication
- integration connection flows
- site list / site detail views
- create-site wizard
- migration wizard
- edit request UI
- upload UI for images and content
- status/progress UI for jobs
- preview/review UI
- approval/rejection actions
- settings and environment configuration screens

### 5.2 Backend/API responsibilities

The backend should handle:

- authenticated API endpoints
- integration token storage and usage
- site record management
- job creation and status tracking
- orchestration of AI tasks
- orchestration of GitHub/Netlify operations
- audit/event recording
- webhook handling

### 5.3 AI worker responsibilities

The AI worker should handle:

- cloning customer repos
- checking out branches
- applying structured instructions to the repo
- running local validation commands
- generating summaries of changes
- committing and pushing branches
- surfacing machine-readable outcomes and errors

### 5.4 Job queue responsibilities

The queue should handle:

- asynchronous site generation
- edit request execution
- migration/import processing
- validation jobs
- webhook follow-up tasks
- retry policies for transient failures

---

## 6. Platform Data Model

The platform may use a database, but it must not be used as the source of truth for customer site content.

### 6.1 Core entities

Suggested platform entities:

#### User
- id
- email
- displayName
- createdAt
- updatedAt

#### IntegrationAccount
- id
- userId
- provider (`github`, `netlify`)
- providerAccountId
- access metadata / encrypted credentials reference
- scopes/permissions metadata
- connectedAt
- updatedAt

#### Site
- id
- userId
- name
- slug
- status
- blueprintType (vestigial: always `solo-artist`; there are no blueprints, see product spec §14)
- githubRepoOwner
- githubRepoName
- githubDefaultBranch
- netlifySiteId
- productionUrl
- previewBaseUrl or metadata
- createdAt
- updatedAt

#### SiteEnvironment
- id
- siteId
- key
- valueReference
- scope (`preview`, `production`, `all`)
- createdAt
- updatedAt

#### SiteJob
- id
- siteId
- userId
- type (`create_site`, `edit_site`, `migrate_site`, `repair_site`, `deploy_config`)
- status (`queued`, `running`, `failed`, `completed`, `awaiting_review`, `canceled`)
- requestPayload
- resultPayload
- startedAt
- completedAt
- createdAt

#### ChangeRequest
- id
- siteId
- userId
- jobId
- requestText
- classifiedMode
- branchName
- prNumber
- previewUrl
- summary
- status
- createdAt
- updatedAt

#### AssetUpload
- id
- siteId
- userId
- originalFilename
- normalizedFilename
- mimeType
- uploadStatus
- temporaryStorageRef
- targetRepoPath
- metadata
- createdAt

#### AuditEvent
- id
- userId
- siteId
- actorType
- eventType
- payload
- createdAt

### 6.2 Notes

- `requestPayload` and `resultPayload` can be JSON blobs in v1.
- secrets should never be stored directly in plain text.
- site content should not be copied into this DB except for convenience metadata or operational summaries.

---

## 7. External Integration Architecture

### 7.1 GitHub integration

Preferred model:

- GitHub App for repo-level operations where possible
- OAuth for user identity if needed

GitHub integration should support:

- repo creation from template
- branch creation
- commit/push via app/user permissions
- PR creation
- PR status reading
- webhook handling for PR events if needed

### 7.2 Netlify integration

Netlify integration should support:

- site creation / linking to repo
- deploy settings configuration
- environment variable management
- deploy preview discovery
- production deploy status discovery
- webhook/event ingestion if needed

### 7.3 AI provider integration

The platform should manage model access centrally.

This integration should support:

- task invocation with constrained prompts
- structured result capture
- retry and timeout policies
- logging/observability

### 7.4 Email delivery integration

Use Resend for generated site contact forms.

Platform responsibilities:

- inject required environment variables into generated site deploys
- optionally verify domain setup guidance
- provide recipient configuration per site

---

## 8. Generated Site Template Architecture

Each customer site should be created from a canonical template system.

### 8.1 Template goals

The template system should:

- standardize repo structure
- standardize content model
- standardize validation scripts
- standardize visual primitives
- constrain AI edits
- remain understandable to human developers

### 8.2 Canonical generated stack

Each site should initialize with:

- Astro
- React integration enabled
- TypeScript strict mode
- ESLint
- formatter configuration
- Playwright smoke tests
- content schema validation
- Netlify config
- README
- CLAUDE.md
- EDITING.md

### 8.3 Generated site repo layout

```txt
/
  package.json
  tsconfig.json
  astro.config.mjs
  netlify.toml
  README.md
  CLAUDE.md
  EDITING.md
  /src
    /assets
      /images
    /components
    /layouts
    /pages
    /lib
    /styles
    /content
      /config
      /pages
      /collections
  /public
    /favicons
    /downloads
  /netlify
    /functions
  /tests
    /smoke
  /.github
    /workflows
```

### 8.4 Content model within generated sites

Structured content must live in schema-validated files, not in component code. The content model is **schema-first**: every piece of editable content has a declared shape before any component renders it.

#### Content categories

Content falls into four categories with a strict preference ordering for AI edits:

1. **Structured content** — bio, headlines, releases, photos, press quotes, tour dates, contact copy, SEO metadata. This is the primary AI editing surface.
2. **Theme and config** — site settings, nav, color palette, font choices. Secondary editing surface.
3. **Layout and component code** — `.astro` and React files. Rarely edited; only for structural changes.
4. **AI-only structural changes** — page additions, new section types. Explicitly classified; always reviewed.

#### Singletons (one per site, stable paths)

| Singleton | Path |
|-----------|------|
| Site settings | `src/content/config/site.json` |
| Navigation | `src/content/config/nav.json` |
| Theme tokens | `src/content/config/theme.json` |
| Homepage content | `src/content/pages/home.mdoc` |
| About / bio | `src/content/pages/about.mdoc` |
| Contact page | `src/content/pages/contact.mdoc` |

#### Collections (zero or more items, stable shapes)

| Collection | Path pattern |
|-----------|-------------|
| Releases | `src/content/collections/releases/*.json` |
| Photos | `src/content/collections/photos/gallery.json` |
| Videos | `src/content/collections/videos/videos.json` |
| Tour dates | `src/content/collections/tourDates/dates.json` |

#### Normalized image metadata

Every image reference in any content file must carry:

| Field | Required | Notes |
|-------|----------|-------|
| `src` | yes | Path under `src/assets/images/` |
| `alt` | yes | Descriptive alt text |
| `caption` | no | Optional display caption |
| `credit` | no | Photographer credit |
| `focalPoint` | no | `{ x, y }` crop hint |
| `usageSlot` | no | `"hero"`, `"gallery"`, `"about"`, etc. |

#### Schema validation

All content files must be validated against Zod schemas at build time via `npm run validate:content`. Invalid content must fail the build with a clear, field-level error message. The validation script is the single source of schema truth — components, AI edits, and any future editor UI all conform to the same schemas.

### 8.5 Styling model

Use a constrained token-based styling system.

Suggested token files:

- `theme.json`
- typography tokens
- spacing scale
- palette tokens

### 8.6 Interactivity model

Use:

1. `.astro` components for static/presentational sections
2. small native scripts for simple client behavior
3. React islands for complex widgets

---

## 9. Asset Pipeline Architecture

### 9.1 Requirements

The platform must support user-uploaded images for generated sites without introducing a media CMS database.

### 9.2 Asset flow

Suggested flow:

1. user uploads images in platform UI
2. platform temporarily stores uploaded files
3. platform normalizes filenames and validates file types
4. platform associates uploaded images with a site and intended content slot
5. AI worker writes files into target repo path under `src/assets/images/...`
6. content metadata/config entries are added or updated
7. site build generates responsive variants via Astro image handling

### 9.3 Asset validation

The platform should validate:

- MIME type
- maximum file size
- minimum and maximum dimensions
- duplicate filename collision handling
- basic corruption / unreadable image checks

### 9.4 Asset metadata model

Example metadata fields:

- alt text
- usage slot
- caption
- photographer credit
- focal point
- mobile variant mapping

### 9.5 Temporary storage

Temporary platform storage can be used before commit into the repo, but the committed repo remains the durable home for site-critical assets.

---

## 10. Site Creation Flow Architecture

### 10.1 Happy-path create-site flow

1. user connects GitHub and Netlify
2. user enters site name (there is no blueprint to choose; every site gets the same seeded shape — see product spec §14)
3. backend creates `create_site` job
4. job creates repo from the template as-is (no content overlay)
5. job links repo to the hosting project
6. job sets environment variables
7. site deploys and build status is surfaced
8. user opens the site's admin; the first-run welcome wizard asks for artist name, a starting point (theme, custom color, or "Start empty"), an optional wordmark and the first page's title, then writes the seeded content

### 10.2 Create-site service responsibilities

#### API/backend
- validate inputs
- create platform site record
- enqueue job

#### Worker
- create repo
- write initial content
- commit baseline
- configure hosting
- run validation
- summarize result

---

## 11. Edit Request Flow Architecture

### 11.1 Happy-path edit flow

1. user submits plain-language edit request
2. backend stores request as `ChangeRequest`
3. request is classified into one or more modes
4. backend enqueues `edit_site` job
5. AI worker clones repo and creates branch
6. AI worker applies edits
7. AI worker runs validation
8. if successful, AI worker pushes branch and opens PR
9. Netlify creates preview
10. platform surfaces preview URL, summary, and diff metadata
11. user approves or requests revision

### 11.2 Request classification

Initial classifier categories:

- content edit
- image/asset update
- page add
- page remove
- nav change
- style/theme update
- interactive widget update
- repair/debug

### 11.3 Revision flow

If the user rejects or revises a preview:

- either continue on the same branch if still active
- or discard and create a new branch/job

This behavior should be explicit in job state.

---

## 12. Migration Architecture

### 12.1 Purpose

Allow users to migrate an existing simple musician site into the new platform/template system.

### 12.2 Migration phases

1. crawl and extract source site
2. infer information architecture
3. extract page text and media references
4. map content into the template's pages and content schema
5. generate migrated site repo
6. validate and preview
7. user reviews and adjusts manually/through AI

### 12.3 Constraints

Migration should target brochure-style sites only.

v1 should not try to perfectly preserve arbitrary builder-specific widgets.

### 12.4 Migration output

Migration should produce:

- imported structured content files
- downloaded or referenced asset placeholders where legal/feasible
- a migration summary
- a migration confidence report
- a list of items needing manual review

---

## 13. AI Worker Architecture

### 13.1 Runtime model

The AI worker should run in an isolated execution environment with access to:

- repo clone workspace
- asset staging area
- environment for running package manager and validation commands
- integration credentials sufficient for pushing branches and opening PRs

### 13.2 Worker steps for edit jobs

1. fetch job payload
2. clone target repo
3. checkout default branch
4. create/edit working branch
5. hydrate local prompt context from:
   - site template and content schema
   - repo files
   - CLAUDE.md instructions
   - request classification
   - uploaded assets if any
6. apply file changes
7. run validation commands
8. if validation fails, optionally attempt bounded repair
9. generate summary and machine-readable artifact list
10. commit and push
11. open PR
12. return status and metadata

### 13.3 Bounded repair policy

Worker may attempt limited automated fixes for:

- formatting issues
- trivial type errors caused by its own changes
- missing imports
- content schema omissions
- missing referenced asset paths

Worker must not enter indefinite repair loops.

### 13.4 Max retry policy

Use bounded retries for:

- transient network/integration failures
- initial validation repair attempts

Do not retry indefinitely on semantic failures.

---

## 14. Validation Pipeline

### 14.1 Required repo scripts

Each generated site repo should expose at least:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:smoke`
- `npm run validate:content`

### 14.2 Validation order

Recommended validation sequence:

1. content validation
2. lint
3. typecheck
4. build
5. smoke tests

### 14.3 Validation artifacts

Store or surface:

- pass/fail per step
- concise human-readable summary
- raw logs available on demand

### 14.4 CI integration

Generated repos should include GitHub Actions or similar CI so that PRs validate independently of the platform worker.

---

## 15. Deploy Preview Architecture

### 15.1 Expected flow

PR creation should trigger a Netlify deploy preview.

The platform should then:

- poll or receive status updates
- associate preview URL with the relevant `ChangeRequest`
- surface deploy state in the UI

### 15.2 Preview status states

Suggested states:

- queued
- building
- ready
- failed

### 15.3 Review UI requirements

The review screen should show:

- preview URL
- short summary of changes
- validation status
- relevant files changed
- approve / reject / revise actions

---

## 16. Contact Form Architecture

### 16.1 Generated site design

Generated sites with contact forms should include:

- frontend form component
- Netlify Function handler
- Resend API call in the function
- environment variables for sender/recipient configuration

### 16.2 Anti-spam baseline

v1 should include:

- honeypot field
- simple submission validation
- rate limiting hook point or future extensibility

### 16.3 Contact form tests

At minimum:

- frontend renders correctly
- client validation works
- function shape is present

---

## 17. Observability and Auditability

### 17.1 Platform observability

Track:

- job lifecycle events
- integration failures
- validation failures
- preview creation failures
- AI execution durations
- repo operation durations

### 17.2 Audit trail

For each change request, preserve:

- user request text
- job ID
- branch name
- commit SHA(s)
- PR number
- preview URL
- final disposition

### 17.3 User-facing transparency

Surface simplified status messages such as:

- Creating repo
- Applying requested changes
- Running checks
- Waiting for preview
- Ready for review

---

## 18. Security Architecture

### 18.1 Secrets

Secrets must be stored securely and never committed to repos.

Classes of secrets:

- GitHub app credentials
- Netlify credentials/tokens
- Resend API keys
- platform encryption keys

### 18.2 Environment variables in generated sites

The platform should manage only the minimum necessary env vars for:

- contact form delivery
- any other generated-site integrations

### 18.3 Access control

Users should only be able to operate on sites they own or are authorized to manage.

---

## 19. Failure Handling Model

### 19.1 Failure categories

Handle at least:

- integration auth failures
- repo creation failures
- AI edit failures
- validation failures
- PR creation failures
- deploy preview failures
- webhook sync failures
- asset processing failures

### 19.2 Failure response design

Every failure should return:

- technical code/category
- human-readable explanation
- whether retry is safe
- suggested next actions

### 19.3 Recovery affordances

Support:

- retry job
- retry validation only
- discard branch
- revert to last approved state
- open technical details

---

## 20. Suggested Technology Choices

These are suggested defaults, not hard requirements.

### Platform app
- Next.js with TypeScript
- server actions or API routes
- a component library for internal UI

### Platform DB
- Postgres
- Prisma or equivalent ORM

### Background jobs
- queue system suitable for durable async jobs
- examples: hosted queue, Redis-backed queue, or workflow engine

### Worker execution
- isolated containerized worker
- ephemeral filesystem per job

### Generated sites
- Astro + React + TypeScript
- npm or pnpm
- Playwright for smoke tests

---

## 21. Milestones

## Milestone 0 — Foundations and Decisions

### Goal
Establish the architecture skeleton and make key implementation decisions before feature work begins.

### Deliverables
- monorepo or repo strategy decision
- platform stack decision
- DB schema v1
- job orchestration approach decision
- GitHub integration approach decision
- Netlify integration approach decision
- generated site template strategy decision

### Exit criteria
- architecture ADRs written
- platform app boots locally
- DB migrations can run
- stub auth and site list page exist

### Tickets

#### M0-T1: Create architecture decision records
**Description:** Write ADRs for platform app framework, DB, queue, worker model, and integration strategies.
**Acceptance criteria:** ADRs exist and document chosen defaults and rejected alternatives.

#### M0-T2: Initialize platform repository structure
**Description:** Create platform repo structure for frontend, backend modules, worker modules, and shared types.
**Acceptance criteria:** Repository installs and runs basic dev scripts successfully.

#### M0-T3: Define initial database schema
**Description:** Implement initial schema for User, IntegrationAccount, Site, SiteJob, ChangeRequest, AssetUpload, AuditEvent.
**Acceptance criteria:** Migrations apply locally and seed script works.

#### M0-T4: Implement platform authentication stub
**Description:** Add platform auth foundation sufficient to associate users with sites and integrations.
**Acceptance criteria:** A signed-in user can reach a dashboard shell.

#### M0-T5: Build job abstraction layer
**Description:** Create job entity types, enqueue/dequeue abstractions, status model, and placeholder worker runner.
**Acceptance criteria:** A test job can be enqueued, run, and marked complete.

---

## Milestone 1 — GitHub + Netlify Integration Skeleton

### Goal
Enable the platform to connect customer accounts and create/link basic site repos and hosting targets.

### Deliverables
- GitHub connection flow
- Netlify connection flow
- repo creation from template
- site record creation
- basic hosting link establishment

### Exit criteria
- a user can connect GitHub and Netlify
- platform can create a repo from template
- platform can create or link a Netlify site
- platform can persist integration metadata and site metadata

### Tickets

#### M1-T1: Implement GitHub account connection flow
**Description:** Add GitHub OAuth/App install flow and persist linked account metadata.
**Acceptance criteria:** Connected GitHub account is visible in settings and validated via API.

#### M1-T2: Implement Netlify account connection flow
**Description:** Add Netlify connection flow and persist linked account metadata.
**Acceptance criteria:** Connected Netlify account is visible in settings and validated via API.

#### M1-T3: Create GitHub repo service module
**Description:** Build service methods for repo creation, branch creation, file commit/push, and PR creation.
**Acceptance criteria:** Integration tests or manual verification show repo creation and PR creation succeed.

#### M1-T4: Create Netlify site service module
**Description:** Build service methods for site creation/linking and environment variable management.
**Acceptance criteria:** Platform can create or attach a Netlify site to a repo.

#### M1-T5: Build site onboarding backend API
**Description:** Create backend endpoints for site creation requests and integration checks.
**Acceptance criteria:** API can create a Site record tied to connected accounts.

---

## Milestone 2 — Canonical Generated Site Template

### Goal
Create the reusable Astro + React + TypeScript musician-site starter that all customer sites will derive from.

### Deliverables
- canonical starter template repo or generator
- structured content model
- responsive image setup
- baseline design system
- lint/typecheck/build/test scripts
- README, EDITING.md, CLAUDE.md

### Exit criteria
- template runs locally
- template deploys to Netlify
- template passes validation pipeline
- template ships a polished seeded musician site

### Tickets

#### M2-T1: Create Astro + React + TypeScript starter
**Description:** Scaffold canonical generated site template with strict TypeScript and base scripts.
**Acceptance criteria:** Fresh template install/build/dev succeeds.

#### M2-T2: Implement structured content schema
**Description:** Define site config, nav, page content, and collection schemas.
**Acceptance criteria:** Invalid content files fail validation with clear messages.

#### M2-T3: Implement baseline layout/components
**Description:** Create core `.astro` layout/components for home, about, gallery, press, contact, and navigation.
**Acceptance criteria:** Template renders complete brochure-style site.

#### M2-T4: Add responsive image pipeline
**Description:** Configure local asset handling in `src/assets/` and responsive image rendering patterns.
**Acceptance criteria:** Example images render responsively and build successfully.

#### M2-T5: Add optional React island example
**Description:** Implement one interactive React island, such as a lightbox or enhanced media widget.
**Acceptance criteria:** Island hydrates correctly and does not regress static pages.

#### M2-T6: Add validation and smoke tests
**Description:** Add lint, typecheck, build, content validation, and Playwright smoke tests.
**Acceptance criteria:** CI passes on clean template and fails appropriately on intentional errors.

#### M2-T7: Write repo guidance docs
**Description:** Create README, EDITING.md, and CLAUDE.md for generated repos.
**Acceptance criteria:** A human developer can understand local setup and content-editing rules.

---

## Milestone 2.5 — Schema-First Content Architecture Refinement

### Goal
Harden the M2 template with a fully schema-first content model. M2 delivered a working first template; M2.5 makes the content architecture the durable, extensible foundation that all future AI editing and platform features will depend on.

This milestone does not add user-visible features. It refines the internal architecture of the generated site template so that:
- every editable piece of content has a declared, validated schema field
- file naming and path conventions are strict and documented
- components consume structured data rather than mixing content into rendering code
- the AI editing rules in `CLAUDE.md` reflect the schema-first model precisely

### Why between M2 and M3
M3 will generate real customer sites from the template. If the template's content architecture is not solid before M3 ships, every generated site inherits the gaps and the AI editing rules are unclear. It is cheaper to harden the architecture on the template than to retrofit it across live customer repos.

### Deliverables
- audited and refactored content model (singletons + collections with stable, named field shapes)
- normalized image metadata on all image references
- strict file path and naming conventions enforced by the validation script
- components refactored to consume structured content (no content embedded in `.astro`/`.tsx` files)
- updated `CLAUDE.md` with schema-first editing rules
- updated `EDITING.md` with accurate content structure documentation
- all existing tests passing after refactor

### Exit criteria
- `npm run validate:content` catches missing required fields with field-level error messages
- every editable content item maps to a named field in a Zod schema
- no user-facing content strings are hardcoded in component files
- `CLAUDE.md` instructs the AI to edit schema fields first, component code last
- `EDITING.md` accurately describes where to find every piece of content

### Tickets

#### M2.5-T1: Audit template content model
**Description:** Walk through every content item currently in the template and categorize it: does it live in a content file with a named schema field, or is it embedded in component code? Produce a gap list.
**Acceptance criteria:** A documented list of gaps — content that should be in schema files but is currently hardcoded in components.

#### M2.5-T2: Refactor singletons into stable, named schemas
**Description:** Ensure all singleton content files (`site.json`, `nav.json`, `theme.json`, page markdown files) have explicit Zod schemas with named fields for every editable value. No generic blobs. Add missing fields (e.g. SEO metadata, hero headline, CTA button text) if not already present.
**Acceptance criteria:** Each singleton schema documents every field with name, type, and required/optional status. Validation catches missing required fields.

#### M2.5-T3: Refactor collections into stable, named schemas
**Description:** Ensure all collection schemas (releases, photos, videos, press quotes, tour dates) have explicit Zod schemas. Each collection item must have named fields — no freeform blobs or string arrays where structured fields belong.
**Acceptance criteria:** Each collection item validates against its schema. Invalid items fail `validate:content` with a clear field-level error.

#### M2.5-T4: Normalize image metadata across all content files
**Description:** Audit every image reference in the template content files. Add normalized metadata fields (`src`, `alt`, `caption`, `credit`, `focalPoint`, `usageSlot`) per the spec. Update Zod schemas to validate these fields.
**Acceptance criteria:** All image references in content files carry at minimum `src` and `alt`. Missing `alt` fails validation.

#### M2.5-T5: Refactor components to consume structured content only
**Description:** Remove any user-facing content strings that are currently hardcoded in `.astro` or `.tsx` files. Move them to the appropriate content file with a named schema field. Components should receive content via props or by reading content files — not by defining content inline.
**Acceptance criteria:** No user-facing strings (bio text, headings, CTAs, labels specific to the artist) remain hardcoded in component or layout files.

#### M2.5-T6: Enforce file path and naming conventions
**Description:** Ensure the validation script enforces the canonical path conventions: singletons at `src/content/config/*.json` or `src/content/pages/*.md`, collections at `src/content/collections/{name}/*.json`, images at `src/assets/images/{context}/`. Update the validation script to flag files that violate these conventions.
**Acceptance criteria:** Moving a content file to a non-canonical path causes `validate:content` to fail or warn.

#### M2.5-T7: Update CLAUDE.md with schema-first editing rules
**Description:** Rewrite the AI editing instructions in `CLAUDE.md` to reflect the schema-first model. The instructions must: (1) direct the AI to identify the correct schema field before editing anything; (2) state that component code is not the editing surface for content requests; (3) describe the singleton/collection taxonomy; (4) require running `validate:content` after any content-file change.
**Acceptance criteria:** A developer reading only `CLAUDE.md` understands where to find every piece of editable content and knows not to edit component code for routine content changes.

#### M2.5-T8: Update EDITING.md with accurate content structure
**Description:** Rewrite `EDITING.md` to document the final content structure — all singletons, all collections, image conventions, and the path conventions — so that a non-technical user who clones the repo understands where to find and edit their content.
**Acceptance criteria:** `EDITING.md` accurately reflects the post-refactor file structure with at least one example per content category.

---

## Milestone 3 — Create-Site End-to-End Flow

### Goal
Allow a user to create a site from the platform and generate a working repo + deploy target + initial preview.

### Deliverables
- site creation wizard UI
- create-site job execution
- initial content writing
- repo/bootstrap commit flow
- Netlify linkage
- validation run
- preview surfaced in platform

### Exit criteria
- user can create a site from the platform
- generated repo exists in GitHub
- site deploys to Netlify
- preview or production URL is visible in platform

### Tickets

#### M3-T1: Build create-site wizard UI
**Description:** Implement the create-site form (site name). Content, starting point and assets are collected later by the template's welcome wizard.
**Acceptance criteria:** User can submit a valid create-site request through the UI.

#### M3-T2: Implement create-site job orchestration
**Description:** Create `create_site` job flow from API enqueue to worker execution.
**Acceptance criteria:** Job status updates are visible and completion metadata is persisted.

#### M3-T3: Implement repo bootstrap writer
**Description:** Create service that instantiates template content/files for a new customer site.
**Acceptance criteria:** Generated repo includes customer-specific site name, nav, content, and theme config.

#### M3-T4: Implement Netlify bootstrap/link step
**Description:** Link generated repo to Netlify and configure initial settings/env vars.
**Acceptance criteria:** Netlify site is created and build is triggered.

#### M3-T5: Surface create-site results in UI
**Description:** Show site status, repo link, deploy status, and preview/production URL.
**Acceptance criteria:** User can navigate from dashboard to generated site details.

---

## Milestone 4 — Edit Requests, Branches, PRs, and Previews

### Goal
Enable the core AI-assisted editing workflow.

### Deliverables
- edit request UI
- request classification
- worker-based repo editing
- branch creation
- PR creation
- preview association
- review screen

### Exit criteria
- user can request a change in plain language
- branch and PR are created
- preview URL is surfaced
- user can review and choose next action

### Tickets

#### M4-T1: Build edit request submission UI
**Description:** Add site-specific prompt box and request history UI.
**Acceptance criteria:** User can submit a request and see it enter a running state.

#### M4-T2: Implement request classifier
**Description:** Classify edit requests into scoped modes.
**Acceptance criteria:** Requests receive a stored classification used by downstream workers.

#### M4-T3: Implement AI edit worker pipeline
**Description:** Build end-to-end worker flow for clone -> branch -> edit -> validate -> commit -> push.
**Acceptance criteria:** A content-only request succeeds on a sample site.

#### M4-T4: Implement PR creation and persistence
**Description:** Create GitHub PRs for successful edit branches and persist PR metadata.
**Acceptance criteria:** PR number and URL are stored and visible.

#### M4-T5: Implement preview status association
**Description:** Associate Netlify deploy previews with change requests.
**Acceptance criteria:** Ready preview URL appears on the review screen.

#### M4-T6: Build review screen
**Description:** Show preview, summary, validation status, and approve/reject/revise actions.
**Acceptance criteria:** User can review and act on a completed change request.

---

## Milestone 5 — Asset Uploads and Media Editing

### Goal
Support image upload and media-oriented edit workflows.

### Deliverables
- asset upload UI
- temp storage pipeline
- repo asset commit flow
- metadata assignment
- image-oriented edit workflows

### Exit criteria
- user can upload images during creation or editing
- uploaded images can be placed in site sections
- preview correctly reflects uploaded assets

### Tickets

#### M5-T1: Build asset upload service
**Description:** Implement upload endpoint, temp storage, validation, and metadata persistence.
**Acceptance criteria:** Valid images upload and invalid files are rejected clearly.

#### M5-T2: Build asset assignment UI
**Description:** Allow mapping uploaded assets to pages/slots with alt text and optional captions.
**Acceptance criteria:** User can assign images to site content locations.

#### M5-T3: Implement asset injection in worker
**Description:** Make worker consume uploaded assets and write them into repo paths.
**Acceptance criteria:** Uploaded images are committed under normalized repo paths.

#### M5-T4: Implement image-focused edit request support
**Description:** Support requests like “replace homepage hero image” or “add 6 photos to gallery.”
**Acceptance criteria:** Image-focused requests work end-to-end.

---

## Milestone 6 — Error Handling, Recovery, and Repair

### Goal
Make failure cases intelligible and recoverable.

### Deliverables
- structured failure taxonomy
- human-readable failure messages
- retry/discard/revert actions
- bounded auto-repair

### Exit criteria
- major failure modes can be surfaced clearly to users
- operators/devs can inspect technical details
- users can recover without confusion

### Tickets

#### M6-T1: Implement failure taxonomy and status codes
**Description:** Standardize failure categories across integrations, worker runs, and validation steps.
**Acceptance criteria:** Failures are stored with normalized categories and messages.

#### M6-T2: Build user-facing failure summaries
**Description:** Translate technical failures into plain-language explanations and next actions.
**Acceptance criteria:** Failure states are understandable in the UI.

#### M6-T3: Add retry and discard actions
**Description:** Support safe retry of transient failures and discard of failed/unwanted branches.
**Acceptance criteria:** User or operator can trigger these actions from the UI.

#### M6-T4: Add bounded repair mode
**Description:** Allow worker to make limited self-repair attempts after validation failures.
**Acceptance criteria:** Trivial worker-caused failures can self-heal without loops.

---

## Milestone 7 — Migration Flow v1

### Goal
Support basic migration from existing brochure-style musician websites.

### Deliverables
- migration URL intake UI
- crawl/extract service
- schema mapping into the template's content schema
- migration summary/confidence report
- migrated preview

### Exit criteria
- sample brochure site can be migrated into the template structure with reviewable output

### Tickets

#### M7-T1: Build migration intake flow
**Description:** Add UI and API for submitting an existing website URL for migration.
**Acceptance criteria:** User can start a migration job from the platform.

#### M7-T2: Implement basic crawler/extractor
**Description:** Extract routes, text, nav, embeds, and image references from simple brochure sites.
**Acceptance criteria:** Extracted content is persisted as structured intermediate data.

#### M7-T3: Implement content mapper
**Description:** Map extracted content into the template's pages and content schema.
**Acceptance criteria:** Intermediate data can populate a generated repo structure.

#### M7-T4: Generate migration report
**Description:** Produce a human-readable report listing imported content and manual-review items.
**Acceptance criteria:** Migration result includes summary and confidence notes.

#### M7-T5: Connect migration output to preview flow
**Description:** Ensure migrated sites enter the same validation/preview/review pipeline.
**Acceptance criteria:** User can inspect migrated preview and request follow-up changes.

---

## Milestone 8 — Production Readiness and Ops

### Goal
Harden the platform for early real-user usage.

### Deliverables
- webhook handling where needed
- audit/event log improvements
- observability dashboards
- security review items
- onboarding polish

### Exit criteria
- system can support pilot users with confidence
- core operational dashboards/alerts exist
- documentation for support and ops exists

### Tickets

#### M8-T1: Add webhook ingestion and reconciliation
**Description:** Handle GitHub/Netlify events and reconcile job/preview state.
**Acceptance criteria:** Platform state remains accurate without excessive polling.

#### M8-T2: Add observability instrumentation
**Description:** Track job durations, failure rates, queue latency, and integration failures.
**Acceptance criteria:** Basic dashboards/alerts are available.

#### M8-T3: Perform secrets and permission review
**Description:** Audit environment variable handling, stored credentials, and access control boundaries.
**Acceptance criteria:** Security checklist is completed and gaps are tracked.

#### M8-T4: Create operator runbook
**Description:** Document failure modes, manual recovery steps, and support flows.
**Acceptance criteria:** A support engineer can follow the runbook to troubleshoot common issues.

---

## 22. Priority Order for First Execution Sprint

If implementation begins immediately, the first execution sequence should be:

1. M0-T1 through M0-T5
2. M1-T1 through M1-T5
3. M2-T1 through M2-T7
4. M2.5-T1 through M2.5-T8
5. M3-T1 through M3-T5
6. M4-T1 through M4-T6

That sequence delivers the first meaningful end-to-end happy path.

---

## 23. Definition of MVP

The MVP is complete when all of the following are true:

1. a user can connect GitHub and Netlify
2. a user can create a musician site from a canonical template
3. the platform creates a customer-owned repo
4. the site deploys successfully to Netlify
5. the user can request a text/content edit in plain language
6. the platform creates a branch and PR with the requested change
7. the user can review a deploy preview before publish
8. the generated site remains portable and manually editable

---

## 24. Definition of Done for Tickets

A ticket should not be considered complete unless:

- implementation code exists
- happy-path behavior is manually or automatically verified
- relevant tests are added or updated
- failure states are considered
- docs are updated if repo conventions or operator workflows changed

---

## 25. Immediate Instruction to Claude Code

Begin by implementing the platform foundation and the canonical generated-site template in parallel.

Start with:

1. architecture decisions and repo structure
2. platform DB schema and job model
3. GitHub and Netlify integration stubs
4. canonical Astro + React + TypeScript starter template
5. content schema and validation pipeline
6. create-site flow
7. edit-site flow for content-only changes

Deliver small, reviewable increments and preserve portability and preview-first workflows throughout.

