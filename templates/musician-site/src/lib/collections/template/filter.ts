/**
 * Filter resolution for Collection blocks (ADR-009 §5.1).
 *
 * Given a `Filter` from a Collection block's stored config + the
 * `currentItem` (the surrounding template's item, e.g. the page
 * being rendered) + the candidate items to filter, return the items
 * the block should render.
 *
 * Pure function; no I/O. `now` (defaulting to the call-time `new Date()`) is
 * the clock the `today` FilterValue resolves against — injected so tests stay
 * deterministic and the function stays referentially transparent. The caller
 * (`<RenderCollectionView>` in PR 7b) loads the candidates from disk first.
 *
 * Filter shape lives in `../schema.ts` (the Zod side); the resolver
 * lives here so the template-renderer module owns the runtime
 * behaviour for everything inside a template.
 *
 * Notable rules:
 *
 *   - A clause's `field` is matched against `item.values[fieldId]`.
 *     If the field doesn't exist (deleted from the schema, missing
 *     on this item), the comparison returns false. The block hides
 *     the item; it doesn't error. The Collection block first drops
 *     clauses on fields its collection no longer has
 *     (`withoutClausesOnMissingFields`), so in practice this hides an
 *     item with no value for a field that still exists.
 *
 *   - `FilterValue` resolves to a scalar comparable: literals are
 *     compared by value, `currentItemId` resolves to
 *     `currentItem.id`, `currentItemField` reaches into
 *     `currentItem.values[fieldId].value`, and `today` resolves to the
 *     start of the current day in UTC (`YYYY-MM-DD`).
 *
 *   - `excludeCurrentItem` short-circuits when the candidate's id
 *     matches `currentItem.id`. Combines with other clauses under
 *     `all` / `any` normally.
 *
 *   - Equality on `multiSelect` values means "contains this value."
 *     `value: ["a", "b"]` `equals` `"a"` is true. Matches the
 *     mental model most artists have for selecting via tags.
 *
 *   - `gt` / `gte` / `lt` / `lte` work on numbers and on ISO date
 *     strings (lexicographic comparison gives the right order for
 *     `YYYY-MM-DD[THH:MM[:SS]]`). Pairing a date field's `gte` with the
 *     `today` value expresses an "upcoming" window; `lt today` a "past" one.
 */

import type { Filter, FilterClause, FilterValue, Item } from "../schema";

export function applyFilter(
  items: ReadonlyArray<Item>,
  filter: Filter | null | undefined,
  currentItem: Item,
  now: Date = new Date(),
): Item[] {
  if (!filter) return [...items];
  return items.filter((item) => matchesFilter(item, filter, currentItem, now));
}

/**
 * `filter` with every clause's `field` passed through `fieldIdFor`, and
 * every `currentItemField` value's field id through
 * `currentItemFieldIdFor`. They're separate mappings because a
 * `currentItemField` value names a field of the *surrounding* item,
 * which is usually from another collection. When it's from the same one
 * (a tour-dates detail template listing other tour dates), the caller
 * resolves it against the surrounding item's def, so a value naming a
 * deleted-and-re-added field reads the new one. Omitted, those ids are
 * left alone.
 */
export function mapFilterFields(
  filter: Filter,
  fieldIdFor: (fieldId: string) => string,
  currentItemFieldIdFor: (fieldId: string) => string = (fieldId) => fieldId,
): Filter {
  const mapValue = (value: FilterValue): FilterValue =>
    value.kind === "currentItemField"
      ? { ...value, fieldId: currentItemFieldIdFor(value.fieldId) }
      : value;
  const mapClause = (clause: FilterClause): FilterClause => {
    if (!("field" in clause)) return clause;
    const field = fieldIdFor(clause.field);
    if ("values" in clause) return { ...clause, field, values: clause.values.map(mapValue) };
    if ("value" in clause) return { ...clause, field, value: mapValue(clause.value) };
    return { ...clause, field };
  };
  return "all" in filter ? { all: filter.all.map(mapClause) } : { any: filter.any.map(mapClause) };
}

/**
 * `filter` with every clause whose `field` fails `hasField` treated as
 * matching every item. In an `all` group that clause is dropped, and
 * `null` (no filter) comes back when none is left. In an `any` group one
 * such clause already matches every item, so the whole filter becomes
 * `null`. `excludeCurrentItem` clauses name no field and stay.
 *
 * A Collection block saves field ids. A clause on a field the artist has
 * since deleted would otherwise hide every item (a missing value never
 * matches), with nothing in the product to bring them back; this way the
 * filter on the removed field just stops filtering.
 */
export function withoutClausesOnMissingFields(
  filter: Filter,
  hasField: (fieldId: string) => boolean,
): Filter | null {
  const keep = (clause: FilterClause): boolean => !("field" in clause) || hasField(clause.field);
  if ("any" in filter) return filter.any.every(keep) ? filter : null;
  const clauses = filter.all.filter(keep);
  return clauses.length === 0 ? null : { all: clauses };
}

