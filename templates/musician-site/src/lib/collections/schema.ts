/**
 * Schema for the unified Collection abstraction (ADR-009).
 *
 * Zod schemas are the **single source of truth** for the entire type
 * model; TypeScript types are inferred from them via `z.infer`. Adding
 * a new field type is a one-place change.
 *
 * Layout:
 *
 *   1. Identifiers, constants, and the slug schema.
 *   2. FieldDef discriminated union (one variant per v1 field type) +
 *      inferred `FieldDef` / `FieldType`.
 *   3. FieldValue discriminated union (one variant per FieldDef variant)
 *      + inferred `FieldValue` + supporting value types (`FileRef`,
 *      `CollectionRefValue`, `TiptapJSON`).
 *   4. CollectionDef shape + inferred `CollectionDef`, with cross-field
 *      invariants enforced via `superRefine`.
 *   5. Item / ItemFile shapes + dynamic per-collection schema builders.
 *   6. `Bindable<T>` — a generic that doesn't fit Zod's model and stays
 *      as a plain TS declaration. Schema for it lands in PR 2 with the
 *      template renderer.
 *
 * Item-shape validation is built per-collection from `FieldDef[]` via
 * `buildItemFileSchema(fields)`. Required fields must be present;
 * optional fields may be absent; values for fields the artist deleted
 * are silently stripped on read.
 */

import type { Data as PuckData } from "@puckeditor/core";
import { z, type ZodTypeAny } from "zod";

import { imageMetadataSchema } from "../image-types";

// ---------------------------------------------------------------------------
// 1. Identifiers, constants, slug schema
// ---------------------------------------------------------------------------

/**
 * Stable internal id for a field. UUID-ish; never visible to the artist.
 * Item values reference fields by id, so renaming a field's `key` is a
 * zero-migration change.
 */
export type FieldId = string;

/** Artist-facing name of a field (e.g. "venue"). Renameable. */
export type FieldKey = string;

/**
 * Stable internal id for an item, persisted inside the item file. The
 * item's URL slug is the filename and may change; the id never does.
 */
export type ItemId = string;

/**
 * ID generation helpers (`generateFieldId` / `generateItemId`) moved to
 * `./id-gen.ts`. They import `node:crypto`, which would otherwise pull a
 * node-only dependency into this module; keeping them out is what makes
 * this file node-free and therefore client-importable (admin forms run
 * the same Zod schemas the server uses). Server callers reach the
 * generators via the barrel `@/lib/collections`; sibling submodules
 * import `./id-gen` directly.
 */

/**
 * Slug pattern shared by collection slugs and item slugs. Matches the
 * existing `PAGE_SLUG_PATTERN` in `site-config-types.ts` so URLs and
 * filenames stay consistent across the template.
 *
 * Reserved item filenames (`_singleton`, `_order`) intentionally fail
 * this pattern (leading underscore) so a regular item can never collide
 * with them.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Reserved filename (sans `.json`) for the single item of a singleton collection. */
export const SINGLETON_ITEM_SLUG = "_singleton";

/** Reserved filename (sans `.json`) for the manual-order list inside `items/`. */
export const ORDER_FILE_NAME = "_order";

/** Reserved names that can never appear as user-authored item slugs. */
export const RESERVED_ITEM_SLUGS: readonly string[] = [
  SINGLETON_ITEM_SLUG,
  ORDER_FILE_NAME,
];

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    SLUG_PATTERN,
    "Slug must be lowercase letters, digits, and hyphens (start with a letter or digit)",
  );

/**
 * Derive a collection slug from a free-text plural name: lowercase,
 * collapse every run of non-`[a-z0-9]` characters to a single hyphen,
 * then trim leading/trailing hyphens. The result is not guaranteed to
 * satisfy `slugSchema` (e.g. an all-punctuation input yields `""`), so
 * callers validate the output with `slugSchema` before using it.
 *
 * Shared by the create-collection API route (server) and the
 * NewCollectionForm (client) so the slug the artist previews matches
 * the slug the server derives — exactly one implementation. Lives here
 * because schema.ts is node-free and therefore client-importable.
 */
