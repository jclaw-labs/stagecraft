/**
 * Server-side resolve pass for data-bound collection blocks embedded on
 * hand-authored pages (ADR-009 §5 — page-system variant).
 *
 * The page editor's `puckConfig` blocks are pure: they render from literal
 * props with no data-fetching. `TourDatesView` is the exception — it shows
 * the artist's real `tour-dates` collection. A Puck block can't fetch its
 * own items (`<Render>` is synchronous and the block component is pure), so
 * the public catch-all runs this pass over the page data *before* rendering:
 * it walks the block tree, loads the backing collection once, and injects
 * the resolved items into each matching block's props.
 *
 * In the editor (no resolve pass) `items` stays undefined → the block draws
 * its placeholder. On the published page the items are injected → the block
 * draws the real list. This keeps the page system's "pure blocks from
 * literal props" model intact: the data arrives as just another prop.
 *
 * Server-only. Reads the FS snapshot of `main` via `getFsReadStore` — the
 * same store every other public-render read uses — so it transitively pulls
 * `node:fs` / `next/headers`. Don't import it from a `"use client"` file.
 */

import type { Data } from "@measured/puck";

import { TOUR_DATES_FIELD_IDS } from "./field-ids";
import { getFsReadStore } from "./read-store";
import type { Item } from "./schema";

import type { ResolvedTourDate } from "@/components/TourDatesView";

const TOUR_DATES_SLUG = "tour-dates";
const TOUR_DATES_BLOCK = "TourDatesView";
/** Fallback when a block's `limit` prop is missing or non-positive. */
const DEFAULT_TOUR_LIMIT = 5;
// A cancelled show isn't "upcoming" — drop it from the public list. Mirrors
// the `cancelled` value of the tour-dates `status` field (TOUR_DATE_STATUSES
// in lib/collections/seeds.ts).
const CANCELLED_STATUS = "cancelled";

type LooseBlock = { type?: unknown; props?: Record<string, unknown> };

/**
 * Resolve every data-bound collection block in `data` against the live
 * collections, returning a new `Data` with items injected. Cheap no-op
 * (returns the input untouched, no collection read) for pages that don't
 * embed any collection block — the overwhelmingly common case.
 */
export async function resolvePageCollectionBlocks<D extends Data>(data: D): Promise<D> {
  const content = (data.content ?? []) as unknown[];
  if (!containsBlockType(content, TOUR_DATES_BLOCK)) return data;

  const store = getFsReadStore();
  const def = await store.readCollectionDef(TOUR_DATES_SLUG);
  // Collection deleted / never created → leave the blocks unresolved so
  // they render their own empty state rather than throwing.
  if (!def) return data;

  const items = await store.listItemsInOrder(TOUR_DATES_SLUG, def);
  return injectResolvedTourDates(data, mapToResolvedTourDates(items));
}

/**
 * Pure: project a list of `tour-dates` items into the presentational
 * `ResolvedTourDate` shape, keep only upcoming shows (date on/after the
 * start of today, UTC), and sort soonest-first. `now` is injectable for
 * deterministic tests.
 */
export function mapToResolvedTourDates(
  items: readonly Item[],
  now: Date = new Date(),
): ResolvedTourDate[] {
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return items
    .filter((item) => stringValue(item, TOUR_DATES_FIELD_IDS.status) !== CANCELLED_STATUS)
    .map((item) => ({
      date: stringValue(item, TOUR_DATES_FIELD_IDS.date),
      venue: stringValue(item, TOUR_DATES_FIELD_IDS.venue),
      city: stringValue(item, TOUR_DATES_FIELD_IDS.city),
      country: stringValue(item, TOUR_DATES_FIELD_IDS.country),
      ticketUrl: stringValue(item, TOUR_DATES_FIELD_IDS.ticketUrl),
    }))
    .filter((d) => {
      const ms = Date.parse(d.date);
      return !Number.isNaN(ms) && ms >= todayStartMs;
    })
    // Sort by parsed instant, not the raw string: the date field admits
    // timezone offsets (schema allows `Z` or `±HH:MM`), so a lexical compare
    // could disagree with chronology for same-day shows in mixed formats.
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/**
 * Pure: return a new `Data` with `items` injected into every
 * `TourDatesView` block (top-level or nested in any slot), each sliced to
 * its own `limit` prop. Exported for unit tests that don't touch the FS.
 */
export function injectResolvedTourDates<D extends Data>(
  data: D,
  items: ResolvedTourDate[],
): D {
  const content = (data.content ?? []) as unknown[];
  return {
    ...data,
    content: mapBlocks(content, (block) => injectTourDates(block, items)),
  } as D;
}

function injectTourDates(block: LooseBlock, all: ResolvedTourDate[]): LooseBlock {
  if (block.type !== TOUR_DATES_BLOCK) return block;
  const rawLimit = block.props?.limit;
  const limit = typeof rawLimit === "number" && rawLimit > 0 ? rawLimit : DEFAULT_TOUR_LIMIT;
  return { ...block, props: { ...block.props, items: all.slice(0, limit) } };
}

function stringValue(item: Item, fieldId: string): string {
  const value = item.values[fieldId];
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    typeof (value as { value: unknown }).value === "string"
  ) {
    return (value as { value: string }).value;
  }
  return "";
}

/** Depth-first search for a block of `type`, recursing into slot arrays. */
function containsBlockType(blocks: unknown[], type: string): boolean {
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as LooseBlock;
    if (block.type === type) return true;
    const props = block.props;
    if (props && typeof props === "object") {
      for (const value of Object.values(props)) {
        if (Array.isArray(value) && containsBlockType(value, type)) return true;
      }
    }
  }
  return false;
}

/**
 * Rebuild a block list, applying `fn` to every block and recursing into
 * any array-valued prop (Puck slot fields: Section.children, Columns.col1
 * …col4, etc.). Structural — it doesn't enumerate slot names, so a new
 * slotful block needs no change here.
 */
function mapBlocks(blocks: unknown[], fn: (b: LooseBlock) => LooseBlock): unknown[] {
  return blocks.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const block = raw as LooseBlock;
    let props = block.props;
    if (props && typeof props === "object") {
      let next: Record<string, unknown> | undefined;
      for (const [key, value] of Object.entries(props)) {
        if (Array.isArray(value)) {
          (next ??= { ...props })[key] = mapBlocks(value, fn);
        }
      }
      if (next) props = next;
    }
    const withProps: LooseBlock = props === block.props ? block : { ...block, props };
    return fn(withProps);
  });
}
