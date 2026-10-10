/**
 * One-shot content migration for the merged block library (#349).
 *
 * The page blocks and the template primitives used to be two libraries with
 * clashing names. They're one library now, and it kept the page blocks'
 * vocabulary, so the only content that changes is what the old template
 * primitives wrote — template layouts (`itemTemplate` / `detailTemplate` /
 * `listTemplate`) and item bodies authored in the old body editor:
 *
 *   - `Section { width: narrow | default | wide, padding }`
 *       → `Section { width: sm | md | lg }`. `padding` is dropped: a Section's
 *         padding follows the theme's density (`--section-space`), the same
 *         as on pages.
 *   - `Button { label }` → `Button { text }`
 *   - `Image { src }`    → `Image { image }`
 *   - `RichTextRender { field }` → `RichText { text: <binding to field> }`
 *
 * Page bodies and first-run seeds only ever held the page vocabulary, so the
 * migration leaves them untouched (returns the same objects). Every rule
 * keys off the old vocabulary's own props, so it's safe to run on any tree
 * and safe to run twice.
 *
 * Pure and free of runtime imports so `scripts/migrate-block-library.mjs`
 * can load it straight from Node (type stripping).
 */

import type { CollectionDef, FieldValue } from "./schema";

type BlockLike = { type: string; props?: Record<string, unknown> };

const SECTION_WIDTH: Readonly<Record<string, string>> = {
  narrow: "sm",
  default: "md",
  wide: "lg",
};

function isBlock(value: unknown): value is BlockLike {
  return (
    !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
  );
}

/** Migrate one block's own props (not its children). */
function migrateOwnProps(block: BlockLike): BlockLike {
  const props = block.props;
  if (!props || typeof props !== "object") return block;
  switch (block.type) {
    case "Section": {
      const width = typeof props.width === "string" ? SECTION_WIDTH[props.width] : undefined;
      if (width === undefined && !("padding" in props)) return block;
      const next = { ...props };
      delete next.padding;
      if (width !== undefined) next.width = width;
      return { ...block, props: next };
    }
    case "Button": {
      if (!("label" in props) || "text" in props) return block;
      const { label, ...rest } = props;
      return { ...block, props: { ...rest, text: label } };
    }
    case "Image": {
      if (!("src" in props) || "image" in props) return block;
      const { src, ...rest } = props;
      return { ...block, props: { ...rest, image: src } };
    }
    case "RichTextRender": {
      const { field, ...rest } = props;
      return {
        type: "RichText",
        props: {
          ...rest,
          text: { kind: "binding", fieldId: typeof field === "string" ? field : "" },
          align: "start",
        },
      };
    }
    default:
      return block;
  }
}

/**
 * Migrate a list of blocks, recursing into every array of nested blocks
 * (Section.children, Columns.col1, …). Returns the same array when nothing
 * changed.
 */
export function migrateBlocks(blocks: ReadonlyArray<unknown>): unknown[] {
  let changed = false;
  const out = blocks.map((value) => {
    if (!isBlock(value)) return value;
    let block = migrateOwnProps(value);
    const props = block.props;
    if (props && typeof props === "object") {
      let nextProps: Record<string, unknown> | undefined;
      for (const [key, child] of Object.entries(props)) {
        if (!Array.isArray(child)) continue;
        const migrated = migrateBlocks(child);
        if (migrated !== child) (nextProps ??= { ...props })[key] = migrated;
      }
      if (nextProps) block = { ...block, props: nextProps };
    }
    if (block !== value) changed = true;
    return block;
  });
  return changed ? out : (blocks as unknown[]);
}

/** Migrate a Puck data tree (`{ content, root }`). Same object when unchanged. */
export function migratePuckData<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content)) return data;
  const migrated = migrateBlocks(content);
  return migrated === content ? data : { ...data, content: migrated };
}

const TEMPLATE_KEYS = ["itemTemplate", "detailTemplate", "listTemplate"] as const;

/** Migrate a collection def's three template slots. Same object when unchanged. */
export function migrateCollectionDef<T extends Pick<CollectionDef, (typeof TEMPLATE_KEYS)[number]>>(
  def: T,
): T {
  let next: T | undefined;
  for (const key of TEMPLATE_KEYS) {
    const template = def[key];
    const migrated = migratePuckData(template);
    if (migrated !== template) (next ??= { ...def })[key] = migrated;
  }
  return next ?? def;
}

/** Migrate every puckContent value in an item's values map. Same object when unchanged. */
export function migrateItemValues<T extends Record<string, FieldValue>>(values: T): T {
  let next: Record<string, FieldValue> | undefined;
  for (const [fieldId, value] of Object.entries(values)) {
    if (value?.type !== "puckContent") continue;
    const migrated = migratePuckData(value.value);
    if (migrated !== value.value) (next ??= { ...values })[fieldId] = { ...value, value: migrated };
  }
  return (next as T | undefined) ?? values;
}