export function slugifyToCollectionSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Accepts either a regular slug or the reserved `_singleton` for
 * singleton collections. The store layer chooses which to use based on
 * `CollectionDef.isSingleton`.
 */
export const itemSlugSchema = z.union([slugSchema, z.literal(SINGLETON_ITEM_SLUG)]);

/**
 * Human-facing collection name (the singular or plural label an artist
 * types when creating a collection). Bounded and single-line:
 *
 *   - `.trim()` first so surrounding whitespace doesn't count toward the
 *     length bounds or smuggle in a trailing newline.
 *   - `.max(80)` keeps it to a sensible label length.
 *   - The no-line-break rule matters because the create-collection route
 *     interpolates the name into a git commit subject; a newline would
 *     let the caller inject extra commit-message lines.
 *
 * Shared by the create-collection API route (server, authoritative) and
 * the NewCollectionForm (client, for an inline error before submit) so
 * there's one implementation and no drift. Lives here because schema.ts
 * is node-free and therefore client-importable.
 */
export const collectionNameSchema = z
  .string()
  .trim()
  .min(1, "Name can't be blank")
  .max(80, "Keep the name to 80 characters or fewer")
  .regex(/^[^\r\n]+$/, "Name can't contain line breaks");

/**
 * Request body for `POST /api/collections`. The route re-derives and
 * re-validates the slug from `pluralName` and owns the collision /
 * reserved-name checks; this schema just pins the wire shape.
 */
export const createCollectionRequestSchema = z.object({
  pluralName: collectionNameSchema,
  singularName: collectionNameSchema,
  isSingleton: z.boolean().optional(),
});

export type CreateCollectionRequest = z.infer<typeof createCollectionRequestSchema>;

// ---------------------------------------------------------------------------
// 2. FieldDef
// ---------------------------------------------------------------------------

const fieldIdSchema = z.string().min(1);
const fieldKeySchema = z.string().min(1).max(64);

/**
 * Properties common to every field variant. Spread into each
 * `z.discriminatedUnion` arm so the discriminant (`type`) and per-type
 * extras stay flat (Zod requires the discriminant directly on the
 * object).
 *
 * `systemLocked` flags fields that ship with a prebaked collection and
 * must not be deleted, renamed, or retyped by the artist — e.g.
 * `Pages.title` and `Pages.body`, which the renderer and routing
 * depend on. The flag is metadata only; enforcement lives in the
 * schema editor (PR 5). Code-driven migrations (template updates) can
 * still rewrite a systemLocked field by editing the JSON directly.
 */
const baseFieldShape = {
  id: fieldIdSchema,
  key: fieldKeySchema,
  systemLocked: z.boolean().optional(),
};

const selectOptionSchema = z.object({
  /** Stable internal id; survives label renames. */
  id: z.string().min(1),
  /** Value persisted on items (e.g. "on_sale"). */
  value: z.string().min(1),
  /** Artist-facing label (e.g. "On sale"). */
  label: z.string().min(1),
});

export type SelectOption = z.infer<typeof selectOptionSchema>;

/**
 * Discriminated union over every field type in the v1 palette (ADR §6).
 *
 * To add a new field type:
 *
 *   1. Add a variant to this union.
 *   2. Add a matching value variant in §3 below.
 *   3. Extend `buildFieldValueZodSchema` (which applies field-level
 *      constraints like `maxLength` / `min` / `options`).
 *   4. Add a runtime-narrowing accessor in `./accessors.ts` if hand-
 *      coded blocks read it directly.
 */
