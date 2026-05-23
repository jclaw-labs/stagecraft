/**
 * Server-side helper: pre-load the collections a template needs,
 * keyed by slug, ready to hand to `TemplateRenderer` /
 * `resolveTemplate` via `loadedCollections`.
 *
 * The walker stays sync — I/O happens here at the renderer's edge.
 * The catch-all route uses this to discover which collections the
 * page's template references (via `findCollectionBlockSources`),
 * load them in parallel, and pass the map down.
 *
 * Lives in its own file so `renderer.tsx` stays free of fs imports
 * — keeps the test surface lean for the walker / resolver.
 */

import {
  listItemsInOrder,
  readCollectionDef,
} from "../store";
import { findCollectionBlockSources } from "./collection-block";
import type { LoadedCollections } from "./renderer";
import type { Template } from "./types";

/**
 * Pre-walk the template for Collection block sources, load each in
 * parallel, return the map. Skips slugs whose collection or items
 * fail to load (the resolver returns empty when the slug isn't in
 * the map; the block renders nothing rather than crashing).
 */
export async function loadCollectionsForTemplate(
  template: Template | null,
): Promise<LoadedCollections> {
  if (!template) return {};
  const sources = findCollectionBlockSources(template);
  if (sources.length === 0) return {};

  // Parallel load. Each (def, items) read is two filesystem reads
  // at worst; the dynamic-Zod schema validates each item on read.
  const entries = await Promise.all(
    sources.map(async (slug) => {
      const def = await readCollectionDef(slug);
      if (!def) return null;
      const items = await listItemsInOrder(slug, def);
      return [slug, { def, items }] as const;
    }),
  );
  const loaded: Record<string, { def: NonNullable<Awaited<ReturnType<typeof readCollectionDef>>>; items: Awaited<ReturnType<typeof listItemsInOrder>> }> = {};
  for (const entry of entries) {
    if (entry) loaded[entry[0]] = entry[1];
  }
  return loaded;
}