function matchesFilter(item: Item, filter: Filter, currentItem: Item, now: Date): boolean {
  if ("all" in filter) {
    return filter.all.every((clause) => matchesClause(item, clause, currentItem, now));
  }
  return filter.any.some((clause) => matchesClause(item, clause, currentItem, now));
}

function matchesClause(item: Item, clause: FilterClause, currentItem: Item, now: Date): boolean {
  // Single dispatch on the discriminator. The shape narrows cleanly
  // per-case (TS doesn't propagate complex narrowings across early
  // returns when the clause shape varies between `value` and
  // `values`, so the switch keeps each arm in its own scope).
  if ("excludeCurrentItem" in clause) {
    return item.id !== currentItem.id;
  }
  switch (clause.op) {
    case "isEmpty":
      return item.values[clause.field] === undefined;
    case "isNotEmpty":
      return item.values[clause.field] !== undefined;
    case "in":
    case "notIn": {
      const itemValue = scalarValueAt(item, clause.field);
      if (itemValue === undefined) return false;
      const allowed = clause.values.map((v) => resolveFilterValue(v, currentItem, now));
      const hit = Array.isArray(itemValue)
        ? itemValue.some((v) => allowed.includes(v))
        : allowed.includes(itemValue);
      return clause.op === "in" ? hit : !hit;
    }
    case "equals":
    case "notEquals":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "contains": {
      const itemValue = scalarValueAt(item, clause.field);
      if (itemValue === undefined) return false;
      const compareTo = resolveFilterValue(clause.value, currentItem, now);
      switch (clause.op) {
        case "equals":
          return scalarEquals(itemValue, compareTo);
        case "notEquals":
          return !scalarEquals(itemValue, compareTo);
        case "gt":
          return compareScalars(itemValue, compareTo) > 0;
        case "gte":
          return compareScalars(itemValue, compareTo) >= 0;
        case "lt":
          return compareScalars(itemValue, compareTo) < 0;
        case "lte":
          return compareScalars(itemValue, compareTo) <= 0;
        case "contains":
          return typeof itemValue === "string" && typeof compareTo === "string"
            ? itemValue.toLowerCase().includes(compareTo.toLowerCase())
            : false;
      }
    }
    default: {
      const _exhaustive: never = clause;
      void _exhaustive;
      return false;
    }
  }
}

/**
 * Pull the scalar value out of an item's `FieldValue` at `fieldId`.
 *
 * For `multiSelect` and `multiCollectionRef`, returns the array as-is
 * so the in/notIn / equals semantics can "contains-this" against the
 * member values. For every other type, returns the inner `value`.
 *
 * Returns `undefined` if the field is missing or its shape isn't
 * scalar-like (e.g. richText, puckContent).
 */
function scalarValueAt(item: Item, fieldId: string): unknown {
  const v = item.values[fieldId];
  if (v === undefined) return undefined;
  switch (v.type) {
    case "text":
    case "longText":
    case "url":
    case "email":
    case "color":
    case "select":
    case "date":
    case "number":
    case "boolean":
    case "multiSelect":
    case "multiCollectionRef":
      return v.value;
    case "collectionRef":
      return v.value.itemId;
    case "richText":
    case "image":
    case "file":
    case "puckContent":
      // Not scalar-comparable — the filter hides items keyed on these.
      return undefined;
    default: {
      // Exhaustiveness check — TS errors here if a new FieldType is
      // added to the discriminated union without a matching case
      // above. Forces the contributor to decide what filtering
      // semantics the new type should have.
      const _exhaustive: never = v;
      void _exhaustive;
      return undefined;
    }
  }
}

function resolveFilterValue(value: FilterValue, currentItem: Item, now: Date): unknown {
  switch (value.kind) {
    case "literal":
      return value.value;
    case "currentItemId":
      return currentItem.id;
    case "currentItemField":
      return scalarValueAt(currentItem, value.fieldId);
    case "today":
      // Start of the current day in UTC, date-only. Compares correctly
      // (lexicographically) against both `YYYY-MM-DD` and full-ISO date
      // field values — see the `FilterValue` doc in filter-schema.ts.
      return toUtcDateOnly(now);
    default: {
      const _exhaustive: never = value;
      void _exhaustive;
      return undefined;
    }
  }
}

/** `Date` → `YYYY-MM-DD` in UTC (the ISO date portion). */
function toUtcDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Equality with the "array contains the value" relaxation for
 * multiSelect / multiCollectionRef item-side values. Avoids the
 * worse alternative of asking the artist to use `in` for what feels
 * conceptually like equality ("does this release have the
 * 'instrumental' tag?").
 */
function scalarEquals(itemValue: unknown, compareTo: unknown): boolean {
  if (Array.isArray(itemValue)) {
    return itemValue.includes(compareTo);
  }
  return itemValue === compareTo;
}

/**
 * Three-way compare for ordered scalars. Numbers compare numerically;
 * ISO date strings compare lexicographically (the format guarantees
 * the order). Falls back to `0` (equal) for anything else, which
 * means gt/lt against incompatible types is always false.
 */
function compareScalars(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  return 0;
}
