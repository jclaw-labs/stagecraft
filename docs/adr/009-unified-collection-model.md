# ADR-009: Unified Collection model for musician-site

## Status
Proposed

## Context

ADR-007 established the musician-site template as Next.js + Puck, with two
parallel data systems:

- **Pages.** Stored as Puck JSON at `src/content/pages/<slug>.json`. Each
  page has a fixed root-level schema (title, isSplashPage, isFooterHidden)
  and a body of dragged-and-dropped blocks.
- **Singletons.** Stored as JSON at `src/content/config/{site,header,appearance}.json`,
  edited via dedicated forms at `/admin/{settings,navigation,appearance}`.
- **Collections** (releases, tour dates, posts, store items, photos, videos)
  were planned to remain Zod-validated files, with block configs in Puck
  consuming them. ADR-007 §3 made block configs an exception to the
  cross-system SSOT rule.

Three product requirements emerged while planning the collection editors
that the original split can't accommodate cleanly:

1. **Artists should be able to fully edit every collection's schema** — add
   fields, remove fields, rename, reorder, change types. A "Tour dates"
   collection ships with a sensible default schema (date / venue / city /
   status / ticketUrl), but the artist can rework it to fit their site.
   Prebaked schemas are conveniences, not contracts.
2. **The visual layout of how a collection item renders should itself be
   editable** in the same Puck-style direct-manipulation surface as page
   bodies — drag blocks, position elements, set sizes — with block props
   bindable to item fields (a Text block whose content is `{{venue}}`).
3. **Every collection item should get a per-item detail URL** at a
   collection-configured prefix (`/shows/<slug>`, `/news/<slug>`, etc.).

Pursuing those three jointly surfaced an architectural opportunity: **a
page is structurally the same as a collection item.** A page has a slug, a
title, a Puck-edited body, and a URL. A collection item has a slug, named
field values, and a URL. If we generalise, Pages becomes one collection
among many — special only in the admin UI affordances it gets, not in the
data layer.

This ADR records that generalisation and the design decisions that follow
from it.

## Glossary

Defined here once; used throughout the rest of the ADR.

- **Collection.** A named type of content (`pages`, `tourDates`,
  `releases`, …). Owns a schema, a set of items, and one or more
  templates. Configured by a `CollectionDef` stored at
  `src/content/collections/<slug>/_collection.json`.
- **CollectionDef.** The TypeScript shape that describes a collection:
  identity (slug, names), schema (fields), templates (item / detail /
  list), routing (detail URL prefix), ordering, and feature flags
  (`isSingleton`).
- **Item.** One entry in a collection — one tour date, one release, one
  page. Stored at `src/content/collections/<slug>/items/<itemSlug>.json`.
  Carries a stable `id` (`item_<uuid>`, generated via `generateItemId()`)
  that survives renames; the URL slug is the filename and can change.
- **Schema.** The set of `FieldDef`s on a collection. Editable by the
  artist via the schema editor (§11 guardrails apply).
- **Field.** One configurable attribute on items in a collection — for
  tour dates, that's "date", "venue", "city", "status", "ticketUrl".
- **FieldDef.** The TypeScript shape describing one field — its id, key,
  type, required-ness, and any type-specific config (options, mime
  filters, etc.).
- **FieldId.** Internal stable identity of a field — `fld_<uuid>`.
  Never visible to the artist. Item values reference fields by id, so
  renaming is free. Generated via `generateFieldId()` from the
  collections module.
- **FieldKey.** Artist-facing name of a field ("venue"). Renameable
  without breaking item values, because the id stays put.
- **FieldValue.** A typed value held by an item for one field — a
  discriminated union over the field types.
- **Primitive block.** A building-block React component used to compose
  templates and page bodies. Three sub-kinds:
  - **Layout primitive**: `Section`, `Stack`, `Columns`, `Spacer`.
  - **Content primitive**: `Text`, `RichText`, `Image`, `Button`,
    `Link`, `Embed`, `Audio`.
  - **Field-render primitive**: `RichTextRender`, `PuckContentRender` —
    placeholder blocks whose only purpose is to render a richText or
    puckContent field at this position in a template.
- **Collection block.** A block that embeds an entire collection on a
  page or detail template — `TourDatesView`, `ReleasesView`, etc. At
  render time, it loads items from its source collection and renders
  each via the source collection's **itemTemplate**.
- **Template.** A piece of Puck JSON describing a per-item layout.
  Three kinds, all optional per collection:
  - **itemTemplate** — how an item renders when listed inside a
    Collection block (compact card / row). Built from Primitive blocks
    only. No Collection blocks (§4 cycle safety).
  - **detailTemplate** — how an item renders on its own detail page at
    `<detailUrlPrefix>/<slug>`. Built from Primitive blocks plus
    Collection blocks.
  - **listTemplate** — optional default layout for an auto-generated
    list page (e.g. an automatic `/shows` index). When null, the artist
    builds the list page as a regular Page that contains the
    appropriate Collection block.
- **Bindable\<T\>.** A prop value that can be either a literal of type
  `T` or a binding to a field of compatible type. Resolved at render
  time. Only meaningful inside templates (§4).
- **Binding.** The specific case of a `Bindable` whose value comes from
  a field rather than a literal.
- **Detail page.** The per-item public URL at
  `<detailUrlPrefix>/<itemSlug>`. Optional — a collection can have items
  with no detail pages (e.g. a "Quotes" collection that only exists to
  feed Collection blocks).
- **Singleton.** A collection with exactly one item, used for site-level
  settings (`site`, `header`, `appearance`). The admin UI hides item-list
  affordances and routes the collection's URL straight to the editor for
  its single item.
- **collectionRef / multiCollectionRef.** Field types whose value is a
  reference (or ordered list of references) to items in another
  collection. The target collection is fixed on the `FieldDef`; the
  value stores just item id(s). See §6 for the three-way distinction
  between `collectionRef`, `multiCollectionRef`, and a filtered
  Collection block.
- **Current-item context.** The item being rendered by the surrounding
  template. Threaded through the renderer so that Collection-block
  filters can reference the current item via `currentItemId` or
  `currentItemField` (§5.1). For Pages, the page itself is the
  current item; for any other collection's detailTemplate, the item
  being shown.
- **schemaVersion.** `CollectionDef.schemaVersion` — always `1` on
  v1-shaped files. Bumped on breaking model changes so a future
  migration runner can rewrite older shapes deterministically rather
  than inferring "what version is this" from missing-field heuristics.
- **System timestamps.** `Item.createdAt` and `Item.updatedAt` —
  store-owned ISO 8601 strings. `createItem` sets both to "now";
  every `writeItem` rewrites `updatedAt`. Callers can't override;
  the store always normalises.
- **systemLocked.** Flag on a `FieldDef` marking it as non-editable by
  the artist (cannot be deleted, renamed, or retyped via the schema
  editor). Used for prebaked fields the renderer or routing depends on,
  e.g. `Pages.title` and `Pages.body`.

## Decision

Introduce a single `Collection` abstraction. Every editable surface on a
musician site — pages, singletons, tour dates, releases, posts, store
items, photos, videos — is a collection. Storage, validation, publish,
routing, and the editor UI are written once and work for every
collection.

### 1. Core types