export const fieldDefSchema = z.discriminatedUnion("type", [
  z.object({
    ...baseFieldShape,
    type: z.literal("text"),
    required: z.boolean(),
    maxLength: z.number().int().positive().optional(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("longText"),
    required: z.boolean(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("richText"),
    required: z.boolean(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("number"),
    required: z.boolean(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("boolean"),
    /** Default applied when an item omits the field entirely. */
    default: z.boolean().optional(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("select"),
    required: z.boolean(),
    options: z.array(selectOptionSchema).min(1),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("multiSelect"),
    options: z.array(selectOptionSchema).min(1),
    /** Inclusive bounds on the number of selected options. Optional. */
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().positive().optional(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("date"),
    required: z.boolean(),
    /** When true, value carries a time component (full ISO 8601). */
    includeTime: z.boolean().optional(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("url"),
    required: z.boolean(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("email"),
    required: z.boolean(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("color"),
    required: z.boolean(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("image"),
    required: z.boolean(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("file"),
    required: z.boolean(),
    /** Allowed MIME types (e.g. `["audio/*", "application/pdf"]`). */
    mimeFilter: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("collectionRef"),
    required: z.boolean(),
    /** Slug of the target collection (e.g. "tour-dates"). */
    targetCollection: slugSchema,
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("multiCollectionRef"),
    /** Slug of the target collection. All refs in the array point to it. */
    targetCollection: slugSchema,
    /** Inclusive bounds on the array length. Optional. */
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().positive().optional(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal("puckContent"),
  }),
]);

export type FieldDef = z.infer<typeof fieldDefSchema>;
export type FieldType = FieldDef["type"];

/**
 * Required-ness with sensible defaults for variants that omit the flag.
 * `multiSelect` / `multiCollectionRef` use `minItems` instead of a
 * boolean — they're never "required" in the present/absent sense.
 */
export function isFieldRequired(field: FieldDef): boolean {
  switch (field.type) {
    case "boolean":
    case "multiSelect":
    case "multiCollectionRef":
    case "puckContent":
      return false;
    default:
      return field.required;
  }
}

// ---------------------------------------------------------------------------
// 3. FieldValue
// ---------------------------------------------------------------------------

/**
 * Tiptap document shape. Validated leniently here — the rich-text editor
 * (PR 6) owns the strict shape. The store layer treats it as opaque
 * structured content.
 */
const tiptapJsonSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.unknown()).optional(),
});

export type TiptapJSON = z.infer<typeof tiptapJsonSchema>;

const fileRefSchema = z.object({
  /** Absolute or repo-root-relative path. */
  src: z.string().min(1),
  mimeType: z.string().min(1),
  originalName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

export type FileRef = z.infer<typeof fileRefSchema>;

/**
 * A reference to one item in a (potentially different) collection.
 *
 * The target collection is fixed on the `FieldDef.targetCollection`, so
 * we don't repeat it in every value — the renderer always has the
 * FieldDef in hand when resolving a binding. `multiCollectionRef` uses
 * the same convention: just an array of item ids.
 */
const collectionRefSchema = z.object({
  itemId: z.string().min(1),
});

export type CollectionRefValue = z.infer<typeof collectionRefSchema>;

const multiCollectionRefValueSchema = z.array(z.string().min(1));

/**
 * Puck `Data` is validated leniently — any object with a `content` array
 * (and an optional `root`) parses. The Puck library does deeper shape
 * checks at render time.
 *
 * The cast to `z.ZodType<PuckData>` is a trust boundary: anything that
 * survives Puck's own runtime checks in the editor and round-trips
 * through `stringifyContent` will parse here. We intentionally don't
 * mirror Puck's internal Data shape, both because it's internal API and
 * because mirroring it would couple this layer to Puck's release cadence.
 */
const puckDataLooseSchema = z
  .object({
    content: z.array(z.unknown()),
    root: z.object({}).passthrough().optional(),
  })
  .passthrough() as unknown as z.ZodType<PuckData>;

/**
 * Static discriminated union over every value kind. The dynamic builder
 * below applies field-level constraints (maxLength, options, …) on top
 * of these.
 */
export const fieldValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), value: z.string() }),
  z.object({ type: z.literal("longText"), value: z.string() }),
  z.object({ type: z.literal("richText"), value: tiptapJsonSchema }),
  z.object({ type: z.literal("number"), value: z.number() }),
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  z.object({ type: z.literal("select"), value: z.string() }),
  z.object({ type: z.literal("multiSelect"), value: z.array(z.string()) }),
  z.object({ type: z.literal("date"), value: z.string() }),
  z.object({ type: z.literal("url"), value: z.string() }),
  z.object({ type: z.literal("email"), value: z.string() }),
  z.object({ type: z.literal("color"), value: z.string() }),
  z.object({ type: z.literal("image"), value: imageMetadataSchema }),
  z.object({ type: z.literal("file"), value: fileRefSchema }),
  z.object({ type: z.literal("collectionRef"), value: collectionRefSchema }),
  z.object({ type: z.literal("multiCollectionRef"), value: multiCollectionRefValueSchema }),
  z.object({ type: z.literal("puckContent"), value: puckDataLooseSchema }),
]);

export type FieldValue = z.infer<typeof fieldValueSchema>;

/**
 * Build a Zod schema for one `FieldValue` against its `FieldDef`. This
 * is the variant chosen from the static union above, with field-level
 * constraints (maxLength, min/max, select options, mime filters, date
 * format) layered on top.
 */
export function buildFieldValueZodSchema(field: FieldDef): ZodTypeAny {
  switch (field.type) {
    case "text": {
      let inner = z.string();
      if (field.maxLength !== undefined) inner = inner.max(field.maxLength);
      return z.object({ type: z.literal("text"), value: inner });
    }
    case "longText":
      return z.object({ type: z.literal("longText"), value: z.string() });
    case "richText":
      return z.object({ type: z.literal("richText"), value: tiptapJsonSchema });
    case "number": {
      let inner = z.number();
      if (field.min !== undefined) inner = inner.min(field.min);
      if (field.max !== undefined) inner = inner.max(field.max);
      return z.object({ type: z.literal("number"), value: inner });
    }
    case "boolean":
      return z.object({ type: z.literal("boolean"), value: z.boolean() });
    case "select": {
      const allowed = field.options.map((o) => o.value);
      return z.object({
        type: z.literal("select"),
        value: z.string().refine((v) => allowed.includes(v), {
          message: `value must be one of: ${allowed.join(", ")}`,
        }),
      });
    }
    case "multiSelect": {
      const allowed = field.options.map((o) => o.value);
      let inner = z
        .array(z.string())
        .refine((arr) => arr.every((v) => allowed.includes(v)), {
          message: `every value must be one of: ${allowed.join(", ")}`,
        });
      if (field.minItems !== undefined) inner = inner.min(field.minItems);
      if (field.maxItems !== undefined) inner = inner.max(field.maxItems);
      return z.object({ type: z.literal("multiSelect"), value: inner });
    }
    case "date": {
      // ISO 8601 — date-only (YYYY-MM-DD) or datetime depending on includeTime.
      const pattern = field.includeTime
        ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
        : /^\d{4}-\d{2}-\d{2}$/;
      return z.object({
        type: z.literal("date"),
        value: z.string().regex(pattern, {
          message: field.includeTime
            ? "value must be ISO 8601 datetime (YYYY-MM-DDTHH:MM[:SS][Z|±HH:MM])"
            : "value must be ISO 8601 date (YYYY-MM-DD)",
        }),
      });
    }
    case "url":
      return z.object({ type: z.literal("url"), value: z.string().url() });
    case "email":
      return z.object({ type: z.literal("email"), value: z.string().email() });
    case "color":
      return z.object({
        type: z.literal("color"),
        value: z.string().regex(/^#[0-9a-fA-F]{6}$/, "value must be a 6-digit hex color"),
      });
    case "image":
      return z.object({ type: z.literal("image"), value: imageMetadataSchema });
    case "file": {
      const valueSchema = field.mimeFilter
        ? fileRefSchema.refine((v) => matchesMimeFilter(v.mimeType, field.mimeFilter ?? []), {
            message: `mimeType must match one of: ${field.mimeFilter.join(", ")}`,
          })
        : fileRefSchema;
      return z.object({ type: z.literal("file"), value: valueSchema });
    }
    case "collectionRef":
      return z.object({ type: z.literal("collectionRef"), value: collectionRefSchema });
    case "multiCollectionRef": {
      let inner = multiCollectionRefValueSchema;
      if (field.minItems !== undefined) inner = inner.min(field.minItems);
      if (field.maxItems !== undefined) inner = inner.max(field.maxItems);
      return z.object({ type: z.literal("multiCollectionRef"), value: inner });
    }
    case "puckContent":
      return z.object({ type: z.literal("puckContent"), value: puckDataLooseSchema });
  }
}

/**
 * MIME filter pattern. Supports literal types (`audio/mpeg`) and
 * wildcards (`audio/*`, `*\/*`). The wildcard form is what the artist
 * sees most often — it matches everything under that type.
 */
function matchesMimeFilter(mime: string, filters: string[]): boolean {
  return filters.some((filter) => {
    if (filter === "*/*") return true;
    if (filter.endsWith("/*")) return mime.startsWith(filter.slice(0, -1));
    return mime === filter;
  });
}

// ---------------------------------------------------------------------------
// 4. CollectionDef
// ---------------------------------------------------------------------------

/**
 * Canonical sort modes — single source of truth per CLAUDE.md §1 / §6.
 * Schema literals, runtime discrimination in `store.ts` /
 * `draft-store.ts`, and any future editor UI all read from here.
 */
export const COLLECTION_SORT_MODES = ["manual", "fieldSort"] as const;
export type CollectionSortMode = (typeof COLLECTION_SORT_MODES)[number];

const collectionSortSchema = z.union([
  z.object({ mode: z.literal("manual") }),
  z.object({
    mode: z.literal("fieldSort"),
    fieldId: fieldIdSchema,
    direction: z.enum(["asc", "desc"]),
  }),
]);

export type CollectionSort = z.infer<typeof collectionSortSchema>;

/**
 * Schema validating `_collection.json`. Cross-field invariants — no
 * duplicate field ids/keys, slugSourceFieldId and defaultSort.fieldId
 * must reference real fields, detailUrlPrefix must start with `/` — are
 * enforced via `superRefine`.
 */
/**
 * Current `CollectionDef` shape version. Bumped on breaking model
 * changes; the migration runner (deferred) keys off this to rewrite
 * old `_collection.json` files before consumers see them. Always
 * present on v1 files so future migrations have a reliable starting
 * point instead of inferring "what version is this" from missing-field
 * heuristics.
 */
export const CURRENT_COLLECTION_SCHEMA_VERSION = 1;

/**
 * Field types whose stored value can be slugified for use as an item's
 * URL slug. Pointing `slugSourceFieldId` at any other field type fails
 * `_collection.json` validation — the slug-derivation function
 * (PR 4 territory) would have no string to work with.
 */
// Field-type classification sets live in `./field-classification.ts`.
// (Historically they were split out so client components could import
// them without dragging `node:crypto` — schema.ts's old `generateFieldId`
// dependency — into the browser bundle. That dependency now lives in
// `./id-gen.ts` and schema.ts is node-free, but the dedicated module is
// still the home for these sets.) Imported here so the validator below
// can consult them, and re-exported for source-compat with callers that
// consumed them from the schema module before the split.
import { SLUG_SOURCE_COMPATIBLE_TYPES, SORTABLE_FIELD_TYPES } from "./field-classification";

export { SLUG_SOURCE_COMPATIBLE_TYPES, SORTABLE_FIELD_TYPES };

export const collectionDefSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_COLLECTION_SCHEMA_VERSION),

    // Identity
    slug: slugSchema,
    singularName: z.string().min(1),
    pluralName: z.string().min(1),

    // Schema
    fields: z.array(fieldDefSchema),
    /** Field whose value derives an item's URL slug. */
    slugSourceFieldId: fieldIdSchema.nullable(),

    // Routing (ADR §8). null = items have no public detail pages.
    detailUrlPrefix: z.string().nullable(),

    // Ordering (ADR §7 + §1)
    defaultSort: collectionSortSchema.nullable(),

    // Templates — all optional. Null is meaningful (ADR §4).
    /** Compact list-context rendering. Primitive blocks only. */
    itemTemplate: puckDataLooseSchema.nullable(),
    /** Detail-page rendering. Primitives + Collection blocks. */
    detailTemplate: puckDataLooseSchema.nullable(),
    /** Optional auto-generated list page; null = author as a Page. */
    listTemplate: puckDataLooseSchema.nullable(),

    // Flags
    /**
     * True for collections with exactly one item (settings, header,
     * appearance). UI hides item-list affordances; storage uses
     * `items/_singleton.json` instead of `items/<slug>.json`.
     */
    isSingleton: z.boolean(),
  })
  .superRefine((def, ctx) => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const field of def.fields) {
      if (ids.has(field.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fields"],
          message: `Duplicate field id: ${field.id}`,
        });
      }
      ids.add(field.id);
      if (keys.has(field.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fields"],
          message: `Duplicate field key: ${field.key}`,
        });
      }
      keys.add(field.key);
    }
    if (def.slugSourceFieldId) {
      const sourceField = def.fields.find((f) => f.id === def.slugSourceFieldId);
      if (!sourceField) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slugSourceFieldId"],
          message: `slugSourceFieldId references unknown field: ${def.slugSourceFieldId}`,
        });
      } else if (!SLUG_SOURCE_COMPATIBLE_TYPES.has(sourceField.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slugSourceFieldId"],
          message: `slugSourceFieldId must reference a field whose value can be slugified; ` +
            `field "${sourceField.key}" has type "${sourceField.type}" which can't be (allowed: ${[
              ...SLUG_SOURCE_COMPATIBLE_TYPES,
            ].join(", ")})`,
        });
      }
    }
    if (def.defaultSort?.mode === "fieldSort" && !ids.has(def.defaultSort.fieldId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultSort", "fieldId"],
        message: `defaultSort.fieldId references unknown field: ${def.defaultSort.fieldId}`,
      });
    }
    if (def.detailUrlPrefix !== null && !def.detailUrlPrefix.startsWith("/")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detailUrlPrefix"],
        message: "detailUrlPrefix must start with '/' or be null",
      });
    }
  });

