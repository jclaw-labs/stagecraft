/**
 * Page-editor config for the generic Collection block (ADR-015 step 5).
 *
 * The public render path (`buildUnifiedPublicConfig`) walks the page and hands
 * `<Render>` *resolved* items; the editor never resolves collection data (the
 * live items only exist server-side at request time). So the editor needs its
 * own ComponentConfig per collection: a `limit` control + a read-only note
 * naming the source, an editor placeholder for the canvas, and `defaultProps`
 * (source + sort + filter) shared with the seeds via `collectionViewProps` so a
 * freshly dragged-in block matches the seeded one.
 *
 * `buildUnifiedEditorConfig` layers these over `puckConfig`'s chrome blocks +
 * root fields — replacing the bespoke `TourDatesView` / `ReleasesView` /
 * `PostsView` and registering every other embeddable collection — which is what
 * lets the editor drop the bespoke `*View` blocks (PR-6) and makes *any*
 * collection embeddable on a page (ADR-015's headline outcome).
 *
 * Client-safe (no node / server imports): it's imported by the `"use client"`
 * page editor. `blockNameForCollection` is a pure slug→name transform;
 * `collection-view-props` imports only the node-free field-id constants.
 */

"use client";

import type { ComponentConfig } from "@measured/puck";
import type { CSSProperties } from "react";

import {
  collectionViewProps,
  defaultCollectionViewLimit,
} from "@/lib/collections/collection-view-props";
import { blockNameForCollection } from "@/lib/collections/template/collection-block";

import { puckConfig } from "./config";

export type EmbeddableCollection = {
  /** Collection slug (e.g. `tour-dates`). */
  slug: string;
  /** Plural display name (e.g. `Tour dates`) for the field note + placeholder. */
  label: string;
};

type CollectionViewEditorProps = {
  sourceCollection: string;
  limit: number;
};

const placeholderBoxStyle: CSSProperties = {
  padding: "var(--space-6)",
  border: "1px dashed var(--color-border)",
  borderRadius: "var(--radius)",
  color: "var(--color-text-muted)",
  textAlign: "center",
  fontSize: "var(--font-size-sm)",
};

const noteStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
};

/**
 * Editor stand-in for a Collection block. The live items only resolve on the
 * published page (the server-side walker), so in the Puck canvas the block
 * shows a dashed placeholder naming its source — the same affordance the
 * bespoke `TourDatesPlaceholder` / `ReleasesPlaceholder` / `PostsPlaceholder`
 * gave.
 */
function CollectionViewEditorPlaceholder({ label }: { label: string }) {
  return (
    <div style={placeholderBoxStyle}>
      Your {label.toLowerCase()} appear here — edit them in the {label} panel.
      They show on the published page.
    </div>
  );
}

/**
 * Build one collection's page-editor ComponentConfig. `sourceCollection` rides
 * along as a (read-only) field so it persists through saves but isn't artist-
 * editable — the source is fixed per block (ADR-009 §5); `sort` / `filter` live
 * in `defaultProps` and are likewise preserved by Puck without an explicit
 * control. The block name (`<Slug>View`) is the dispatch key, so existing page
 * JSON keyed on the bespoke names maps straight onto this config.
 */
export function buildCollectionViewComponentConfig(
  slug: string,
  label: string,
): ComponentConfig<CollectionViewEditorProps> {
  return {
    fields: {
      limit: { type: "number", label: "Max items", min: 1 },
      sourceCollection: {
        type: "custom",
        label: "Source",
        render: () => (
          <p style={noteStyle}>
            Pulled live from your {label} — add or edit items in that panel.
          </p>
        ),
      },
    },
    // collectionViewProps returns source + sort + filter; Puck preserves the
    // undeclared sort / filter keys. Cast: the resolved shape carries more than
    // the two typed/edited fields.
    defaultProps: collectionViewProps(
      slug,
      defaultCollectionViewLimit(slug),
    ) as unknown as CollectionViewEditorProps,
    render: () => <CollectionViewEditorPlaceholder label={label} />,
  };
}

/**
 * The page editor's unified config: `puckConfig` chrome + root fields, with the
 * collection blocks swapped for the generic authoring config above. Mirrors
 * `buildUnifiedPublicConfig`, but carries authoring fields + an editor
 * placeholder instead of the resolved-data render. The `collections` drawer
 * category is rebuilt to list every embeddable collection so artist-created
 * collections (beyond the three demos) appear in it.
 */
export function buildUnifiedEditorConfig(
  collections: ReadonlyArray<EmbeddableCollection>,
): typeof puckConfig {
  const components: Record<string, unknown> = { ...puckConfig.components };
  const collectionBlockNames: string[] = [];
  for (const { slug, label } of collections) {
    const name = blockNameForCollection(slug);
    components[name] = buildCollectionViewComponentConfig(slug, label);
    collectionBlockNames.push(name);
  }
  const categories = {
    ...(puckConfig.categories ?? {}),
    collections: { title: "Collections", components: collectionBlockNames },
  };
  // Cast back to the bespoke config's precise type so `<Puck>` keeps inferring
  // the `PageData` shape for `data` / `onPublish`. The added generic Collection
  // blocks are runtime-only entries (dynamic keys TS can't know) that Puck
  // handles structurally.
  return { ...puckConfig, components, categories } as unknown as typeof puckConfig;
}