```ts
// Stable identity for fields so renames don't break item references.
type FieldId = string;        // UUID-ish; never visible to the artist
type FieldKey = string;       // current name; renameable

// Every variant carries these in addition to its type-specific fields:
//   id          stable internal identifier
//   key         artist-facing name
//   systemLocked? `true` on prebaked fields the artist must not delete,
//                 rename, or retype (e.g. Pages.title, Pages.body).
//                 Enforced in the schema editor (PR 5); code-driven
//                 template migrations can still rewrite these by
//                 editing the JSON directly.
type FieldDef =
  | { /* base */ type: "text"; required: boolean; maxLength?: number }
  | { /* base */ type: "longText"; required: boolean }
  | { /* base */ type: "richText"; required: boolean }       // Tiptap JSON
  | { /* base */ type: "number"; required: boolean; min?: number; max?: number; step?: number }
  | { /* base */ type: "boolean"; default?: boolean }
  | { /* base */ type: "select"; required: boolean; options: SelectOption[] }
  | { /* base */ type: "multiSelect"; options: SelectOption[]; minItems?: number; maxItems?: number }
  | { /* base */ type: "date"; required: boolean; includeTime?: boolean }
  | { /* base */ type: "url"; required: boolean }
  | { /* base */ type: "email"; required: boolean }
  | { /* base */ type: "color"; required: boolean }
  | { /* base */ type: "image"; required: boolean }          // uses existing image pipeline
  | { /* base */ type: "file"; required: boolean; mimeFilter?: string[] }   // covers audio, PDF, etc.
  | { /* base */ type: "collectionRef"; required: boolean; targetCollection: string }
  | { /* base */ type: "multiCollectionRef"; targetCollection: string; minItems?: number; maxItems?: number }
  | { /* base */ type: "puckContent" };                      // full Puck block layout

type CollectionDef = {
  // Always 1 on v1 files. Bumped on breaking model changes; the
  // migration runner (deferred) keys off this to rewrite older shapes
  // before consumers see them. Forces every committed file to declare
  // its version explicitly — future migrations don't have to infer.
  schemaVersion: 1;

  slug: string;                       // "pages" | "tour-dates" | "releases" | …
  singularName: string;               // "page" | "tour date"
  pluralName: string;                 // "pages" | "tour dates"

  // ── Schema ──────────────────────────────────────────────────────
  fields: FieldDef[];
  /**
   * Field whose value derives an item's URL slug. Must reference a
   * field whose stored value is slugifiable: text / longText / select
   * / url / email / date / number. Pointing at puckContent / image /
   * etc. fails CollectionDef validation.
   */
  slugSourceFieldId: FieldId | null;

  // ── Routing ─────────────────────────────────────────────────────
  // Detail pages are independent of listTemplate. A collection can be
  // embedded in Collection blocks without having public detail pages
  // (e.g. a Quotes collection), and can have detail pages without an
  // auto-generated list page (the artist builds the list page as a
  // regular Page that hosts the relevant Collection block).
  detailUrlPrefix: string | null;     // "/", "/shows", "/news"; null = no detail pages

  // ── Ordering ────────────────────────────────────────────────────
  defaultSort:
    | { mode: "manual" }                                          // see §7 _order.json
    | { mode: "fieldSort"; fieldId: FieldId; direction: "asc" | "desc" }
    | null;                                                       // null = filesystem order

  // ── Templates (all optional) ────────────────────────────────────
  itemTemplate: PuckData | null;      // compact rendering inside Collection blocks; Primitives only (§4)
  detailTemplate: PuckData | null;    // detail-page rendering; Primitives + Collection blocks
  listTemplate: PuckData | null;      // optional auto-generated list page; null = author as a Page

  // ── Flags ───────────────────────────────────────────────────────
  isSingleton: boolean;               // true for settings/header/appearance: hides item-list UI
};

type FieldValue =
  | { type: "text"; value: string }
  | { type: "longText"; value: string }
  | { type: "richText"; value: TiptapJSON }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "select"; value: string }
  | { type: "multiSelect"; value: string[] }
  | { type: "date"; value: string }                  // ISO 8601
  | { type: "url"; value: string }
  | { type: "email"; value: string }
  | { type: "color"; value: string }                 // #rrggbb
  | { type: "image"; value: ImageMetadata }
  | { type: "file"; value: { src: string; mimeType: string; originalName: string; sizeBytes: number } }
  | { type: "collectionRef"; value: { itemId: ItemId } }         // target collection comes from FieldDef
  | { type: "multiCollectionRef"; value: ItemId[] }              // ordered; target collection comes from FieldDef
  | { type: "puckContent"; value: PuckData };

type ItemFile = {
  id: string;                     // stable; never reused
  createdAt: string;              // ISO 8601; set by createItem
  updatedAt: string;              // ISO 8601; rewritten by every writeItem
  values: Record<FieldId, FieldValue>;
};

// In-memory shape includes the URL slug (derived from the filename).
type Item = ItemFile & { slug: string };
```

**System-owned timestamps.** `createdAt` and `updatedAt` ship in v1
rather than being added later, because backfilling them across every
artist's committed item history would be lossy (the original times
aren't recoverable from git history alone). The store owns them: every
`writeItem` rewrites `updatedAt`, and `createItem` sets both. Callers
provide them in the `Item` shape but the store always normalises on
write — there's no "save with my own updatedAt" API. Future binding
support (PR 2) will let templates display them as pseudo-fields
(`_createdAt`, `_updatedAt`) without storing them inside `values`.

`FieldDef` and `FieldValue` are exhaustive discriminated unions: every
consumer that walks fields or values gets compile-time exhaustiveness
checks. `Item.values` is `Record<FieldId, FieldValue>` — type-safe at the
*kind* level but not at the *which-fields-are-present* level (see §10).

### 2. Pages as a collection

Pages stop being a special data path. The "pages" collection ships with:

```ts
{
  schemaVersion: 1,
  slug: "pages",
  singularName: "page",
  pluralName: "pages",
  detailUrlPrefix: "/",                                                // each page at /<slug>
  isSingleton: false,
  fields: [
    // title and body are systemLocked — the renderer and routing
    // depend on them. The schema editor (PR 5) won't let the artist
    // delete, rename, or retype either.
    { id: "fld_title",       key: "title",          type: "text",       required: true, systemLocked: true },
    { id: "fld_isSplash",    key: "isSplashPage",   type: "boolean" },
    { id: "fld_hideFooter",  key: "isFooterHidden", type: "boolean" },
    { id: "fld_showInNav",   key: "showInNav",      type: "boolean" },  // Goal 2 (nav→pages) folds in here
    { id: "fld_body",        key: "body",           type: "puckContent", systemLocked: true },
  ],
  slugSourceFieldId: "fld_title",
  defaultSort: { mode: "manual" },                                     // artist drags pages in /admin/pages
  itemTemplate: <compact "page link" card for sitemap-style listings>, // optional
  detailTemplate: <Puck template rendering the body field>,
  listTemplate: null,                                                  // pages list is admin-only, no public list page
}
```

Pages today edit the body directly in a full Puck workspace. In the new
model, the workspace is the detailTemplate editor with the body field
"pinned" as its content surface — same UX, generic implementation
underneath. The itemTemplate is optional: Pages rarely appear inside view
blocks, but providing one (title + excerpt, say) enables a "Recent pages"
or "Site map" Collection block if the artist wants one.

