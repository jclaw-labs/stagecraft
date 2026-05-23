/**
 * The Primitive block library.
 *
 * Each export pairs:
 *
 *   - A `resolve*Props` function that takes the on-disk prop shape
 *     (with `Bindable<T>` fields) and an item, and returns a flat
 *     resolved-props object. The function is given a `recurse` callback
 *     for slot fields so nested blocks resolve top-down.
 *
 *   - A pure React component that takes the resolved props and renders.
 *     Components don't know about Bindables — by the time they run,
 *     every prop is its final value.
 *
 * The `<TemplateRenderer>` walks a template once (top-down), calls the
 * appropriate `resolve*Props` on each block, builds a new Puck data tree
 * with literal values everywhere, and hands it to Puck's `<Render>`.
 * Puck then renders each block by calling its component with the
 * resolved props — and natively handles slot fields by wrapping the
 * slot content into a `SlotComponent` that the component calls.
 *
 * Implicit hide-if-empty (ADR §4.1): a `Bindable` prop that resolves
 * to `undefined` causes the surrounding block to render nothing. The
 * components apply this rule per-prop.
 */

import type { ReactNode } from "react";
import type { SlotComponent } from "@measured/puck";

import { Image as PublicImage } from "@/components/Image";
import type { ImageMetadata } from "@/lib/image-types";

import {
  resolveBindable,
  resolveBinding,
  resolveStringBindable,
} from "./binding";
import { renderTiptap } from "./tiptap-render";
import type { BlockInstance } from "./types";
import type { Bindable, CollectionDef, FieldId, Item, TiptapJSON } from "../schema";

// ---------------------------------------------------------------------------
// Block-registry types
// ---------------------------------------------------------------------------

/**
 * Context passed to every `resolve*Props` function during walk. The
 * `recurse` callback resolves a nested block — used by layout
 * primitives whose `children` slot stores `BlockInstance[]` inline on
 * the parent's props.
 *
 * `item` is the item the binding-resolution closure targets — changes
 * as nested templates iterate (a Collection block resolves its
 * children against each iterated item). `currentItem` is the item
 * the *surrounding* template is rendering — stays the same all the
 * way down so Collection-block filters can reference it (ADR §5.1's
 * `currentItemId` / `currentItemField` FilterValue arms).
 *
 * For non-Collection-block walks the two are equal. The distinction
 * only matters once a Collection block iterates; PR 7b's render
 * passes the outer `currentItem` through unchanged.
 */
export type ResolveContext = {
  item: Item;
  currentItem: Item;
  /**
   * Pre-loaded items + defs for any Collection blocks the template
   * embeds. Keyed by collection slug. Empty for primitive-only
   * templates; the renderer fills this only when the template
   * references Collection blocks.
   */
  loadedCollections: Readonly<
    Record<string, { def: CollectionDef; items: ReadonlyArray<Item> }>
  >;
  recurse: (block: BlockInstance) => BlockInstance;
};

/**
 * One registry entry.
 *
 * Three type parameters reflect the three shapes a block's props take
 * over the pipeline:
 *
 *   RawProps    — what's stored on disk (Bindable<T> fields, slots
 *                 stored inline as BlockInstance[]).
 *   DataProps   — what `resolveProps` returns (literal values,
 *                 BlockInstance[] still inline). This is what
 *                 `<TemplateRenderer>` hands to Puck's `<Render>`.
 *   RenderProps — what `Component` receives. Same as `DataProps`
 *                 except slot fields have been wrapped by Puck into
 *                 `SlotComponent` functions.
 *
 * For blocks without slot fields, DataProps and RenderProps are the
 * same. For Section / Stack they differ at the `children` field.
 */
export type BlockEntry<
  RawProps extends object = object,
  DataProps extends object = object,
  RenderProps extends object = DataProps,
> = {
  /** Pure React component. Sees `RenderProps` (slots wrapped). */
  Component: (props: RenderProps) => ReactNode;
  /** Walks raw props and produces resolved data for Puck Render. */
  resolveProps: (rawProps: RawProps, ctx: ResolveContext) => DataProps;
  /**
   * Puck `fields` config — what the editor (PR 6) shows when this
   * block is selected. For PR 2 we only need slot fields declared so
   * Puck's `<Render>` wraps them in `SlotComponent`. PR 6 fills in
   * the rest (binding-aware custom fields).
   */
  fields: Record<string, { type: string; [k: string]: unknown }>;
};

