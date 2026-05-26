/**
 * Unified public render config (ADR-015 convergence).
 *
 * One Puck `Config` that can render a hand-authored page through the template
 * walker: the page editor's **chrome** blocks (Section, Columns, Heading,
 * Image, Card, …) keep their exact render functions from `puckConfig`, and the
 * generic **Collection block** (`TourDatesView` / `ReleasesView` / `PostsView`
 * / any `<Slug>View`) + the template **primitives** are layered on top.
 *
 * The catch-all's page render walks the page body with the matching registry
 * (`PRIMITIVE_BLOCKS` ∪ `buildCollectionBlockRegistry(slugs)`) so Collection
 * blocks resolve their items, then hands the resolved data to `<Render>` with
 * this config. Chrome blocks have no walker entry — they pass through the
 * walker untouched (renderer.tsx's structural slot recursion) and render here
 * via their `puckConfig` render fns.
 *
 * Built per-request from the live collection slugs. Client-safe (no node /
 * server imports) so the page editor can adopt the same config later.
 */

import type { Config } from "@measured/puck";

import { buildCollectionBlockRegistry } from "@/lib/collections/template/collection-block";
import { buildTemplatePuckConfig } from "@/lib/collections/template/puck-config";

import { puckConfig } from "./config";

export function buildUnifiedPublicConfig(collectionSlugs: ReadonlyArray<string>): Config {
  // One generic Collection block per slug, named `<Slug>View` (e.g.
  // `TourDatesView`). Deliberately NO template primitives here: a page body is
  // chrome blocks + Collection blocks, and several primitives (Section, Button,
  // Image, RichText) share a NAME with chrome blocks but expect Bindable props
  // — letting them override would break chrome rendering. Primitives are only
  // used inside a collection's `itemTemplate`, which renders through its own
  // `templatePuckConfig`, not this page config.
  const collectionComponents = buildTemplatePuckConfig(
    buildCollectionBlockRegistry(collectionSlugs),
  ).components;

  return {
    ...puckConfig,
    components: {
      // Chrome render fns win for their names; the generic Collection blocks
      // override the same-named bespoke `*View` blocks in `puckConfig`.
      ...(puckConfig.components as Config["components"]),
      ...collectionComponents,
    },
  } as Config;
}
