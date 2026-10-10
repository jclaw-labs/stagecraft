/**
 * The render config: what Puck's `<Render>` uses on the public site, in the
 * template editor's preview pane and inside Collection blocks (#349).
 *
 * Every block in the library plus one Collection block (`<Slug>View`) per
 * `collectionSlugs` entry. The walker (`resolveTemplate`) has already
 * resolved every binding, so blocks render their own `render` with plain
 * props.
 *
 * This is the server-safe half of the config factory. The editor surfaces
 * (`./build-config.tsx`) add the template pickers, the Collection block
 * inspectors and the page root, and nothing on the render path imports
 * them. The Collection block's render component lives here rather than
 * beside its resolver because it renders each item template through this
 * same config: config → Collection block → config is one module, so the
 * walker (`renderer.tsx`) and the Collection block data
 * (`collection-block.tsx`) import no config and the graph has no cycle.
 */

import type { ReactNode } from "react";
import { Render, type ComponentConfig, type Config } from "@puckeditor/core";

import type { CollectionDef, Item } from "@/lib/collections/schema";
import {
  blockNameForCollection,
  DefaultItemFieldsList,
  type CollectionBlockResolvedProps,
} from "@/lib/collections/template/collection-block";
import { resolveTemplate } from "@/lib/collections/template/renderer";
import {
  emptyMessageFor,
  specialisedRendererForDef,
  type SpecialisedRenderer,
} from "@/lib/collections/template/specialized-views";
import type { LoadedCollections, Template } from "@/lib/collections/template/types";
import { isSpecialisedViewSlug } from "@/lib/collections/template/view-requirements";

import { BLOCKS, type BlockLibraryConfig } from "./config";

type AnyComponent = ComponentConfig<Record<string, unknown>>;

const renderConfigCache = new Map<string, Config>();

/**
 * The render config for a tree that may embed Collection blocks for
 * `collectionSlugs`. Leave it empty for item templates: they can't embed
 * Collection blocks (ADR §4.3 cycle safety). Typed as the library's config
 * so `<Render>` keeps inferring the page `Data` shape; the Collection blocks
 * are runtime-only entries (dynamic names TS can't know).
 */
export function buildRenderConfig(collectionSlugs: ReadonlyArray<string> = []): BlockLibraryConfig {
  // Cached per slug set: Collection blocks render an item template per
  // iterated item, and each asks for the render config.
  const key = [...collectionSlugs].sort().join(",");
  let config = renderConfigCache.get(key);
  if (!config) {
    const components: Record<string, AnyComponent> = {
      ...(BLOCKS as unknown as Record<string, AnyComponent>),
    };
    for (const slug of collectionSlugs) {
      components[blockNameForCollection(slug)] = {
        fields: {},
        render: CollectionBlockRender as unknown as AnyComponent["render"],
      };
    }
    config = { components, root: {} } as Config;
    renderConfigCache.set(key, config);
  }
  return config as unknown as BlockLibraryConfig;
}

// ---------------------------------------------------------------------------
// Template renderer
// ---------------------------------------------------------------------------

export type TemplateRendererProps = {
  /** The template's Puck data (item / detail / list — same shape). */
  template: Template | null;
  /** The item to render against. Drives every binding's resolution. */
  item: Item;
  /** The item's collection. Supplies field metadata for `format`. */
  collection: CollectionDef;
  /**
   * The surrounding template's item — defaults to `item`. See
   * `ResolveContext`.
   */
  currentItem?: Item;
  /**
   * Collections whose Collection blocks (`<Slug>View`) this tree may embed.
   * Leave empty for item templates: they can't embed Collection blocks
   * (ADR §4.3 cycle safety), so any they contain render nothing.
   */
  collectionSlugs?: ReadonlyArray<string>;
  /** Items + defs the tree's Collection blocks iterate. */
  loadedCollections?: LoadedCollections;
};

/** Walk a template against an item, then render the result. */
export function TemplateRenderer({
  template,
  item,
  collection,
  currentItem,
  collectionSlugs = [],
  loadedCollections,
}: TemplateRendererProps): ReactNode {
  if (!template) return null;
  const resolved = resolveTemplate(template, item, {
    collectionSlugs,
    currentItem,
    itemDef: collection,
    loadedCollections,
  });
  return <Render config={buildRenderConfig(collectionSlugs)} data={resolved} />;
}

