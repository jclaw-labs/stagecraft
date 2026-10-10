/**
 * Cross-cutting field-type classifications used by both server- and
 * client-side code (schema editor dropdowns, collection-block
 * inspector, the public-renderer's sort key).
 *
 * Lives in its own file (not in `schema.ts`) so client components
 * importing these sets don't transitively pull `node:crypto` into
 * the browser bundle via `schema.ts`'s `generateFieldId`. Same
 * client-bundling discipline as `filter-schema.ts` /
 * `puck-content-value.ts`.
 *
 * Each set is the SINGLE source of truth for its classification —
 * the schema-editor "Slug source" dropdown, the Collection block's
 * "Sort field" dropdown, and the `collectionDefSchema.superRefine`
 * validator all derive from these exports. Drift between local
 * hand-maintained sets is what prompted the consolidation.
 */

import type { FieldType } from "./schema";

/**
 * Field types whose value can be safely slugified by the new-item
 * flow's `suggestSlug`. Mirrored at runtime by the
 * `collectionDefSchema.superRefine` check for `slugSourceFieldId`.
 *
 * `boolean` / `multiSelect` / `image` etc. are excluded — they have
 * no scalar string representation an artist would want as a URL.
 */
export const SLUG_SOURCE_COMPATIBLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "longText",
  "select",
  "url",
  "email",
  "date",
  "number",
]);

/**
 * Field types that can serve as a sort key. Mirrors the
 * `scalarSortKey` accessor (`./sort-key.ts`) — anything not in this
 * set returns null from that accessor, which means "sort to the
 * end."
 */
export const SORTABLE_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "longText",
  "date",
  "url",
  "email",
  "color",
  "select",
  "number",
  "boolean",
]);

/**
 * Display order + artist-facing labels for every field type. Drives the
 * schema editor's type pickers and any artist-facing copy that names a
 * type (e.g. the specialised-view warnings in
 * `./template/view-requirements.ts`). Most-used types first.
 */
export const FIELD_TYPE_OPTIONS: ReadonlyArray<{ value: FieldType; label: string }> = [
  { value: "text", label: "Short text" },
  { value: "longText", label: "Long text" },
  { value: "richText", label: "Rich text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
  { value: "select", label: "Single-choice" },
  { value: "multiSelect", label: "Multi-choice" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "color", label: "Color" },
  { value: "image", label: "Image" },
  { value: "file", label: "File" },
  { value: "collectionRef", label: "Reference (one)" },
  { value: "multiCollectionRef", label: "References (many)" },
  { value: "puckContent", label: "Page content (Puck)" },
];

/** Artist-facing label for a field type ("Short text", "Image", …). */
export function fieldTypeLabel(type: FieldType): string {
  return FIELD_TYPE_OPTIONS.find((opt) => opt.value === type)?.label ?? type;
}