/**
 * The default block registry — what `<TemplateRenderer>` uses unless a
 * caller supplies an extended one (e.g. PR 7's Collection blocks).
 *
 * Built declaratively and frozen so it can't be mutated at runtime.
 */
export const PRIMITIVE_BLOCKS: Readonly<Record<string, BlockEntry>> = Object.freeze({
  Section: makeEntry<SectionRawProps, SectionDataProps, SectionRenderProps>({
    Component: Section,
    resolveProps: resolveSectionProps,
    fields: {
      width: { type: "select" },
      padding: { type: "select" },
      children: { type: "slot" },
    },
  }),
  Stack: makeEntry<StackRawProps, StackDataProps, StackRenderProps>({
    Component: Stack,
    resolveProps: resolveStackProps,
    fields: {
      direction: { type: "select" },
      gap: { type: "select" },
      align: { type: "select" },
      justify: { type: "select" },
      children: { type: "slot" },
    },
  }),
  Text: makeEntry<TextRawProps, TextProps>({
    Component: Text,
    resolveProps: resolveTextProps,
    fields: { content: { type: "text" }, variant: { type: "select" }, align: { type: "select" } },
  }),
  Image: makeEntry<ImageRawProps, ImageProps>({
    Component: ImageBlock,
    resolveProps: resolveImageProps,
    fields: { src: { type: "custom" }, altOverride: { type: "text" } },
  }),
  Button: makeEntry<ButtonRawProps, ButtonProps>({
    Component: Button,
    resolveProps: resolveButtonProps,
    fields: { label: { type: "text" }, href: { type: "text" }, variant: { type: "select" } },
  }),
  Link: makeEntry<LinkRawProps, LinkProps>({
    Component: Link,
    resolveProps: resolveLinkProps,
    fields: { label: { type: "text" }, href: { type: "text" } },
  }),
  RichTextRender: makeEntry<RichTextRenderRawProps, RichTextRenderProps>({
    Component: RichTextRender,
    resolveProps: resolveRichTextRenderProps,
    fields: { field: { type: "select" } },
  }),
});

/**
 * Identity helper that exists only to bind the per-entry generics
 * without forcing the registry literal to spell them out everywhere.
 */
function makeEntry<
  RawProps extends object,
  DataProps extends object,
  RenderProps extends object = DataProps,
>(
  entry: BlockEntry<RawProps, DataProps, RenderProps>,
): BlockEntry {
  return entry as unknown as BlockEntry;
}

// ---------------------------------------------------------------------------
// Section — layout wrapper with width + padding
// ---------------------------------------------------------------------------

export const SECTION_WIDTHS = ["narrow", "default", "wide", "full"] as const;
export type SectionWidth = (typeof SECTION_WIDTHS)[number];

export const SECTION_PADDINGS = ["none", "default", "large"] as const;
export type SectionPadding = (typeof SECTION_PADDINGS)[number];

const SECTION_MAX_WIDTH: Record<SectionWidth, string> = {
  narrow: "var(--max-width-narrow)",
  default: "var(--max-width-content)",
  wide: "var(--max-width-wide)",
  full: "100%",
};

const SECTION_PADDING_VALUE: Record<SectionPadding, string> = {
  none: "0",
  default: "var(--space-8) var(--space-4)",
  large: "var(--space-16) var(--space-4)",
};

type SectionRawProps = {
  width?: SectionWidth;
  padding?: SectionPadding;
  children?: BlockInstance[];
};
/** Walker output: `children` is still the inline BlockInstance[]. */
type SectionDataProps = {
  width: SectionWidth;
  padding: SectionPadding;
  children: BlockInstance[];
};
/** Component input: Puck has wrapped `children` into a SlotComponent. */
type SectionRenderProps = {
  width: SectionWidth;
  padding: SectionPadding;
  children: SlotComponent;
};