export type CollectionDef = z.infer<typeof collectionDefSchema>;

/**
 * True when `(def, itemSlug)` addresses a singleton's one record. Named
 * so the several admin surfaces that special-case the singleton (the
 * item read pages' lazy-draft synthesis, the item PUT's create-on-first-
 * save) share one predicate and can't drift apart.
 */
export function isSingletonItem(
  def: Pick<CollectionDef, "isSingleton">,
  itemSlug: string,
): boolean {
  return def.isSingleton && itemSlug === SINGLETON_ITEM_SLUG;
}

/** Look up a field by id on a CollectionDef, or `undefined` if absent. */
export function findField(def: CollectionDef, fieldId: FieldId): FieldDef | undefined {
  return def.fields.find((f) => f.id === fieldId);
}

// ---------------------------------------------------------------------------
// 5. Item / ItemFile and dynamic per-collection schema
// ---------------------------------------------------------------------------

/**
 * ISO 8601 datetime (e.g. `2026-05-17T18:30:00.000Z`). Validated via
 * `Date.parse` round-trip rather than a regex so we accept the full
 * ISO 8601 surface — timezones, fractional seconds, etc.
 */
const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be an ISO 8601 datetime",
  });

/**
 * On-disk shape of an item file (slug is implicit from the filename).
 *
 * `createdAt` / `updatedAt` are system-owned timestamps — the store
 * sets `updatedAt` to "now" on every write and `createdAt` to "now"
 * when an item is first created. Consumers should treat any caller-
 * supplied `updatedAt` as advisory; the store will override.
 *
 * Adding them in v1 (rather than later via backfill) avoids needing a
 * migration pass over every committed item across every artist repo.
 */