The Pages collection retains its sidebar entry and its specialised "add
page" affordance because it's the foundational surface — but it executes
on the generic stack. The `/admin/pages` route becomes a thin
view-customiser over `/admin/collections/pages`.

### 3. Singletons as 1-item collections

`site`, `header`, `appearance` become collections with `isSingleton: true`.
A singleton collection hides the item-list UI and routes
`/admin/collections/<slug>` directly to the single item's editor. The
existing `/admin/{settings,navigation,appearance}` routes survive as
aliases backed by the generic editor — same code path as every other
collection — keeping muscle memory and search-engine-style discoverability
in the admin sidebar.

A future "Settings" surface can group several singleton collections under
one screen without changing the storage model.

### 4. Templates and data binding

Every collection has up to three templates (all optional, see Glossary):
**itemTemplate**, **detailTemplate**, **listTemplate**. All are Puck JSON
authored in a Puck editor specifically for templates.

The two block kinds — **Primitive blocks** and **Collection blocks** —
are also defined in the Glossary. Recapping the relationship:

- itemTemplate may use **Primitive blocks only**.
- detailTemplate and listTemplate may use **Primitive blocks plus
  Collection blocks**.

#### 4.1 Bindings: how a Primitive block knows what to render

A template is rendered many times against different items (the
itemTemplate renders once per item in a Collection block; the
detailTemplate renders for each item visiting its detail page). The
artist authors the template once; the renderer fills in field values per
item. The mechanism is **bindings**.

Every Primitive block's content-bearing prop is typed `Bindable<T>`:

```ts
type Bindable<T> =
  | { kind: "literal"; value: T }
  | { kind: "binding"; fieldId: FieldId };
```

The artist controls this prop's `kind` from the block's inspector in the
template editor. The inspector shows a small toggle (literal ↔ field)
above each bindable input.

**Worked example.** Artist is editing the tour-dates `itemTemplate` at
`/admin/collections/tourDates/template/item`. They drop a Stack and add
two Text blocks inside it.

For the first Text block ("Venue label"), they want the same word on
every card:

```
Inspector → Text block
─────────────────────────────────────
Content:    [● Literal]  [○ From field]

            ┌─────────────────────────┐
            │ Where:                  │
            └─────────────────────────┘
```

For the second Text block ("Venue value"), they want each card to show
its tour-date's venue:

```
Inspector → Text block
─────────────────────────────────────
Content:    [○ Literal]  [● From field]

            ┌─────────────────────────┐
            │ ▼ venue   (text)        │
            └─────────────────────────┘
              Choices: title, venue,
              city, ticketUrl
              (only text-typed fields
              of this collection)
```

The stored template snippet for the two blocks:

```json
[
  { "type": "Text", "props": { "content": { "kind": "literal", "value": "Where:" } } },
  { "type": "Text", "props": { "content": { "kind": "binding", "fieldId": "fld_venue" } } }
]
```

When the renderer encounters a `kind: "binding"` prop, it looks up
`item.values[fieldId]` and uses that value. A binding to an empty /
missing field renders nothing (implicit hide-if-empty; explicit
conditional blocks can come later).

The field-picker dropdown is type-filtered: a Text block's `Bindable<string>`
prop offers only `text` / `longText` / `select` / `url` / `email` fields.
An Image block's `Bindable<ImageMetadata>` prop offers only `image`
fields. Type-incompatible bindings can't be authored.

**Bindings exist only in templates.** When the artist edits a *specific
item's* puckContent field (e.g. authoring the body of a particular page),
every block's prop is just a literal — there's no "field" to bind to,
because the artist is producing this item's data, not a template to be
filled in by many items.

#### 4.2 Rendering rich and composite fields

`Bindable<T>` works for scalar props (a string, an ImageMetadata, a
URL). It doesn't fit for richText and puckContent fields — those
values expand into a tree of their own, not a single scalar to drop
into a prop. Those fields are rendered via dedicated blocks:

- `RichTextRender { field: FieldId }` — renders a richText field's
  Tiptap content at this position.
- `PuckContentRender { field: FieldId }` — renders a puckContent
  field's Puck JSON at this position.

These are bindings too, just packaged as their own block types
because the thing they render is a tree, not a value.

The Pages collection's detailTemplate, at its simplest, is a single
`PuckContentRender { field: "fld_body" }` block. The artist can add
header / footer Primitives around it.

#### 4.3 Cycle safety by structural rule

Without a rule, cycles are easy to construct: a tour-date itemTemplate
that embedded a TourDatesView would render tour-date items via the
same itemTemplate, which contains the view, which renders items, and
so on.

One rule prevents this:

> **itemTemplate cannot contain Collection blocks. detailTemplate,
> listTemplate, and any rendered puckContent field can.**

Why it terminates:

- A Collection block renders its source items via the source
  collection's itemTemplate. itemTemplates contain no Collection
  blocks, so recursion stops after one level.
- A puckContent field's contents are rendered via `PuckContentRender`,
  which is only legal inside detailTemplate / listTemplate. Collection
  blocks inside that puckContent render their items via itemTemplates,
  which again contain no Collection blocks. Terminates.
