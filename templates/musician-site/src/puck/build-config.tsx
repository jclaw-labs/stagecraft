/**
 * The Puck config factory for the editor surfaces (#349).
 *
 * Every editor surface builds its config here from the one block library
 * (`./config.tsx`):
 *
 *   - `page`   — the page editor: page root fields (title, splash,
 *                footer, background), plain literal fields, and a
 *                placeholder Collection block per embeddable collection.
 *   - `body`   — an item's own puckContent body: plain literal fields,
 *                no Collection blocks (an item has nothing to embed).
 *   - `item-template` / `detail-template` — the template editor:
 *                bindable props get a literal / "from field" picker
 *                over the collection's fields, and the canvas shows a
 *                bound prop as `{fieldKey}`. Detail templates also get
 *                a Collection block per collection; item templates
 *                can't (ADR §4.3 cycle safety).
 *
 * Some blocks don't belong on every surface (`HIDDEN_BLOCKS`): a form or a
 * fullscreen hero inside an item template would repeat once per item in
 * every Collection block. Those stay registered, so a tree that already
 * holds one still loads and renders, but the drawer doesn't offer them.
 *
 * The render config (`<Render>` on the public site, the preview pane and
 * inside Collection blocks) is `./render-config.tsx`. It doesn't import
 * this module, so the pickers and inspectors here stay off the server
 * render path.
 */

import type { ComponentConfig, Field } from "@puckeditor/core";

import { BindableImagePicker, BindableStringPicker } from "@/components/admin/BindablePicker";
import { buildCollectionBlockComponentConfig } from "@/components/admin/buildCollectionBlockComponentConfig";
import {
  BINDABLE_SLOTS,
  bindableFieldsByKind,
  type BindableSlotKind,
} from "@/lib/collections/template/bindable-slots";
import { isBindableRef, toBindableRef } from "@/lib/collections/template/binding";
import { blockNameForCollection } from "@/lib/collections/template/collection-block";
import type { Bindable, CollectionDef, FieldDef } from "@/lib/collections/schema";
import type { ImageMetadata } from "@/lib/image-types";

import { buildCollectionViewComponentConfig, type EmbeddableCollection } from "./collection-view-editor";
import {
  BLOCK_CATEGORIES,
  BLOCKS,
  PAGE_ROOT,
  type BlockLibraryConfig,
  type BlockName,
} from "./config";

export type BuildPuckConfigOptions =
  | {
      surface: "page";
      /** Collections the artist can embed on a page. */
      collections: ReadonlyArray<EmbeddableCollection>;
    }
  | { surface: "body" }
  | {
      surface: "item-template" | "detail-template";
      /** The collection whose template is being edited — bindings pick its fields. */
      def: CollectionDef;
      /** Detail templates: the collections offered as Collection blocks. */
      collectionDefs?: ReadonlyArray<CollectionDef>;
    };

export type EditorSurface = BuildPuckConfigOptions["surface"];

type AnyComponent = ComponentConfig<Record<string, unknown>>;
type AnyField = Field<unknown>;
type Category = { title?: string; components?: string[]; visible?: boolean };

const FORM_BLOCKS: ReadonlyArray<BlockName> = ["ContactForm", "NewsletterSignup"];

/**
 * Blocks the drawer leaves out per surface. An item template renders once
 * per item in every Collection block, so a form or a fullscreen hero there
 * would repeat down the list. Item bodies hide the forms too: a contact or
 * newsletter form belongs on a page, not inside one post.
 */
const HIDDEN_BLOCKS: Readonly<Record<EditorSurface, ReadonlyArray<BlockName>>> = {
  page: [],
  "detail-template": [],
  body: FORM_BLOCKS,
  "item-template": [...FORM_BLOCKS, "FullscreenSection"],
};

/**
 * Build the Puck config for one editor surface. Typed as the library's
 * config so `<Puck>` keeps inferring the page `Data` shape; the Collection
 * blocks are runtime-only entries (dynamic names TS can't know) that Puck
 * handles structurally.
 */
export function buildPuckConfig(options: BuildPuckConfigOptions): BlockLibraryConfig {
  const components: Record<string, AnyComponent> = {};
  const categories = drawerCategories(HIDDEN_BLOCKS[options.surface]);
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

/**
 * The library's drawer categories with `hidden` moved into a category Puck
 * doesn't show. Hidden blocks need a category of their own: a block in no
 * category would land in Puck's visible "Other" group.
 */
function drawerCategories(hidden: ReadonlyArray<BlockName>): Record<string, Category> {
  const library = BLOCK_CATEGORIES as Record<string, Category>;
  if (hidden.length === 0) return { ...library };
  const isHidden = (name: string) => (hidden as ReadonlyArray<string>).includes(name);
  const categories: Record<string, Category> = {};
  for (const [key, category] of Object.entries(library)) {
    const shown = (category.components ?? []).filter((name) => !isHidden(name));
    if (shown.length > 0) categories[key] = { ...category, components: shown };
  }
  categories.hidden = { components: [...hidden], visible: false };
  return categories;
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