export type ItemFile = {
  id: ItemId;
  createdAt: string;
  updatedAt: string;
  values: Record<FieldId, FieldValue>;
};

/**
 * One entry in a collection — in-memory shape including the URL slug.
 * The slug is derived from the filename so a rename is a single
 * file-system operation, not a content edit.
 */
export type Item = ItemFile & {
  /** URL slug; matches the filename (without `.json`) it was loaded from. */
  slug: string;
};

/**
 * Structural shell of an `ItemFile` — the wrapper shape without
 * per-field constraints. Used by the publish layer to reject obviously
 * malformed payloads (missing id, wrong wrapper, a whole CollectionDef
 * pasted by mistake) without needing the originating CollectionDef.
 *
 * Per-field constraint validation (maxLength, select options, mime
 * filters, …) requires the collection's current schema and runs at the
 * API-route level via `buildItemFileSchema(def.fields)`.
 */
export const itemFileShellSchema = z.object({
  id: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  values: z.record(z.string(), fieldValueSchema),
});

/**
 * Build the values map schema for a collection. Required fields must be
 * present; optional fields may be absent. Extra keys (fields the artist
 * deleted but that still appear in the item file) are stripped on parse.
 */
function buildValuesSchema(
  fields: FieldDef[],
): z.ZodType<Record<string, FieldValue>> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of fields) {
    const valueSchema = buildFieldValueZodSchema(field);
    shape[field.id] = isFieldRequired(field) ? valueSchema : valueSchema.optional();
  }
  return z.object(shape) as unknown as z.ZodType<Record<string, FieldValue>>;
}

