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

import { RELEASES_FIELD_IDS, TOUR_DATES_FIELD_IDS } from "./field-ids";
import { getFsReadStore } from "./read-store";
import type { Item } from "./schema";

import type { ImageMetadata } from "@/lib/image-types";
import type { ResolvedRelease } from "@/components/ReleasesView";
import type { ResolvedTourDate } from "@/components/TourDatesView";

const TOUR_DATES_SLUG = "tour-dates";
const TOUR_DATES_BLOCK = "TourDatesView";
/** Fallback when a block's `limit` prop is missing or non-positive. */
const DEFAULT_TOUR_LIMIT = 5;
// A cancelled show isn't "upcoming" — drop it from the public list. Mirrors
// the `cancelled` value of the tour-dates `status` field (TOUR_DATE_STATUSES
// in lib/collections/seeds.ts).
const CANCELLED_STATUS = "cancelled";

const RELEASES_SLUG = "releases";
const RELEASES_BLOCK = "ReleasesView";
const DEFAULT_RELEASES_LIMIT = 8;

type LooseBlock = { type?: unknown; props?: Record<string, unknown> };

/**
 * Resolve every data-bound collection block in `data` against the live
 * collections, returning a new `Data` with items injected. Cheap no-op
 * (returns the input untouched, no collection read) for pages that don't
 * embed any collection block — the overwhelmingly common case.
 */
export async function resolvePageCollectionBlocks<D extends Data>(data: D): Promise<D> {
  const content = (data.content ?? []) as unknown[];
  const hasTourDates = containsBlockType(content, TOUR_DATES_BLOCK);
  const hasReleases = containsBlockType(content, RELEASES_BLOCK);
  if (!hasTourDates && !hasReleases) return data;

  const store = getFsReadStore();
  let resolved: D = data;

  // Each collection is loaded only when its block is actually present, and
  // each inject is an independent structural pass — compose them. A deleted /
  // missing collection (def === null) leaves its blocks to their own empty
  // state rather than throwing.
  if (hasTourDates) {
    const def = await store.readCollectionDef(TOUR_DATES_SLUG);
    if (def) {
      const items = await store.listItemsInOrder(TOUR_DATES_SLUG, def);
      resolved = injectResolvedTourDates(resolved, mapToResolvedTourDates(items));
    }
  }
  if (hasReleases) {
    const def = await store.readCollectionDef(RELEASES_SLUG);
    if (def) {
      const items = await store.listItemsInOrder(RELEASES_SLUG, def);
      resolved = injectResolvedReleases(resolved, mapToResolvedReleases(items));
    }
  }
  return resolved;
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

/**
 * Pure: project `releases` items into the presentational `ResolvedRelease`
 * shape, newest first (undated releases sort to the end). The store already
 * applies the collection's releaseDate-desc default sort; re-sorting here
 * keeps the projection deterministic for unit tests that pass raw items.
 */
export function mapToResolvedReleases(items: readonly Item[]): ResolvedRelease[] {
  return items
    .map((item) => ({
      title: stringValue(item, RELEASES_FIELD_IDS.title),
      coverImage: imageValue(item, RELEASES_FIELD_IDS.coverImage),
      releaseType: stringValue(item, RELEASES_FIELD_IDS.releaseType),
      releaseDate: stringValue(item, RELEASES_FIELD_IDS.releaseDate),
      description: stringValue(item, RELEASES_FIELD_IDS.description),
    }))
    .sort((a, b) => {
      const am = Date.parse(a.releaseDate);
      const bm = Date.parse(b.releaseDate);
      const aok = !Number.isNaN(am);
      const bok = !Number.isNaN(bm);
      if (aok && bok) return bm - am; // both dated → newest first
      if (aok) return -1; // dated before undated
      if (bok) return 1;
      return 0; // both undated → keep store order
    });
}

/**
 * Pure: return a new `Data` with `items` injected into every `ReleasesView`
 * block (sliced to its `limit`). Exported for unit tests that don't touch FS.
 */
export function injectResolvedReleases<D extends Data>(data: D, items: ResolvedRelease[]): D {
  const content = (data.content ?? []) as unknown[];
  return {
    ...data,
    content: mapBlocks(content, (block) => injectReleases(block, items)),
  } as D;
}

function injectReleases(block: LooseBlock, all: ResolvedRelease[]): LooseBlock {
  if (block.type !== RELEASES_BLOCK) return block;
  const rawLimit = block.props?.limit;
  const limit = typeof rawLimit === "number" && rawLimit > 0 ? rawLimit : DEFAULT_RELEASES_LIMIT;
  return { ...block, props: { ...block.props, items: all.slice(0, limit) } };
}

function imageValue(item: Item, fieldId: string): ImageMetadata | null {
  const value = item.values[fieldId];
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type: unknown }).type === "image"
  ) {
    return (value as { value: ImageMetadata }).value;
  }
  return null;
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