function resolveSectionProps(raw: SectionRawProps, ctx: ResolveContext): SectionDataProps {
  return {
    width: raw.width ?? "default",
    padding: raw.padding ?? "default",
    children: Array.isArray(raw.children) ? raw.children.map(ctx.recurse) : [],
  };
}

function Section({ width, padding, children: Children }: SectionRenderProps): ReactNode {
  return (
    <section
      style={{
        maxWidth: SECTION_MAX_WIDTH[width],
        margin: "0 auto",
        padding: SECTION_PADDING_VALUE[padding],
      }}
    >
      <Children />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stack — flex container, vertical or horizontal
// ---------------------------------------------------------------------------

export const STACK_DIRECTIONS = ["vertical", "horizontal"] as const;
export type StackDirection = (typeof STACK_DIRECTIONS)[number];

export const STACK_GAPS = ["none", "small", "default", "large"] as const;
export type StackGap = (typeof STACK_GAPS)[number];

export const STACK_ALIGNMENTS = ["start", "center", "end", "stretch"] as const;
export type StackAlignment = (typeof STACK_ALIGNMENTS)[number];

export const STACK_JUSTIFICATIONS = ["start", "center", "end", "between"] as const;
export type StackJustification = (typeof STACK_JUSTIFICATIONS)[number];

const STACK_GAP_VALUE: Record<StackGap, string> = {
  none: "0",
  small: "var(--space-2)",
  default: "var(--space-4)",
  large: "var(--space-8)",
};

const STACK_ALIGN_VALUE: Record<StackAlignment, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};

const STACK_JUSTIFY_VALUE: Record<StackJustification, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
};

type StackRawProps = {
  direction?: StackDirection;
  gap?: StackGap;
  align?: StackAlignment;
  justify?: StackJustification;
  children?: BlockInstance[];
};
type StackDataProps = {
  direction: StackDirection;
  gap: StackGap;
  align: StackAlignment;
  justify: StackJustification;
  children: BlockInstance[];
};
type StackRenderProps = {
  direction: StackDirection;
  gap: StackGap;
  align: StackAlignment;
  justify: StackJustification;
  children: SlotComponent;
};

function resolveStackProps(raw: StackRawProps, ctx: ResolveContext): StackDataProps {
  return {
    direction: raw.direction ?? "vertical",
    gap: raw.gap ?? "default",
    align: raw.align ?? "stretch",
    justify: raw.justify ?? "start",
    children: Array.isArray(raw.children) ? raw.children.map(ctx.recurse) : [],
  };
}

function Stack({ direction, gap, align, justify, children: Children }: StackRenderProps): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction === "vertical" ? "column" : "row",
        gap: STACK_GAP_VALUE[gap],
        alignItems: STACK_ALIGN_VALUE[align],
        justifyContent: STACK_JUSTIFY_VALUE[justify],
      }}
    >
      <Children />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text — single text block, bindable content
// ---------------------------------------------------------------------------

export const TEXT_VARIANTS = ["body", "small", "lead", "label"] as const;
export type TextVariant = (typeof TEXT_VARIANTS)[number];

