/**
 * Sort-key extraction for `FieldValue`s.
 *
 * Two consumers — the store (`defaultSort.mode === "fieldSort"` in
 * `listItemsInOrder`) and Collection blocks (`sort: { fieldId,
 * direction }` resolved in `resolveCollectionBlockProps`). Both rank
 * items the same way; the helper lives here so they can't drift.
 *
 * Returns `null` for value types where sorting isn't meaningful
 * (image / file / puckContent / multiSelect / richText /
 * collectionRef). Items whose sort field has a null key sort to the
 * end in both consumers.
 */

import type { FieldValue, Item } from "./schema";

export function scalarSortKey(
  value: FieldValue | undefined,
): string | number | null {
  if (value === undefined) return null;
  switch (value.type) {
    case "text":
    case "longText":
    case "date":
    case "url":
    case "email":
    case "color":
    case "select":
    case "number":
      return value.value;
    case "boolean":
      return value.value ? 1 : 0;
    default:
      return null;
  }
}

/**
 * Three-way compare two items by a single field. Items whose value
 * isn't sortable (per `scalarSortKey`) sort to the end. Ties break on
 * slug for stable ordering.
 */
export function compareItemsByField(
  a: Item,
  b: Item,
  fieldId: string,
  direction: "asc" | "desc",
): number {
  const av = scalarSortKey(a.values[fieldId]);
  const bv = scalarSortKey(b.values[fieldId]);
  if (av === null && bv === null) return a.slug.localeCompare(b.slug);
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp = av < bv ? -1 : av > bv ? 1 : 0;
  return direction === "asc" ? cmp : -cmp;
}