// ---------------------------------------------------------------------------
// Collection block render component
// ---------------------------------------------------------------------------

/**
 * Public render component for a Collection block. Server-renderable;
 * iterates the resolved items and renders each via the source
 * collection's itemTemplate.
 */
export function CollectionBlockRender({
  items,
  sourceDef,
  currentItem,
}: CollectionBlockResolvedProps): ReactNode {
  if (!sourceDef) {
    // Source collection not loaded — render nothing rather than
    // throwing. The resolver's empty `items` already covers this,
    // but be defensive about render-time invariants.
    return null;
  }
  if (items.length === 0) {
    // Restore the bespoke views' empty-state copy (ADR-015 step 5). The
    // message renders as a plain muted paragraph — no `data-collection-view`
    // wrapper, so a grid-layout slug (releases / posts) doesn't lay the single
    // line out as a grid cell. Slugs without bespoke copy fall back to the
    // empty wrapper, matching the block's prior behaviour.
    const message = emptyMessageFor(sourceDef.slug);
    return message ? (
      <p style={{ color: "var(--color-text-muted)", margin: 0 }}>{message}</p>
    ) : (
      <div data-collection-view={sourceDef.slug} />
    );
  }
  // Specialised renderer (photos / videos / tour-dates / releases /
  // posts) — hand-tuned per-slug cards. Null when no specialisation is
  // registered, or when the artist's schema edits removed / retyped a
  // field the card requires.
  const specialised = specialisedRendererForDef(sourceDef);
  // A specialised slug whose cards fell back to the default render drops
  // the slug from its wrapper, so the default cards stack in normal flow
  // instead of sitting in that view's grid tracks (`globals.css`). An
  // itemTemplate isn't a fallback: it keeps the slug's layout.
  const fellBack =
    !sourceDef.itemTemplate && specialised === null && isSpecialisedViewSlug(sourceDef.slug);
  return (
    <div data-collection-view={fellBack ? undefined : sourceDef.slug}>
      {items.map((item) => (
        <CollectionBlockItem
          key={item.id}
          item={item}
          sourceDef={sourceDef}
          currentItem={currentItem}
          specialised={specialised}
        />
      ))}
    </div>
  );
}

function CollectionBlockItem({
  item,
  sourceDef,
  currentItem,
  specialised,
}: {
  item: Item;
  sourceDef: CollectionDef;
  currentItem: Item;
  specialised: SpecialisedRenderer | null;
}): ReactNode {
  const template = sourceDef.itemTemplate;
  if (template) {
    // The artist authored an explicit itemTemplate — always wins
    // over a specialised renderer. Recursive resolve: this item's
    // template, walked with `item = iteratedItem` but `currentItem`
    // carried through unchanged so §5.1's currentItemId /
    // currentItemField FilterValue arms still reference the
    // surrounding (outer) item.
    // No `collectionSlugs`: an itemTemplate can't embed Collection blocks.
    const resolved = resolveTemplate(template as Template, item, {
      currentItem,
      itemDef: sourceDef,
    });
    return <Render config={buildRenderConfig()} data={resolved} />;
  }
  if (specialised) {
    return specialised({ item, def: sourceDef });
  }
  // No itemTemplate, no specialisation — render a minimal default:
  // every scalar field rendered as plain text + image. Keeps the
  // block useful out of the box for arbitrary collections.
  return <DefaultItemRender item={item} sourceDef={sourceDef} />;
}

/**
 * Fallback "render every scalar field as plain text" when the
 * source collection has no itemTemplate configured and no specialised
 * renderer. (Detail pages without a `detailTemplate` use
 * `DefaultItemDetail` in `item-detail.tsx` instead.)
 */
function DefaultItemRender({
  item,
  sourceDef,
}: {
  item: Item;
  sourceDef: CollectionDef;
}): ReactNode {
  return (
    <article style={{ marginBottom: "var(--space-4)" }}>
      <DefaultItemFieldsList item={item} def={sourceDef} />
    </article>
  );
}