- An itemTemplate may bind a puckContent field via `PuckContentRender`
  (the types don't forbid it). Collection blocks inside that bound
  value are stripped at render time — the runtime backstop for the
  pathological case.
- Cross-collection `collectionRef` chains that form a runtime cycle
  (release A → release B → release A) are detected at render and shown
  as a placeholder.

Collections are **fully universal**: any collection can have items with
puckContent fields edited in a full Puck workspace, any item can have a
rich detail-page layout that embeds other collections' items, and
per-item bodies behave the same on pages and on releases or shows or
anywhere else.

#### 4.4 Template editor surfaces

Both template editors are Puck `<Puck>` instances with template-specific
configs. They live at:

- `/admin/collections/<slug>/template/item` — itemTemplate. Config
  registers Primitive blocks only.
- `/admin/collections/<slug>/template/detail` — detailTemplate. Config
  registers Primitive blocks + one Collection block per existing
  collection (dynamic, see §5).

Editing either re-renders a preview against a representative item (the
first item in the collection, or a placeholder item if the collection is
empty). The block inspector adds the literal/binding toggle described in
§4.1 to every bindable prop.

### 5. Collection blocks

A **Collection block** embeds an entire collection on a page or detail
template. One Collection block is registered per existing collection
(`PagesView`, `TourDatesView`, `ReleasesView`, …); the page-body Puck
editor and the detail-template Puck editor both include the full set in
addition to Primitive blocks.

```ts
TourDatesView: {
  fields: {
    sourceCollection: { type: "internal", value: "tour-dates" },   // not editable
    filter: { type: "custom", render: FilterField },               // see §5.1 below
    sort:   { type: "select", options: [ … fields × {asc, desc} … ] },
    limit:  { type: "number" },
    hideFields: { type: "array", arrayFields: { fieldId: { type: "select", options: [ … field list … ] } } },
    styleOverrides: { type: "custom", render: StyleOverrideField },  // light knobs only
  },
  defaultProps: { … },
  render: (props, ctx) => <RenderCollectionView {...props} currentItem={ctx.currentItem} />,
}
```

`<RenderCollectionView>` loads items from the source collection, applies
filter / sort / limit / hideFields, and renders each item through the
source collection's **itemTemplate**. The artist gets a "Manage tour
dates →" button in the Collection block's inspector that navigates to
`/admin/collections/tour-dates`.

Collection blocks are registered dynamically: at editor mount, the admin
reads the list of collections from disk and injects one Collection block
per collection into the relevant Puck configs. Adding a new collection
automatically makes it embeddable everywhere Collection blocks are
permitted.

#### 5.1 Filter shape and current-item context

The filter is the main authoring surface for selecting which items to
render. Its on-disk shape is a small expression tree:

```ts
type FilterValue =
  | { kind: "literal"; value: unknown }
  | { kind: "currentItemId" }                          // resolves to currentItem.id
  | { kind: "currentItemField"; fieldId: FieldId };    // resolves to currentItem.values[fieldId]

type FilterClause =
  | { field: FieldId; op: "equals" | "notEquals"; value: FilterValue }
  | { field: FieldId; op: "in" | "notIn"; values: FilterValue[] }
  | { field: FieldId; op: "isEmpty" | "isNotEmpty" }
  | { field: FieldId; op: "gt" | "gte" | "lt" | "lte"; value: FilterValue }   // numbers + dates
  | { field: FieldId; op: "contains"; value: FilterValue }                    // text + longText
  | { excludeCurrentItem: true };                                             // shorthand for "not me"

type Filter =
  | { all: FilterClause[] }   // AND
  | { any: FilterClause[] };  // OR
```

The three-arm `FilterValue` discriminator (rather than a single
`currentItem` variant with a sentinel `field: "_id"`) avoids a
collision class: a real `FieldId` could be `_id`, since the FieldId
pattern is "any non-empty string." Splitting `currentItemId` from
`currentItemField` makes the semantics explicit and migration-safe.

The renderer threads a **current-item context** through every
template — when rendering a detail page, `currentItem` is the item
being shown; when rendering a Page, `currentItem` is that Page (Pages
are items in the unified model, so the context is always defined for
any template).

This unlocks the patterns the platform needs:

```ts
// Tracks on the album detail page (intrinsic child→parent relationship)
filter: { all: [{
  field: "fld_belongsToAlbum", op: "equals",
  value: { kind: "currentItemId" },
}]}

// "More releases by me" on a release detail page
filter: { all: [{ excludeCurrentItem: true }] }

// "More shows on this tour"
filter: { all: [{
  field: "fld_tourLeg", op: "equals",
  value: { kind: "currentItemField", fieldId: "fld_tourLeg" },
}]}

// "Upcoming shows" (no current-item dependency)
filter: { all: [{
  field: "fld_status", op: "in",
  values: [{ kind: "literal", value: "on_sale" }],
}]}
```

The editor UI for the filter (PR 5/6) renders a clause builder that
hides `currentItem` complexity behind plain-English wording ("matches
the current item's tour leg"). The on-disk shape is the source of
truth.

### 6. Field-type palette (v1)

| Type                 | Storage                                      | Notes                                         |
| -------------------- | -------------------------------------------- | --------------------------------------------- |
| `text`               | `string`                                     | optional `maxLength`                          |
| `longText`           | `string`                                     | multi-line plain text                         |
| `richText`           | Tiptap JSON                                  | inline formatting only — no block layout      |
| `number`             | `number`                                     | optional `min` / `max` / `step`               |
| `boolean`            | `boolean`                                    |                                               |
| `select`             | `string`                                     | options on the field def                      |
| `multiSelect`        | `string[]`                                   | options + optional `minItems` / `maxItems`    |
| `date`               | ISO 8601 `string`                            | optional `includeTime`                        |
| `url`                | `string`                                     | validated as URL                              |
| `email`              | `string`                                     | validated as email                            |
| `color`              | `#rrggbb` `string`                           |                                               |
| `image`              | `ImageMetadata` (uses existing pipeline)     |                                               |
| `file`               | `{ src, mimeType, originalName, sizeBytes }` | `mimeFilter` covers audio / PDF / etc.        |
| `collectionRef`      | `{ itemId }`                                 | one ref; target collection comes from FieldDef |
| `multiCollectionRef` | `ItemId[]`                                   | ordered array; target collection from FieldDef |
| `puckContent`        | Puck `Data`                                  | full block layout                             |

`richText` is distinct from `puckContent`: richText is inline prose
formatting *within one field* (bold, italic, links, lists), puckContent is
block-level layout composition. A puckContent surface internally uses
richText for its Text blocks. Composition, not duplication.

**`collectionRef` vs `multiCollectionRef` vs filtered Collection block.**
Three ways to express "one thing relates to others." Use:

- **`collectionRef`** for a single curated link (`page.featuredRelease`).
- **`multiCollectionRef`** for an ordered, per-parent-curated list
  (`page.featuredReleases`, `page.gallery`, `tourDate.supportActs`).
  The ordering lives on the parent.
- **Filtered Collection block** (§5) for an intrinsic child→parent
  relationship (`release.tracks` where each `track.belongsToAlbum`
  points to the release). The relationship lives on the child, and the
  parent's detailTemplate embeds a Collection block filtered by
  `belongsToAlbum = currentItem.id`. Use this when the child knows
  where it belongs by its nature; the artist edits from the child side.

### 7. Storage layout

```
src/content/collections/<collection-slug>/
  _collection.json          # CollectionDef (schema, item + detail + list templates, routing, sort)
  items/
    _order.json             # OPTIONAL — present only when defaultSort.mode === "manual"
    <item-slug>.json        # one Item per file
```

Both the collection definition AND the items are committed to git.
Artists own everything end-to-end; the prebaked collections ship as
default `_collection.json` files the artist can freely modify.

Singletons store their single item at `items/_singleton.json`.

**`_order.json`** is the sole place ordering lives when the artist
chooses manual ordering. Its shape:

```json
["paris-2026-07-15", "berlin-2026-07-20", "london-2026-07-25"]
```

A list of item slugs. Items not present (e.g. a freshly-created item not
yet positioned) sort to the end. Drag-to-reorder in the admin rewrites
this file and triggers one publish commit. Renaming an item slug rewrites
both the item file and the order entry in a single commit. Deleting an
item removes its entry from `_order.json` in the same commit.

When `defaultSort.mode === "fieldSort"` or `defaultSort` is `null`,
`_order.json` is absent and items sort by the configured field (or by
filesystem order when null).

The existing pages directory (`src/content/pages/`) moves to
`src/content/collections/pages/items/` as part of the foundation PR
(§13). Existing singletons (`src/content/config/*.json`) move to
`src/content/collections/{site,header,appearance}/items/_singleton.json`.

### 8. Routing

A collection's `detailUrlPrefix` determines whether and where its items
get public detail pages:

- `detailUrlPrefix: "/"` — each item gets `/<itemSlug>`. The Pages
  collection uses this.
- `detailUrlPrefix: "/shows"` — each item gets `/shows/<itemSlug>`.
- `detailUrlPrefix: null` — no detail pages. The collection can still be
  embedded in a Collection block; items just have no individual URL.
  Useful for "Quotes", "FAQ entries", or any collection whose items
  exist only to populate other pages.

Whether a collection's *list page* (`/shows` as a list of all tour dates)
exists is independent:

- If `listTemplate` is set, the system auto-generates the list page at
  `detailUrlPrefix` (e.g. `/shows`).
- If `listTemplate` is null, no auto-list page is generated. To have a
  `/shows` page, the artist creates a Page (`/admin/collections/pages/items/new`,
  slug `shows`) and places a `TourDatesView` Collection block on it.
  This is the path we expect to be most common.

Next.js dynamic routes are generated at build time from the collection
registry. A single `[...slug]` catch-all at the public root dispatches
by reading the registry, matching the longest `detailUrlPrefix` first
(so `/shows` wins over `/`), then resolving the rest as the item slug.
Build-time conflict detection catches both:

- Two collections claiming the same `detailUrlPrefix` (e.g. two
  collections both at `/`).
- A Page slug colliding with another collection's prefix root (e.g.
  the artist creates a Page with slug `shows` while a tour-dates
  collection already has `detailUrlPrefix: "/shows"`).

Both cases fail the build with a structured error pointing at the
conflict — these can corrupt the public site if allowed at runtime.

### 9. Editor surfaces

```
/admin
  /collections                            Index: list of all collections
  /collections/<slug>                     List view (or item editor if singleton)
  /collections/<slug>/items/new           New item form
  /collections/<slug>/items/<itemSlug>    Item editor
  /collections/<slug>/schema              Schema editor (fields)
  /collections/<slug>/template/item       Item template editor (Puck, Primitive blocks only)
  /collections/<slug>/template/detail     Detail template editor (Puck, Primitive + Collection blocks)
  /pages                                  Pages list — view alias over /collections/pages
  /pages/<slug>                           Page editor — view alias over /collections/pages/items/<slug>
  /settings                               Settings — view alias over /collections/site/items/_singleton
  /navigation                             Header & Nav — view alias over /collections/header
  /appearance                             Appearance — view alias over /collections/appearance
```

The **generic item editor** inspects the collection's field list and
renders the appropriate input per field via the existing admin form
primitives (TextField, SelectField, NumberField, etc.) plus new primitives
for the v1 types (DateField, ColorField, FileField, RichTextField,
CollectionRefField). If any field is `puckContent`, that field renders as
a full Puck workspace (the canvas); other fields move into the right-hand
inspector alongside Puck's per-block inspector. Pages get the same
workspace they have today, automatically, because they're a collection
with a `puckContent` body — and the same applies to any other collection
the artist gives a `puckContent` field (e.g. a Release with a free-form
notes body, a Tour-date with show notes).

The **schema editor** lists fields with add / remove / rename / reorder /
edit-type. It enforces guardrails (§11) for destructive changes.

The **template editors** are two Puck instances per collection, sharing
the Primitive block library. The item-template editor's config excludes
Collection blocks (per §4); the detail-template editor's config includes
them.
Both edit fields on `_collection.json`.

### 10. Type-safety stance

The system is **statically typed at the framework level, runtime-typed at
the data level**:

- `FieldDef`, `FieldValue`, `CollectionDef`, `Item` are discriminated
  unions. Every renderer that walks them gets exhaustiveness from
  TypeScript.
- `Item.values` is `Record<FieldId, FieldValue>` at compile time —
  TypeScript can't know which fields a given collection has, because the
  schema is editable at runtime by the artist. This is the same trade
  Notion, Airtable, Sanity, and similar dynamic-schema systems make.
- **Runtime validation is strong.** When an item is read or written, a
  Zod schema is built dynamically from the collection's `fields` via
  `buildItemFileSchema(fields: FieldDef[]): ZodSchema`, and the item is
  parsed against it. Invalid items cannot be saved. Bulk readers
  (`listItemsInOrder`) build the schema once per call and reuse it
  across every read — repeating the construction per item would waste
  work proportional to the number of fields on every item.
- **Runtime-narrowing accessors give ergonomic consumer code**:
  ```ts
  const venue = getText(item, "fld_venue");
  // venue: string  — throws if the field doesn't exist or isn't text
  ```
  This is how hand-coded blocks consume specific fields.
- **Codegen is on the table but deferred.** Because both prebaked
  and artist-edited schemas live in git, a build-time step could walk
  every `_collection.json` and emit `.d.ts` files so each collection
  gets a static row type. The generic template renderer doesn't need
  it (runtime accessors are enough); if we end up writing many bespoke
  blocks that consume specific fields, codegen earns its keep.

### 11. Schema-change guardrails

The schema editor enforces:

- **Stable field IDs.** Renaming a field changes only its `key`. The `id`
  is permanent. Item values reference fields by `id`, so renames are
  zero-migration.
- **`systemLocked` fields** can't be deleted, renamed, or retyped from
  the schema editor. Pages.title and Pages.body are the canonical
  examples — the renderer and routing depend on them. Code-driven
  template migrations can still rewrite these by editing the JSON
  directly.
- **Add field**: allowed freely. Existing items get `undefined` for the
  new field; required-field validation kicks in only for new items until
  the artist backfills.
- **Remove field**: warns "N items have data in this field; removal will
  delete it." Requires an explicit confirm. (See "Counting affected
  items" in §"Known limitations" for the performance footnote.)
- **Change required**: from optional → required is allowed only if all
  existing items have a value; otherwise the schema editor surfaces a
  "Fix N items first" link to a bulk-edit view.
- **Change type**: lossless transitions are allowed with an inline
  preview of the migration:
  - `text` ↔ `longText` (string ↔ string)
  - `text` → `url` / `email` / `color` (only if every existing value
    parses against the new validator; otherwise blocked)
  - `select` → `multiSelect` (wrap each string in a 1-element array)
  - `multiSelect` → `select` (only if every item has at most one option
    selected; otherwise blocked)
  - adding new options to `select` / `multiSelect` (purely additive)

  When a transition is allowed, the schema-change route eagerly
  rewrites the affected items' on-disk values so the value's `type`
  discriminator matches the new `FieldDef.type`. Without that rewrite,
  the per-collection dynamic Zod schema rejects the next read of each
  item. The route publishes the rewritten items in the same commit as
  the new `_collection.json`.

  Lossy transitions (e.g. `puckContent` → `text`, removing select
  options that are in use) remain blocked. Future versions may add
  more lossless coercions or a "convert with confirmation" path for
  intentional data loss.
- **Whole-item validation against the new schema**: as a final pass,
  every existing item is parsed against
  `buildItemFileSchema(newDef.fields)` (after the hypothetical
  migration above). Any item that fails is reported as a blocking
  issue carrying the item slug, the Zod path, and Zod's message. This
  is the catch-all for every flavour of "constraint tightening that
  current data violates" — removing a select option in use,
  tightening `text.maxLength`, tightening `number.min` / `max`,
  toggling `date.includeTime`, raising `multiSelect.minItems`, adding
  a brand-new required field while items exist, etc. The structural
  rules above can't enumerate every constraint the per-field Zod
  enforces; delegating the check to the same code that will reject
  reads after the save closes the gap.
- **Reorder fields**: free; affects display order in the item editor and
  in the default item template only.

### 12. Publish flow

The existing `publish.ts` is extended with new target kinds — collection
item upsert, collection item delete, collection definition upsert — all
routed through the same broker → GitHub → commit path with dev-disk
fallback. The Puck `onPublish` flow that today writes page JSON is
generalised to write any item.

Collection definitions and items publish independently: editing a tour
date doesn't republish the collection's schema, and editing the schema
doesn't republish items. Each is a separate commit on save.

### 13. Migration plan

The musician-site template is pre-1.0 and ships only a seed site, so a
clean cutover beats a feature flag.

**PR 3** (see §15) performs the migration in one shot:

1. Generate `_collection.json` for each of the four existing surfaces
   (`pages`, `site`, `header`, `appearance`) from the matching Zod
   schemas in `src/lib/site-config-types.ts`. Each gets
   `schemaVersion: 1`, the right `isSingleton` flag, and a
   `slugSourceFieldId` for `pages`.
2. Move `src/content/pages/*.json` →
   `src/content/collections/pages/items/<slug>.json`. Wrap each existing
   file's `{ root, content }` Puck data into a `puckContent` field on
   the new item shape, generate an `id` (`item_<uuid>`), set
   `createdAt` / `updatedAt` to the migration time, then write.
3. Move `src/content/config/{site,header,appearance}.json` →
   `src/content/collections/{site,header,appearance}/items/_singleton.json`
   with the same wrapping (each existing field becomes a value under the
   collection's matching field id), generated `id`, and timestamps.
4. The old `lib/content.ts` page/singleton readers become thin
   wrappers over the collection store, and are removed once every
   caller has switched over.
5. The existing `/admin/pages`, `/admin/settings`, `/admin/navigation`,
   `/admin/appearance` routes survive as aliases over the generic
   editor — no admin-UI regression.

External-facing API routes (`/api/publish`, `/api/pages`,
`/api/save-config`) keep their paths for back-compat in the same PR.

### 14. Goal 2 (navigation menu into Pages) folded in

Goal 2 — "remove the Navigation menu control and fold reordering +
visibility into the Pages list" — is part of this design. The Pages
collection ships with `defaultSort: { mode: "manual" }` (order in
`items/_order.json`) and a `showInNav: boolean` field. The Pages list
in the admin supports drag-to-reorder (rewrites `_order.json`) and an
eye-icon toggle (flips each page's `showInNav`). The header reads the
ordered Pages list and filters by `showInNav` to build the nav menu.
`/admin/navigation` shrinks to header-style controls (wordmark, mode,
layout) and may fold into `/admin/settings` once the nav-menu UI lives
entirely in `/admin/pages`.

### 15. Shipping plan

Eight PRs, each independently reviewable and (where possible) mergeable:

1. **Foundation: types, storage, publish.** `CollectionDef`, `FieldDef`,
   `Item`, `FieldValue` types in a new package (or in
   `src/lib/collections/`). Zod builder. Item store (read / write / list /
   delete). Publish target kinds. No UI.
2. **Item template renderer + data binding primitives.** Primitive block
   library. Binding resolution. Renderer that takes a template + item and
   produces React. Unit-tested without the editor.
3. **Pages migration.** Move pages and singletons to the collection
   storage layout. Existing routes still work via aliases.
4. **Generic item editor.** Field-type-aware item editor. Pages start
   using it. (Pages-specific Puck editor stays inside it as the
   puckContent surface.)
5. **Schema editor UI.** Add / remove / rename / reorder / type changes
   with guardrails. Existing pages collection becomes editable.
6. **Template Puck editors.** Per-collection layout designers for both
   `itemTemplate` (Primitive blocks only) and `detailTemplate` (Primitive +
   Collection blocks). Shared editor shell with config differing only in
   which blocks are registered.
7. **First non-pages collection: tour dates.** Validates the full stack.
   Includes the `TourDatesView` block on pages, with the "Manage" button
   for navigation.
8. **Prebaked collections: releases, posts, store items, photos, videos.**
   Each adds a `_collection.json` and seed items. Small PRs at this point.

PRs 1–2 are foundation with no UI; 3–7 each ship a usable slice; 8 is
breadth on the same foundation.

## Rejected alternatives

- **Keep Pages and singletons separate from collections.** Original
  approach in ADR-007 §3. Rejected because the three new requirements
  (editable schemas, Puck-edited item templates, per-item URLs) apply to
  every editable surface — building them twice (once for Pages, once for
  collections) is wasteful, and unifying later is harder than unifying
  now while the template is pre-1.0.
- **Static per-collection schemas in Zod, no artist editing.** What
  ADR-007 §3 prescribed. Simpler to implement and gives compile-time type
  safety on item shape. Rejected because the artist's freedom to evolve
  the schema is a stated requirement, and our customer base (musicians
  with idiosyncratic site needs) benefits more from flexibility than from
  framework-side IntelliSense on field names.
- **Collection items as Puck slot children of a parent block.** Tour dates
  rendered as a Puck `TourDatesList` block with a slot, each child a
  `TourDateItem` block. Editing is native Puck drag-and-drop. Rejected
  because it precludes cross-page data sharing (items live in one page's
  JSON), per-item URLs, and centralised editing — all stated requirements.
- **Codegen of static row types in v1.** Build-time generation of `.d.ts`
  files from each `_collection.json`, giving each collection a typed
  `Item<TourDates>`. Defensible, but deferred to keep the v1 build simple
  and because runtime-narrowing accessors cover the generic-renderer case
  that dominates this codebase. Revisit if a critical mass of bespoke
  blocks emerges that benefit from compile-time field-name checking.
- **Built-in conditional / expression blocks in the v1 item template.**
  Considered an `If` / `Switch` block with a small expression language for
  the template. Rejected for v1 in favour of implicit hide-if-empty
  rendering, which covers the common case (don't show the ticket button
  if there's no ticket URL) without an expression language.
- **External CMS engine (Sanity, Tina, Keystatic) as the data layer.**
  Sanity is hosted and proprietary (fails the file-based requirement).
  Tina and Keystatic have static schemas (fail the editable-schema
  requirement). Rolling our own keeps full control over the artist's
  authoring experience, which is the product differentiator.

## Known limitations and deferred work

The v1 design is deliberately scoped. Each entry below has a
**trigger** — the condition that should pull it forward — so we don't
end up debating "is now the right time" without a reference point.

### Schema and data shape

- **Nested-record fields (`array<{...}>`).** No way to model an
  in-document array of structured sub-objects (e.g. `release.tracks`
  as an array of `{title, duration}` rows). The v1 path for tracks
  is a separate `tracks` collection plus either a filtered Collection
  block on the album (intrinsic membership) or a `multiCollectionRef`
  (per-album curation).
  *Trigger:* a prebaked collection ships where the workaround
  (separate sub-collection) demonstrably degrades the artist
  experience for >2 documented use cases. Adding nested types
  recursively affects FieldDef/FieldValue/renderer/editor — sized as
  its own ADR-amending PR when triggered.

- **Schema-migration framework.** `schemaVersion: 1` is on every
  CollectionDef from day one (the cheap part). The runner that
  reads an older schemaVersion and rewrites it forward isn't built.
  *Trigger:* the first time we want to ship a `schemaVersion: 2`
  change. Until then, every `_collection.json` is v1 and the
  framework would just be ceremony.

- **System pseudo-fields in templates.** `createdAt` / `updatedAt`
  exist on every item but the binding layer (PR 2) needs to expose
  them as `_createdAt` / `_updatedAt` pseudo-fields so templates can
  show "Updated 3 days ago." Out of foundation scope; PR 2's
  binding resolver picks them up.

### Cross-collection consistency

- **Cross-collection ref integrity.** Deleting an item leaves dangling
  refs in other collections. v1's renderer treats missing refs as
  "not present" (the block doesn't render); the schema and item
  editors don't warn before delete. The deferred fix is a back-ref
  index built at write time so editors can show "X items reference
  this item."
  *Trigger:* first artist support case caused by a silently-broken
  ref. The index is cheap to maintain incrementally; pull forward if
  we expect ref usage to be heavy early.

- **Refs to a non-existent target collection.** A `collectionRef` /
  `multiCollectionRef` with `targetCollection: "tracks"` parses fine
  even if no tracks collection exists. The renderer would silently
  show nothing; the schema editor wouldn't warn.
  *Trigger:* PR 7 ships a real cross-collection ref. The fix is a
  build-time check that walks every CollectionDef and verifies every
  ref's target exists.

- **URL preservation on rename.** Renaming an item changes its slug
  and therefore its URL. External links break silently. v1 accepts
  this. The deferred fix is a `_redirects.json` per collection that
  records `oldSlug → newSlug` mappings and a redirect handler in the
  public catch-all.
  *Trigger:* the first artist who renames a tour-date or release with
  external links and asks where the redirect is.

### Editing surface

- **Slug-generation algorithm.** "Title → kebab-case-with-collision-
  suffix" is not standardised in the foundation. PR 4's "new item"
  flow will implement it (steal from the existing pages slug logic).
  *Trigger:* PR 4 lands.

- **Concurrent editing.** Single-editor assumption (ADR-007 §7).
  Two browser tabs, two band members, or one stale tab can silently
  clobber each other on save. v1 relies on the artist not opening
  two editors at once. The platform-level fix is per-item ETags
  (the file's `updatedAt` is the natural version stamp) + a CAS save
  endpoint.
  *Trigger:* the first incident where two collaborators report
  losing each other's edits. The `updatedAt` foundation makes the
  ETag check a thin layer when needed.

- **Drafts beyond single-editor `localStorage`.** Carry-over from
  ADR-007 §7. v1 keeps the localStorage drafts model; per-item drafts
  surviving across devices land later (probably as a
  `drafts/<item-slug>` branch in the artist repo).
  *Trigger:* multi-device editing becomes a stated requirement.

### Performance

- **Counting affected items for guardrails.** Schema-change guardrails
  in §11 ("N items have data in this field") require enumerating
  every item to count. v1 does the obvious `listItemsInOrder + filter`
  on each schema-editor mount.
  *Trigger:* any single collection grows past ~100 items in the
  wild, or schema-editor open latency becomes user-noticeable.

- **id → slug index for collectionRef resolution.** Rendering a
  collectionRef requires looking up the item by id; v1 does this
  via list+scan within the target collection. Acceptable while
  collections stay small.
  *Trigger:* any collection that's heavily referenced (e.g. a
  `tracks` collection referenced from every release's
  `multiCollectionRef`) exceeds ~100 items. The fix is a
  `_id-index.json` per collection, maintained on write.

- **Pagination / search on public list pages.** Not in v1. List pages
  render every matching item. For collections that grow large, the
  artist authors filtering manually with separate pages.
  *Trigger:* the first collection that ships >50 items per list
  page in production. The Collection block already filters / sorts /
  limits, so the addition is a `cursor` field and a "Load more"
  block primitive.

- **Image lifecycle for items.** Images attached to an item via the
  upload flow live under `public/images/<contentSlug>/<imageId>/`.
  PR 4 wires the upload flow to items by setting
  `contentSlug = "<collection-slug>/<item-slug>"`, which means
  deleting an item naturally implies a directory deletion the GC
  pass can target. v1 accepts the drift between item deletion and
  image deletion.
  *Trigger:* either a prune script lands as a maintenance one-off,
  or image storage starts costing money worth reducing.

### Routing and renderer

- **Filter UI breadth.** §5.1's filter shape supports the common
  cases. More exotic predicates (string-pattern match, date ranges
  spanning fields, joined filters across multiple collections) can
  be added without changing the on-disk shape — extend `FilterClause`.
  *Trigger:* an artist hits a missing predicate. Add the variant.

- **Schema-version forward compat at the deployment level.** A
  platform ship that adds a new field type can't be consumed by an
  artist's site that's on an older deployment of the runtime. v1
  fails the build loudly rather than silently dropping unknown
  types.
  *Trigger:* the first time a platform ship lands a new field type
  AND an artist's deployment has lagged. Likely solved by tying
  platform releases to artist-site rebuilds.

- **Block-schema evolution.** Puck block configs change between
  template releases — a `TourDatesView` block might gain or rename a
  prop. Existing items contain block instances with the old prop
  shape. Puck handles unknown props by ignoring them and missing
  props by falling back to `defaultProps`, so v1 inherits that
  behaviour without action. Becomes a problem if we ship a breaking
  prop change without a migration.
  *Trigger:* the first time we want to make a non-additive change
  to a block's prop schema. The fix is a per-block migration
  registered alongside the block config.

- **Date field validates shape but not validity.** `2026-02-31`
  passes the date-field regex but isn't a real date. Same for
  `2026-13-01`. v1 accepts these; downstream consumers that pass to
  `Date.parse` get `NaN`.
  *Trigger:* the first artist who types an invalid date and gets a
  silent rendering glitch. Trivial fix — tighten the date validator
  to also `Date.parse` and reject NaN.

- **i18n / localized content.** Not addressed. The model would
  accommodate it via a `locale` field on items + locale-aware
  routing, but neither is in v1.
  *Trigger:* internationalisation becomes a product requirement.
  Out of scope until then.

### Editor capabilities

- **Drag-corner resizing of Primitive blocks.** Deferred
  indefinitely — Puck's canvas doesn't natively support per-block
  resize, and the existing token-driven style knobs cover most needs.
  *Trigger:* would require a meaningful product case to justify the
  rebuild.

### Schema editor follow-ups

The schema editor (PR 5) ships with the core validation and migration
guarantees in place. The following refinements were considered during
review and explicitly deferred. Each one is real, but none changes the
data-integrity contract — they're polish, performance, and product
calls layered on top of an already-correct foundation.

- **Atomic write for schema saves.** The route writes
  `_collection.json` then loops `writeItem(...)` for each migrated
  item. A mid-loop throw (disk full, FS race, unforeseen validator
  regression) leaves a half-migrated collection on disk. The publish
  call is skipped in that case, so the broker copy stays consistent,
  but the local disk is in a mixed state. Proper fix is a stage +
  atomic-rename pattern (or a transactional GitHub commit before any
  local write).
  *Trigger:* first incident where a save fails mid-loop in the wild,
  OR the first collection large enough that the failure window
  matters (>50 migrated items per save).

- **`field-removed-with-data` warning timing language.** The warning
  currently says "removing it deletes those values." In practice
  values are dropped on next *write* of each item (Zod strips
  unknown keys), not the moment the field is removed. Worth
  rewording when the editor surfaces N-affected counts in the UI.
  *Trigger:* a product pass on schema-editor copy.

- **Differentiated `item-invalid-under-new-schema` issue kinds.** One
  kind currently covers "missing required field," "value violates
  tightened constraint," "option no longer in allowed set," etc.
  Each merits a tailored message and possibly its own remediation
  link ("Fill in the new field on N items" vs "Edit the items that
  reference this removed option").
  *Trigger:* the first time an artist support case turns on
  unclear copy from this generic kind.

- **No-op fast path for item reads on save.** `validateSchemaChange`
  calls `listItemsInOrder` unconditionally. A pure-rename or
  `singularName` tweak doesn't touch items; the read is wasted. Add
  a fast-path that computes the diff first and skips the items read
  when no field-removed / type-changed / option-removed /
  required-changed / new-required-added is present.
  *Trigger:* any collection grows past ~100 items, or schema-editor
  save latency becomes user-noticeable. Same trigger as the
  "Counting affected items" entry above.

- **`TypeSelector` filtering to compatible types.** The SchemaEditor's
  type dropdown shows every FieldType for unlocked fields. Picking
  an incompatible type (e.g. `text → image`) is silently accepted
  client-side, then 409s server-side. Filtering to
  `canTransition(field.type, *)` matches what will save and saves a
  round-trip.
  *Trigger:* a UI/UX pass on the schema editor.

- **`collectionRef.targetCollection` dropdown.** Currently a freeform
  `<TextField>`. Typos save with a slug-shaped value that doesn't
  resolve at render time. Replace with a `<SelectField>` populated
  server-side from `listCollectionSlugs()`.
  *Trigger:* a UI/UX pass, or the first artist support case caused
  by a typo'd target.

- **`changeFieldType` preserving field-specific config.** Switching
  from `select` to anything that isn't `select` / `multiSelect`
  drops the field's `options`. Switching back gives a single
  "Default" option. Same shape for `text.maxLength`,
  `number.{min,max,step}`, `multiCollectionRef.targetCollection`.
  A cleaner design stashes the previous-shape config in a non-
  persisted scratch field on the FieldDef, restored if the artist
  switches back to a compatible type within the same editing
  session.
  *Trigger:* the first artist support case caused by losing options
  while exploring type choices.

- **Replace native `confirm()` dialogs.** SchemaEditor uses
  `window.confirm(...)` for destructive operations (remove field,
  remove option in use). Native confirms can't be styled, break
  test automation, and look cheap relative to the rest of the
  admin UI.
  *Trigger:* a UI/UX pass.

- **Behavioral tests for the SchemaEditor component.** Today's tests
  assert that markup contains certain strings. None exercise the
  onChange callbacks, the remove-field flow, type changes, or the
  OptionsEditor add/remove. The component would have to break in a
  markup-level way for tests to catch it.
  *Trigger:* the first regression in SchemaEditor that gets to
  production. The structural tests have non-zero value; this is
  defense in depth.

- **Optimistic concurrency on `_collection.json` saves.** The schema
  route does read → validate → write. Two simultaneous requests
  from two tabs can both pass validation against the same `oldDef`
  and the later one overwrites the former. Real fix is a revision
  stamp on the def file + an `If-Match`-shaped header on the PUT.
  Same shape as the "Concurrent editing" entry above, scoped to
  schemas specifically.
  *Trigger:* same — the first incident.

- **Surface migrated-item count in the schema editor UI.** The route
  returns `migratedItemCount` in the success response; the editor
  doesn't render it. An artist saving a type transition has no
  signal that N item files were just rewritten on disk.
  *Trigger:* a UI/UX pass.

### What we built now to avoid pain later

Three additions cost almost nothing today but would be expensive to
add after artist data exists:

- **`schemaVersion` on every CollectionDef.** Future migrations key
  off this. Without it, migrations have to guess "what version is
  this?" from missing fields.
- **`createdAt` / `updatedAt` on every Item.** Real times can't be
  recovered from git history for items committed before the change.
- **`currentItemId` vs `currentItemField` filter discriminator** (not
  a sentinel string). A real `FieldId` could be `_id`, so the sentinel
  approach would have eventually collided. Fixing the on-disk shape
  later means migrating every artist's collection files.

Two we deferred with eyes open — first add would be cheap, but the
trigger condition isn't here yet:

- **Back-ref index for ref integrity.** Trigger: the first support
  case caused by a silently broken ref.
- **id-index for ref resolution.** Trigger: any heavily-referenced
  collection passing roughly 100 items. The fix is straightforward;
  doing it before there's data to backfill is the easy path.

## Consequences

- **ADR-007 §3 is superseded.** Collections no longer use static Zod
  schemas in `src/lib/schemas.ts`; the schema is dynamic, per
  `_collection.json`, validated at runtime via a Zod schema built from
  `FieldDef[]`. The existing Zod schemas in `site-config-types.ts` move
  into collection definitions during the foundation PR and are then
  removed.
- **Most of the existing admin code becomes thin aliases.** The
  `useSettingsForm` hook, the bespoke `SiteSettingsForm` /
  `NavigationForm` / `AppearanceForm` components, and the
  `/admin/pages/PagesPanel` evolve into generated equivalents that the
  generic item editor renders. The existing files become routing aliases
  with minimal logic. Net code reduction over time despite the new
  abstraction layer.
- **Two Puck configs, both generated from the collection registry.**
  The page-body config registers Primitive + Collection blocks (one
  Collection block per existing collection). The item-template config
  registers Primitive blocks with binding controls. Neither is
  hand-maintained — both come from walking the registry at editor
  mount.
- **The publish layer trades page-specific targets for
  collection-item targets.** PR 3 also keeps the old `/api/publish` /
  `/api/pages` / `/api/save-config` endpoint paths so external
  callers don't break.
- **Build-time route generation reads the collection registry.**
  Next.js's static export walks the registry to generate dynamic
  routes. A misconfigured collection (two collections both at
  `detailUrlPrefix: "/"`; a Page slug colliding with another
  collection's prefix root) fails the build, not runtime.
- **No SSR for the public site (carry-over from ADR-007).** Item template
  rendering happens at build time. A collection with frequently-changing
  items requires a rebuild on each change; current artist scale makes
  this acceptable. Revisit if a collection emerges whose items change
  faster than a rebuild cycle (~minutes).
- **Schema editing can damage data.** Guardrails (§11) reduce the
  risk — confirmations on field removal, blocked lossy type changes —
  but don't remove it. The git history of `_collection.json` is the
  undo log; we may add a friendlier one on top later.
- **The legacy template is unaffected.** This ADR applies only to
  `templates/musician-site/`. The legacy Astro + Keystatic template at
  `templates/musician-site-legacy/` keeps its static Zod schemas and
  Keystatic-driven editor.
- **Codegen remains a future option.** Layer-3 type safety (compile-time
  row types) can be added later without breaking the runtime model. The
  runtime accessors and the codegen output would be drop-in replacements
  for each other in consumer code.

## Supersedes

- **ADR-007 §3** ("Schema split: Puck-native blocks, Zod for collections")
  in full. ADR-007 §1, §2, §4-§8 remain in force.