/**
 * Build a Zod schema for the on-disk `ItemFile` (slug omitted — derived
 * from the filename). Used by the store layer when reading and writing.
 */
export function buildItemFileSchema(fields: FieldDef[]): z.ZodType<ItemFile> {
  return z.object({
    id: z.string().min(1),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    values: buildValuesSchema(fields),
  });
}

// ---------------------------------------------------------------------------
// _order.json
// ---------------------------------------------------------------------------

/**
 * Shape of `items/_order.json` — an ordered list of item slugs.
 * Unknown slugs (e.g. a deleted item still referenced by an older
 * commit) are filtered out at read time by the store, so this schema
 * only enforces the array shape.
 */
export const orderFileSchema = z.array(slugSchema);

// ---------------------------------------------------------------------------
// 6. Bindable (template-renderer type, used by PR 2; declared here so the
//    type model lives in one file)
// ---------------------------------------------------------------------------

/**
 * Value held by a content-bearing block prop. Either a literal of type `T`,
 * or a binding to a `FieldId` resolved against the item at render time.
 *
 * Bindings only mean something inside templates (itemTemplate /
 * detailTemplate / listTemplate). Page bodies and an item's own
 * `puckContent` hold plain literals — there's no "field" to bind to,
 * because the artist is producing this item's data, not a template.
 */