export const TEXT_ALIGNS = ["start", "center", "end"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

const TEXT_VARIANT_STYLE: Record<TextVariant, React.CSSProperties> = {
  body: { fontSize: "var(--font-size-base)" },
  small: { fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" },
  lead: { fontSize: "var(--font-size-lg)" },
  label: {
    fontSize: "var(--font-size-xs)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--color-text-muted)",
  },
};

type TextRawProps = {
  content: Bindable<string>;
  variant?: TextVariant;
  align?: TextAlign;
};
type TextProps = {
  content: string | undefined;
  variant: TextVariant;
  align: TextAlign;
};

function resolveTextProps(raw: TextRawProps, ctx: ResolveContext): TextProps {
  return {
    content: resolveStringBindable(raw.content, ctx.item),
    variant: raw.variant ?? "body",
    align: raw.align ?? "start",
  };
}

function Text({ content, variant, align }: TextProps): ReactNode {
  if (content === undefined || content === "") return null;
  return (
    <p style={{ ...TEXT_VARIANT_STYLE[variant], textAlign: align, margin: 0 }}>{content}</p>
  );
}

// ---------------------------------------------------------------------------
// Image — image with optional alt override
// ---------------------------------------------------------------------------

type ImageRawProps = {
  src: Bindable<ImageMetadata>;
  altOverride?: Bindable<string>;
};
type ImageProps = {
  src: ImageMetadata | undefined;
  altOverride: string | undefined;
};

function resolveImageProps(raw: ImageRawProps, ctx: ResolveContext): ImageProps {
  return {
    src: resolveBindable(raw.src, ctx.item, "image"),
    altOverride: raw.altOverride ? resolveStringBindable(raw.altOverride, ctx.item) : undefined,
  };
}

function ImageBlock({ src, altOverride }: ImageProps): ReactNode {
  if (src === undefined) return null;
  // altOverride wins when set and non-empty; otherwise fall back to the
  // image's stored alt. The stored alt is required at upload time so
  // there's always a value here.
  const image =
    altOverride !== undefined && altOverride !== "" ? { ...src, alt: altOverride } : src;
  return <PublicImage image={image} />;
}

// ---------------------------------------------------------------------------
// Button — bindable label and href
// ---------------------------------------------------------------------------

export const BUTTON_VARIANTS = ["primary", "secondary", "outline"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

const BUTTON_VARIANT_STYLE: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: "var(--color-action)",
    color: "var(--color-action-fg)",
    border: "1px solid var(--color-action)",
  },
  secondary: {
    background: "var(--color-surface-raised)",
    color: "var(--color-text)",
    border: "1px solid var(--color-surface-raised)",
  },
  outline: {
    background: "transparent",
    color: "var(--color-text)",
    border: "1px solid var(--color-text)",
  },
};

const BUTTON_BASE_STYLE: React.CSSProperties = {
  display: "inline-block",
  padding: "var(--space-2) var(--space-4)",
  borderRadius: "var(--radius)",
  textDecoration: "none",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

type ButtonRawProps = {
  label: Bindable<string>;
  href: Bindable<string>;
  variant?: ButtonVariant;
};
type ButtonProps = {
  label: string | undefined;
  href: string | undefined;
  variant: ButtonVariant;
};

function resolveButtonProps(raw: ButtonRawProps, ctx: ResolveContext): ButtonProps {
  return {
    label: resolveStringBindable(raw.label, ctx.item),
    href: resolveStringBindable(raw.href, ctx.item),
    variant: raw.variant ?? "primary",
  };
}

function Button({ label, href, variant }: ButtonProps): ReactNode {
  if (label === undefined || label === "" || href === undefined || href === "") return null;
  return (
    <a href={href} style={{ ...BUTTON_BASE_STYLE, ...BUTTON_VARIANT_STYLE[variant] }}>
      {label}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Link — plain inline link
// ---------------------------------------------------------------------------

type LinkRawProps = {
  label: Bindable<string>;
  href: Bindable<string>;
};
type LinkProps = {
  label: string | undefined;
  href: string | undefined;
};

function resolveLinkProps(raw: LinkRawProps, ctx: ResolveContext): LinkProps {
  return {
    label: resolveStringBindable(raw.label, ctx.item),
    href: resolveStringBindable(raw.href, ctx.item),
  };
}

function Link({ label, href }: LinkProps): ReactNode {
  if (label === undefined || label === "" || href === undefined || href === "") return null;
  return <a href={href}>{label}</a>;
}

// ---------------------------------------------------------------------------
// RichTextRender — render a richText field's Tiptap doc at this position
// ---------------------------------------------------------------------------

type RichTextRenderRawProps = {
  /** Field id pointing at a richText field on the current collection. */
  field: FieldId;
};
type RichTextRenderProps = {
  doc: TiptapJSON | undefined;
};

function resolveRichTextRenderProps(
  raw: RichTextRenderRawProps,
  ctx: ResolveContext,
): RichTextRenderProps {
  return { doc: resolveBinding(raw.field, ctx.item, "richText") };
}

function RichTextRender({ doc }: RichTextRenderProps): ReactNode {
  if (doc === undefined) return null;
  return renderTiptap(doc);
}
