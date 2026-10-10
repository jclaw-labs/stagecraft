/**
 * The one Puck config factory (#349).
 *
 * Every Puck surface builds its config here from the one block library
 * (`./config.tsx`):
 *
 *   - `render` — what `<Render>` uses on the public site, in the template
 *     editor's preview pane and inside Collection blocks. Every block plus
 *     one Collection block (`<Slug>View`) per `collectionSlugs` entry. The
 *     walker (`resolveTemplate`) has already resolved every binding, so
 *     blocks render their own `render` with plain props.
 *   - `editor`, by surface:
 *       - `page`   — the page editor: page root fields (title, splash,
 *                    footer, background), plain literal fields, and a
 *                    placeholder Collection block per embeddable collection.
 *       - `body`   — an item's own puckContent body: plain literal fields,
 *                    no Collection blocks (an item has nothing to embed).
 *       - `item-template` / `detail-template` — the template editor:
 *                    bindable props get a literal / "from field" picker
 *                    over the collection's fields, and the canvas shows a
 *                    bound prop as `{fieldKey}`. Detail templates also get
 *                    a Collection block per collection; item templates
 *                    can't (ADR §4.3 cycle safety).
 *
 * Client-safe: the editor surfaces run in `"use client"` editors and the
 * render surface on the server. Editor-only modules are imported here but
 * only called from the editor branches.
 */

import type { ComponentConfig, Config, Field } from "@puckeditor/core";

import { BindableImagePicker, BindableStringPicker } from "@/components/admin/BindablePicker";
import { buildCollectionBlockComponentConfig } from "@/components/admin/buildCollectionBlockComponentConfig";
import {
  BINDABLE_SLOTS,
  bindableFieldsByKind,
  type BindableSlotKind,
} from "@/lib/collections/template/bindable-slots";
import { isBindableRef, toBindableRef } from "@/lib/collections/template/binding";
import {
  blockNameForCollection,
  CollectionBlockRender,
} from "@/lib/collections/template/collection-block";
import type { Bindable, CollectionDef, FieldDef } from "@/lib/collections/schema";
import type { ImageMetadata } from "@/lib/image-types";

import { buildCollectionViewComponentConfig, type EmbeddableCollection } from "./collection-view-editor";
import { BLOCK_CATEGORIES, BLOCKS, PAGE_ROOT, type BlockLibraryConfig } from "./config";

export type BuildPuckConfigOptions =
  | {
      variant: "render";
      /** Collections whose Collection blocks the rendered tree may contain. */
      collectionSlugs?: ReadonlyArray<string>;
    }
  | {
      variant: "editor";
      surface: "page";
      /** Collections the artist can embed on a page. */
      collections: ReadonlyArray<EmbeddableCollection>;
    }
  | { variant: "editor"; surface: "body" }
  | {
      variant: "editor";
      surface: "item-template" | "detail-template";
      /** The collection whose template is being edited — bindings pick its fields. */
      def: CollectionDef;
      /** Detail templates: the collections offered as Collection blocks. */
      collectionDefs?: ReadonlyArray<CollectionDef>;
    };

type AnyComponent = ComponentConfig<Record<string, unknown>>;
type AnyField = Field<unknown>;

const renderConfigCache = new Map<string, Config>();

/**
 * Build the Puck config for one surface. Typed as the library's config so
 * `<Puck>` keeps inferring the page `Data` shape; the Collection blocks are
 * runtime-only entries (dynamic names TS can't know) that Puck handles
 * structurally.
 */