/**
 * Optional display format for a *string* binding (date / select fields),
 * applied by `resolveStringBindable`. Date presets format the ISO value in
 * UTC; `label` maps a `select` value to its option label. A format that
 * doesn't match the bound field's type is ignored (the raw value renders),
 * so a mis-set format fails safe rather than blanking the binding.
 *
 *   - `year`        — `"2026"` (UTC calendar year)
 *   - `weekday-day` — `"Sat, Aug 1"` (UTC short weekday + month + day)
 *   - `full`        — `"May 10, 2026"` (UTC short month + day + year)
 *   - `label`       — a `select` value mapped to its option label
 */
export type BindableFormat = "year" | "weekday-day" | "full" | "label";

/**
 * The object form of a `Bindable<T>`: an explicit literal or a binding. The
 * template editor's pickers always write this form.
 */
export type BindableRef<T> =
  | { kind: "literal"; value: T }
  | { kind: "binding"; fieldId: FieldId; format?: BindableFormat };

/**
 * A block prop that takes either a plain literal `T` (what the page editor
 * writes, and every committed page body holds) or a `BindableRef<T>` (what the
 * template editor writes). The same block works on pages and in templates.
 */
export type Bindable<T> = T | BindableRef<T>;

// ---------------------------------------------------------------------------
// 7. Collection-block filters (ADR-009 §5.1)
//
// Declared in `./filter-schema.ts` and re-exported here for the curated
// `@/lib/collections` surface. (Historically the split kept the filter
// Zod defs out of client bundles back when this file imported
// `node:crypto` via `generateFieldId`; that generator now lives in
// `./id-gen.ts` and schema.ts is node-free, but the dedicated module
// remains the home for the filter schema.)
// ---------------------------------------------------------------------------

export { filterSchema } from "./filter-schema";
export type { Filter, FilterClause, FilterValue } from "./filter-schema";

/**
 * (Older docstring preserved for context — see `./filter-schema.ts`
 * for the live definitions.)
 *
 * A Collection block's filter expression. `all` means AND across
 * clauses; `any` means OR. Nested groupings aren't supported in v1;
 * the artist can compose them by stacking multiple Collection blocks
 * with different filters.
 */