export function buildPuckConfig(options: BuildPuckConfigOptions): BlockLibraryConfig {
  if (options.variant === "render") return buildRenderConfig(options.collectionSlugs ?? []);

  const components: Record<string, AnyComponent> = {};
  const categories: Record<string, { title?: string; components?: string[] }> = {
    ...(BLOCK_CATEGORIES as Record<string, { title?: string; components?: string[] }>),
  };
  const bindTo = options.surface === "item-template" || options.surface === "detail-template"
    ? options.def
    : undefined;
  for (const [name, block] of Object.entries(BLOCKS as unknown as Record<string, AnyComponent>)) {
    components[name] = bindTo ? withBindablePickers(name, block, bindTo) : block;
  }

  const collectionBlocks: Record<string, AnyComponent> = {};
  if (options.surface === "page") {
    for (const { slug, label } of options.collections) {
      collectionBlocks[blockNameForCollection(slug)] = buildCollectionViewComponentConfig(
        slug,
        label,
      ) as unknown as AnyComponent;
    }
  } else if (options.surface === "detail-template") {
    for (const source of options.collectionDefs ?? []) {
      collectionBlocks[blockNameForCollection(source.slug)] = buildCollectionBlockComponentConfig(
        source,
        options.def,
      ) as AnyComponent;
    }
  }
  if (Object.keys(collectionBlocks).length > 0) {
    Object.assign(components, collectionBlocks);
    categories.collections = { title: "Collections", components: Object.keys(collectionBlocks) };
  }

  return {
    components,
    categories,
    root: options.surface === "page" ? PAGE_ROOT : { fields: {} },
  } as unknown as BlockLibraryConfig;
}

function buildRenderConfig(collectionSlugs: ReadonlyArray<string>): BlockLibraryConfig {
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
// Template surfaces: bindable props
// ---------------------------------------------------------------------------

/**
 * Give a block's bindable props a literal / "from field" picker, and make
 * its canvas render show a bound prop as `{fieldKey}` (the live value only
 * exists per item, in the preview pane).
 */
function withBindablePickers(name: string, block: AnyComponent, def: CollectionDef): AnyComponent {
  const slots = BINDABLE_SLOTS[name];
  if (!slots) return block;
  const fieldsByKind = bindableFieldsByKind(def);
  const fields: Record<string, AnyField> = { ...(block.fields as Record<string, AnyField>) };
  for (const [propName, meta] of Object.entries(slots)) {
    fields[propName] = bindablePickerField(meta.slotKind, fieldsByKind[meta.slotKind], meta.description);
  }
  const render = block.render;
  return {
    ...block,
    fields: fields as AnyComponent["fields"],
    render: (props) => {
      const shown: Record<string, unknown> = { ...props };
      for (const [propName, meta] of Object.entries(slots)) {
        shown[propName] = canvasValue(props[propName], meta.slotKind, def.fields);
      }
      return render(shown as typeof props);
    },
  };
}

function bindablePickerField(
  kind: BindableSlotKind,
  candidates: ReadonlyArray<FieldDef>,
  description: string | undefined,
): AnyField {
  if (kind === "image") {
    return {
      type: "custom",
      label: description,
      render: ({ value, onChange }) => (
        <BindableImagePicker
          value={toBindableRef((value as Bindable<ImageMetadata | null> | undefined) ?? null)}
          onChange={onChange}
          imageFields={candidates}
        />
      ),
    } as AnyField;
  }
  return {
    type: "custom",
    label: description,
    render: ({ value, onChange }) => (
      <BindableStringPicker
        value={toBindableRef((value as Bindable<string> | undefined) ?? "")}
        onChange={onChange}
        stringFields={candidates}
        isMultiline={kind === "richText"}
      />
    ),
  } as AnyField;
}

/**
 * What the template canvas shows for a bindable prop: a literal as itself,
 * a binding as `{fieldKey}` (an image binding as the empty-image
 * placeholder).
 */
function canvasValue(value: unknown, kind: BindableSlotKind, fields: ReadonlyArray<FieldDef>): unknown {
  if (!isBindableRef(value)) return value;
  if (value.kind === "literal") return value.value;
  if (kind === "image") return null;
  const field = fields.find((f) => f.id === value.fieldId);
  return field ? `{${field.key}}` : "{ ??? }";
}

