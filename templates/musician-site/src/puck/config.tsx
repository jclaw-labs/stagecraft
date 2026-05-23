import type { Config, Slot } from "@measured/puck";
import type { CSSProperties, ReactElement, ReactNode } from "react";

import { ContactForm } from "@/components/ContactForm";
import { ImageCarousel } from "@/components/ImageCarousel";
import {
  CAROUSEL_ASPECT_RATIOS,
  CAROUSEL_ASPECT_RATIO_LABELS,
  type CarouselAspectRatio,
} from "@/components/image-carousel-types";
import { Image as PublicImage } from "@/components/Image";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import {
  NEWSLETTER_SERVICES,
  NEWSLETTER_SERVICE_LABELS,
  parseMailchimpAudienceHoneypotName,
  type NewsletterService,
} from "@/components/newsletter-types";
import { extractIframeIntrinsicDimensions, stripIframeDimensions } from "@/lib/iframe-utils";
import type { ImageMetadata } from "@/lib/image-types";

import { ImagePickerField } from "./ImagePickerField";

export const HEADING_LEVELS = ["h1", "h2", "h3"] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export const SECTION_WIDTHS = ["sm", "md", "lg", "full"] as const;
export type SectionWidth = (typeof SECTION_WIDTHS)[number];

export const BUTTON_VARIANTS = ["primary", "secondary", "outline"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const SPACER_SIZES = ["sm", "md", "lg", "xl"] as const;
export type SpacerSize = (typeof SPACER_SIZES)[number];

export const COLUMN_LAYOUTS = ["1-1", "1-2", "2-1", "1-1-1"] as const;
export type ColumnLayout = (typeof COLUMN_LAYOUTS)[number];

export const COLUMN_LAYOUT_LABELS: Record<ColumnLayout, string> = {
  "1-1": "Equal (1:1)",
  "1-2": "Narrow + Wide (1:2)",
  "2-1": "Wide + Narrow (2:1)",
  "1-1-1": "Three equal (1:1:1)",
};

export const TEXT_ALIGNMENTS = ["start", "center", "end"] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

export const TEXT_ALIGNMENT_LABELS: Record<TextAlignment, string> = {
  start: "Start (default)",
  center: "Center",
  end: "End",
};

// CenteredBlock max-width presets. `narrow` is intro-paragraph /
// CTA scale (matches the body-text token); `regular` is full
// reading-column scale. Legacy template's `60ch` and
// `var(--max-text)` map onto the new template's existing
// `--max-width-narrow` / `--max-width-content` tokens.
export const CENTERED_BLOCK_MAX_WIDTHS = ["narrow", "regular"] as const;
export type CenteredBlockMaxWidth = (typeof CENTERED_BLOCK_MAX_WIDTHS)[number];

export const CENTERED_BLOCK_MAX_WIDTH_LABELS: Record<CenteredBlockMaxWidth, string> = {
  narrow: "Narrow (intro / CTA)",
  regular: "Regular (reading column)",
};

const CENTERED_BLOCK_MAX_WIDTH_TOKEN: Record<CenteredBlockMaxWidth, string> = {
  narrow: "var(--max-width-narrow)",
  regular: "var(--max-width-content)",
};

// EmbedResponsive aspect-ratio presets. `auto` derives from the
// iframe's intrinsic dimensions (Bandcamp's 350x470 → "350/470");
// explicit ratios let the artist override (a YouTube embed pasted
// at 560x315 looks better re-shaped to "16/9").
export const EMBED_ASPECT_RATIOS = ["auto", "16/9", "4/3", "1/1"] as const;
export type EmbedAspectRatio = (typeof EMBED_ASPECT_RATIOS)[number];

export const EMBED_ASPECT_RATIO_LABELS: Record<EmbedAspectRatio, string> = {
  auto: "Auto (from iframe size)",
  "16/9": "Widescreen (16:9)",
  "4/3": "Standard (4:3)",
  "1/1": "Square (1:1)",
};

// Card orientation — vertical (image on top, text below) for grids;
// horizontal (image on side) for list layouts. The legacy template
// also supports "icon" / variant / size axes; this template ships
// with orientation + variant — artists who want even richer
// compositions drop multiple Cards in a Columns block.
export const CARD_ORIENTATIONS = ["vertical", "horizontal"] as const;
export type CardOrientation = (typeof CARD_ORIENTATIONS)[number];

export const CARD_ORIENTATION_LABELS: Record<CardOrientation, string> = {
  vertical: "Vertical (image on top)",
  horizontal: "Horizontal (image on side)",
};

// Card visual variant — `filled` has the surface background +
// border (the v1 default); `outlined` drops the background for a
// lighter touch (useful on busy page backgrounds where the white
// surface fights with the imagery); `minimal` drops all chrome —
// no border, no background, no padding — so the card reads as a
// flush list-item (media + text with only the size gap between
// them).
export const CARD_VARIANTS = ["filled", "outlined", "minimal"] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];

export const CARD_VARIANT_LABELS: Record<CardVariant, string> = {
  filled: "Filled (default surface)",
  outlined: "Outlined (transparent background)",
  minimal: "Minimal (no border or padding)",
};

// Card size axis — scales the internal gap, the filled/outlined
// padding, and the title type. `md` is the v1 default; `sm` packs
// list rows tighter, `lg` gives a feature tile more presence. The
// `minimal` variant ignores the padding component (it has none) but
// still honours the gap + type scale.
export const CARD_SIZES = ["sm", "md", "lg"] as const;
export type CardSize = (typeof CARD_SIZES)[number];

export const CARD_SIZE_LABELS: Record<CardSize, string> = {
  sm: "Small",
  md: "Medium",
  lg: "Large",
};

/**
 * Inspector helper text + severity for the NewsletterSignup block's
 * `actionUrl` field. Surfaces three states for Mailchimp authors —
 * empty (paste hint), looks-valid (positive confirmation),
 * looks-broken (warn about reduced spam protection). Other
 * providers get a generic paste hint.
 *
 * Exported so the unit test asserts the message strings without
 * having to drive Puck. Pure / synchronous; safe to call during
 * the editor's render path.
 */
export function newsletterUrlDescription(
  service: NewsletterService,
  actionUrl: string,
): { kind: "info" | "ok" | "warn"; text: string } {
  if (service !== "mailchimp") {
    return {
      kind: "info",
      text: "Paste the form's POST URL from your provider's embed code.",
    };
  }
  if (!actionUrl) {
    return {
      kind: "info",
      text: "Paste the embed form's action URL (the ?u=…&id=… link from your audience embed code).",
    };
  }
  if (parseMailchimpAudienceHoneypotName(actionUrl)) {
    return {
      kind: "ok",
      text: "Looks like a Mailchimp audience URL — the per-audience honeypot will activate.",
    };
  }
  return {
    kind: "warn",
    text: "This URL doesn't look like a Mailchimp embed URL (expected ?u=USER_ID&id=LIST_ID). The signup still submits, but the per-audience honeypot won't activate — falls back to the universal honeypot only.",
  };
}

/**
 * Puck custom field for the NewsletterSignup `actionUrl`, with a
 * dynamic helper / warning rendered below the input. Returned by
 * `resolveFields` per-call so the helper text refreshes whenever
 * `service` or `actionUrl` changes.
 *
 * Why custom instead of `type: "text"`: Puck's TextField has no
 * `description` / help-text slot. The custom render reproduces the
 * native text input (single-line, controlled, blur-on-change) and
 * appends a paragraph below — the input UX is intentionally minimal
 * here because actionUrl is paste-only in practice.
 */
function newsletterUrlField(service: NewsletterService) {
  return {
    type: "custom" as const,
    label: "Form submission URL",
    // `value` updates live as the artist types — recompute the hint
    // inside render so it tracks the current input. Pre-baking the
    // hint outside the closure (at resolveFields time) would leave
    // the warning stale on every keystroke because Puck reuses the
    // existing custom-field render function and only updates its
    // `value` prop.
    render: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (next: string) => void;
    }): ReactElement => {
      const current = typeof value === "string" ? value : "";
      const hint = newsletterUrlDescription(service, current);
      return (
        <div style={newsletterUrlFieldStyle}>
          <input
            type="text"
            value={current}
            onChange={(e) => onChange(e.target.value)}
            style={newsletterUrlInputStyle}
          />
          {/* `aria-live` so screen-reader users hear the warning /
              confirmation cycle as they paste; sighted users get
              the colour swap. `polite` rather than `assertive`
              because nothing is broken — the message is advisory. */}
          <p
            role="status"
            aria-live="polite"
            style={newsletterUrlHintStyle(hint.kind)}
          >
            {hint.text}
          </p>
        </div>
      );
    },
  };
}

const newsletterUrlFieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
};

const newsletterUrlInputStyle: CSSProperties = {
  width: "100%",
  padding: "var(--space-2) var(--space-3)",
  fontSize: "var(--font-size-sm)",
  fontFamily: "var(--font-mono)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

function newsletterUrlHintStyle(kind: "info" | "ok" | "warn"): CSSProperties {
  return {
    margin: 0,
    fontSize: "var(--font-size-xs)",
    lineHeight: "var(--line-height-base)",
    color:
      kind === "warn"
        ? "var(--color-text-error)"
        : kind === "ok"
          ? "var(--color-text-emphasis)"
          : "var(--color-text-muted)",
  };
}

// All visual values come from CSS custom properties (see app/globals.css).
// CLAUDE.md §7 forbids raw hex/px/size values in inline styles.
const SECTION_WIDTH_MAX: Record<SectionWidth, string> = {
  sm: "var(--max-width-narrow)",
  md: "var(--max-width-content)",
  lg: "var(--max-width-wide)",
  full: "100%",
};

const SPACER_HEIGHT: Record<SpacerSize, string> = {
  sm: "var(--space-4)",
  md: "var(--space-8)",
  lg: "var(--space-16)",
  xl: "var(--space-32)",
};

const BUTTON_STYLE: Record<ButtonVariant, CSSProperties> = {
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

const BUTTON_BASE: CSSProperties = {
  display: "inline-block",
  padding: "var(--space-2) var(--space-4)",
  borderRadius: "var(--radius)",
  textDecoration: "none",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  cursor: "pointer",
};

// Per-layout CSS Grid `grid-template-columns` values.
const COLUMN_LAYOUT_TRACKS: Record<ColumnLayout, string> = {
  "1-1": "1fr 1fr",
  "1-2": "1fr 2fr",
  "2-1": "2fr 1fr",
  "1-1-1": "1fr 1fr 1fr",
};

const COLUMN_LAYOUT_SLOT_COUNT: Record<ColumnLayout, number> = {
  "1-1": 2,
  "1-2": 2,
  "2-1": 2,
  "1-1-1": 3,
};

export type BlockProps = {
  Heading: { text: string; level: HeadingLevel; textAlign: TextAlignment };
  Section: {
    width: SectionWidth;
    textAlign: TextAlignment;
    children: Slot;
  };
  FullscreenSection: {
    headline: string;
    body: string;
    image: ImageMetadata | null;
    /** Position of the foreground content on the fullscreen panel. */
    textAlign: TextAlignment;
    /** Tint painted over the image for legibility. */
    overlayOpacity: number;
  };
  Columns: {
    layout: ColumnLayout;
    col1: Slot;
    col2: Slot;
    col3: Slot;
  };
  RichText: { text: string };
  Quote: { text: string; attribution: string };
  Button: { text: string; href: string; variant: ButtonVariant; isExternal: boolean };
  Image: {
    /** Full ImageMetadata returned by /api/upload-image, or null when not yet picked. */
    image: ImageMetadata | null;
    caption: string;
  };
  Embed: { html: string };
  Spacer: { size: SpacerSize };
  Divider: { inset: boolean };
  ContactForm: Record<string, never>;
  NewsletterSignup: {
    service: NewsletterService;
    actionUrl: string;
    title: string;
    emailLabel: string;
    submitLabel: string;
    successMessage: string;
    hasNameField: boolean;
    nameLabel: string;
  };
  ImageCarousel: {
    slides: Array<{ image: ImageMetadata | null; caption: string }>;
    aspectRatio: CarouselAspectRatio;
    areArrowsHidden: boolean;
    areDotsHidden: boolean;
  };
  CenteredBlock: {
    maxWidth: CenteredBlockMaxWidth;
    children: Slot;
  };
  EmbedResponsive: {
    html: string;
    aspectRatio: EmbedAspectRatio;
  };
  Card: {
    image: ImageMetadata | null;
    eyebrow: string;
    title: string;
    description: string;
    href: string;
    isExternal: boolean;
    orientation: CardOrientation;
    variant: CardVariant;
    size: CardSize;
    /** Optional downloadable file URL. Renders a download button. */
    fileUrl: string;
    /** Free-text label beside the download button (e.g. "2.3 MB"). */
    sizeLabel: string;
    /**
     * Opt the non-link `<article>` card into the same lift-on-hover
     * affordance link-cards always get. Visual-only — no clickability
     * implied (the card is still an `<article>` semantically).
     * Honours `prefers-reduced-motion: reduce`.
     */
    isHoverable: boolean;
  };
};

/**
 * Render `text` as paragraphs separated by blank lines. Used by RichText
 * and the FullscreenSection hero body (both still take a single textarea
 * rather than a slot of nested blocks).
 */
function renderParagraphs(text: string, key = "p"): ReactNode {
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0)
    .map((paragraph, i) => <p key={`${key}-${i}`}>{paragraph}</p>);
}

function textAlignStyle(align: TextAlignment): CSSProperties {
  return { textAlign: align };
}

// ---------------------------------------------------------------------------
// Card styles
// ---------------------------------------------------------------------------

// Size → internal gap (media ↔ body) token. The same scale the
// legacy template's `.card-sm/md/lg` gap rules used.
const CARD_SIZE_GAP: Record<CardSize, string> = {
  sm: "var(--space-2)",
  md: "var(--space-3)",
  lg: "var(--space-4)",
};

// Size → padding token for the chromed (filled / outlined) variants.
// `minimal` ignores this (no padding).
const CARD_SIZE_PADDING: Record<CardSize, string> = {
  sm: "var(--space-3)",
  md: "var(--space-4)",
  lg: "var(--space-5)",
};

// Size → title type scale. Bumps the visual weight of a feature
// tile and tightens a packed list row.
const CARD_SIZE_TITLE_FONT: Record<CardSize, string> = {
  sm: "var(--font-size-base)",
  md: "var(--font-size-lg)",
  lg: "var(--font-size-xl)",
};

/**
 * Coerce a possibly-missing / unknown `size` to the `md` default.
 * Card JSON saved before the size axis landed has no `size` key,
 * and Puck's public `<Render>` path passes raw on-disk props through
 * without backfilling `defaultProps` (those only apply in the
 * editor). Without this guard, an old card's `size` arrives
 * `undefined` at runtime — despite the `CardSize` prop type — and
 * every size-driven token (`CARD_SIZE_GAP[undefined]` etc.) collapses
 * to `undefined`, stripping the card's padding, gap, AND title font
 * in one go. Falling back to `md` keeps old cards rendering at their
 * original v2 scale.
 */
function normaliseCardSize(size: CardSize | undefined): CardSize {
  return (CARD_SIZES as readonly string[]).includes(size as string) ? (size as CardSize) : "md";
}

function cardContainerStyle(
  orientation: CardOrientation,
  variant: CardVariant,
  size: CardSize,
): CSSProperties {
  // `minimal` strips all chrome — no border, no background, no
  // padding — so the card sits flush like a list item. The size
  // gap between media + body still applies. `filled` / `outlined`
  // keep the border + radius and pad by size; only `filled` carries
  // the surface fill (outlined drops it so the page background shows
  // through on busy / image-heavy surfaces).
  const isMinimal = variant === "minimal";
  return {
    display: orientation === "horizontal" ? "grid" : "flex",
    gridTemplateColumns: orientation === "horizontal" ? "1fr 2fr" : undefined,
    flexDirection: orientation === "vertical" ? "column" : undefined,
    gap: CARD_SIZE_GAP[size],
    margin: "var(--space-4) 0",
    padding: isMinimal ? 0 : CARD_SIZE_PADDING[size],
    border: isMinimal ? undefined : "1px solid var(--color-border)",
    borderRadius: isMinimal ? undefined : "var(--radius-md)",
    background: variant === "filled" ? "var(--color-surface)" : "transparent",
  };
}

/**
 * Bottom-of-card download affordance. A button-styled anchor with the
 * `download` attribute that triggers the browser's save-as. The size
 * label sits next to the button as muted text (the artist provides
 * it free-text; we don't validate or compute it). External by
 * default — opens in a new tab so a single click doesn't navigate
 * the host page away.
 */
function CardDownload({
  fileUrl,
  sizeLabel,
}: {
  fileUrl: string;
  sizeLabel: string;
}): ReactNode {
  return (
    <div style={cardDownloadRowStyle}>
      <a
        href={fileUrl}
        download
        // `download` doesn't work cross-origin in every browser; the
        // `target="_blank"` fallback at least opens the file in a new
        // tab instead of replacing the artist's page.
        target="_blank"
        rel="noopener noreferrer"
        style={cardDownloadButtonStyle}
      >
        Download
      </a>
      {sizeLabel ? (
        <span style={cardSizeLabelStyle} aria-label={`File size: ${sizeLabel}`}>
          {sizeLabel}
        </span>
      ) : null}
    </div>
  );
}

function cardMediaStyle(orientation: CardOrientation): CSSProperties {
  // Horizontal cards reserve a fixed aspect for the media cell so
  // titles line up across a list. Vertical cards let the image take
  // its intrinsic aspect — the surrounding Section / Columns owns
  // overall width.
  if (orientation === "horizontal") {
    return {
      aspectRatio: "4 / 3",
      overflow: "hidden",
      borderRadius: "var(--radius-sm)",
    };
  }
  return {
    overflow: "hidden",
    borderRadius: "var(--radius-sm)",
  };
}

const cardBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

function cardTitleStyle(size: CardSize): CSSProperties {
  return {
    margin: 0,
    fontSize: CARD_SIZE_TITLE_FONT[size],
    fontWeight: "var(--font-weight-semibold)" as unknown as number,
    color: "var(--color-text)",
  };
}

const cardDescriptionStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-muted)",
  lineHeight: "var(--line-height-base)",
};

const cardEyebrowStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const cardDownloadRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  marginTop: "var(--space-2)",
};

const cardDownloadButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "var(--space-1) var(--space-3)",
  background: "var(--color-action)",
  color: "var(--color-action-fg)",
  borderRadius: "var(--radius)",
  textDecoration: "none",
  fontSize: "var(--font-size-sm)",
  fontWeight: "var(--font-weight-semibold)" as unknown as number,
};

const cardSizeLabelStyle: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-muted)",
};

/**
 * One-line plain-English description per block, surfaced above the
 * field controls in the right-hand inspector when a block is
 * selected. Aimed at non-technical artists — what the block does and
 * the most common knob, not a comprehensive feature list. Wired into
 * the editor via Puck's `overrides.fields` (see
 * `app/admin/pages/[slug]/Editor.tsx`).
 *
 * `Record<keyof BlockProps, string>` is intentional: adding a new
 * block to `BlockProps` without writing a description fails
 * typecheck. There's an additional runtime safety net in
 * `config.test.ts`.
 */
export const BLOCK_DESCRIPTIONS: Record<keyof BlockProps, string> = {
  Heading: "Big text — page or section heading. Pick H1 / H2 / H3 for size.",
  Section: "A container — drop other blocks inside. Set the width and text alignment.",
  FullscreenSection: "Hero panel that fills the viewport — image background with a large headline on top.",
  CenteredBlock: "Centered single-column container — keeps content from sprawling on wide screens.",
  Columns: "Two- or three-column layout. Drop blocks into each column.",
  RichText: "A paragraph of text. Blank lines start a new paragraph.",
  Quote: "A pull quote with an attribution line below.",
  Button: "A clickable button — links to another page or external URL.",
  Card: "Image + title + description tile. Optional link wraps the whole card.",
  Image: "A single image with optional caption. Upload from your computer.",
  ImageCarousel: "Scrollable strip of images with arrows and dots — for galleries, press shots, etc.",
  Embed: "Paste embed HTML from Spotify, YouTube, Bandcamp, or another service.",
  EmbedResponsive: "Aspect-ratio-aware wrapper for pasted iframes (Bandcamp, YouTube) — keeps them responsive.",
  Spacer: "Vertical breathing room between blocks. Sizes from small to extra-large.",
  Divider: "A horizontal line between blocks.",
  ContactForm: "Built-in form (name / email / subject / message). Sends to your contact email.",
  NewsletterSignup: "Email-signup form for a newsletter service (Mailchimp, Buttondown, etc).",
};

export const puckConfig: Config<
  BlockProps,
  {
    title: string;
    isSplashPage: boolean;
    isFooterHidden: boolean;
    pageBackground: ImageMetadata | null;
    pageBackgroundOverlay: number | null;
  }
> = {
  // Per-page settings — surfaced in Puck's right-hand "Page" inspector when
  // no block is selected. These map to the on-disk `data.root.props` shape
  // and are read by the public renderer (Header / Footer / splash logic).
  root: {
    fields: {
      title: { type: "text", label: "Page title" },
      isSplashPage: {
        type: "radio",
        label: "Splash page",
        options: [
          { label: "Normal page", value: false },
          { label: "Splash (takes over /)", value: true },
        ],
      },
      isFooterHidden: {
        type: "radio",
        label: "Footer on this page",
        options: [
          { label: "Show footer", value: false },
          { label: "Hide footer", value: true },
        ],
      },
      pageBackground: {
        type: "custom",
        label: "Background image (overrides site-wide)",
        render: ({ value, onChange }) => (
          <ImagePickerField
            value={(value as ImageMetadata | null) ?? null}
            onChange={onChange}
          />
        ),
      },
      pageBackgroundOverlay: {
        type: "number",
        label: "Background tint opacity (leave blank to inherit site)",
        min: 0,
        max: 1,
        step: 0.05,
      },
    },
    defaultProps: {
      title: "Untitled",
      isSplashPage: false,
      isFooterHidden: false,
      pageBackground: null,
      pageBackgroundOverlay: null,
    },
  },
  // Group the component drawer by purpose instead of one flat list.
  // Puck reads `categories` natively and renders one collapsible
  // sub-drawer per entry; the order here is the display order. Any
  // block not listed below would fall into Puck's built-in `other`
  // group — `config.test.ts` asserts we cover every component, so
  // `other` stays empty.
  categories: {
    layout: {
      title: "Layout",
      components: [
        "Section",
        "FullscreenSection",
        "CenteredBlock",
        "Columns",
        "Spacer",
        "Divider",
      ],
    },
    content: {
      title: "Content",
      components: ["Heading", "RichText", "Quote", "Button", "Card"],
    },
    media: {
      title: "Media",
      components: ["Image", "ImageCarousel", "Embed", "EmbedResponsive"],
    },
    forms: {
      title: "Forms",
      components: ["ContactForm", "NewsletterSignup"],
    },
  },
  components: {
    Heading: {
      fields: {
        text: { type: "text" },
        level: {
          type: "select",
          options: HEADING_LEVELS.map((v) => ({ label: v.toUpperCase(), value: v })),
        },
        textAlign: {
          type: "select",
          options: TEXT_ALIGNMENTS.map((v) => ({ label: TEXT_ALIGNMENT_LABELS[v], value: v })),
        },
      },
      defaultProps: { text: "Heading", level: "h2", textAlign: "start" },
      render: ({ text, level, textAlign }) => {
        const Tag = level;
        return <Tag style={textAlignStyle(textAlign)}>{text}</Tag>;
      },
    },
    Section: {
      // Section is a slot container — drop any blocks (Heading, RichText,
      // Image, Columns, …) inside via Puck's drag-and-drop. The block
      // owns the page-level chrome (max-width, padding, text-align)
      // while the children own the content.
      //
      // A separate Section block lives in `buildEditorPuckConfig.tsx`
      // for the template-editor surface. ADR-007 exempts Puck block
      // configs from cross-system SSOT — the two intentionally diverge
      // (template Section has `padding` instead of `textAlign`,
      // outlines its bounds with a dashed border for editor clarity).
      fields: {
        width: {
          type: "select",
          options: SECTION_WIDTHS.map((v) => ({ label: v, value: v })),
        },
        textAlign: {
          type: "select",
          options: TEXT_ALIGNMENTS.map((v) => ({ label: TEXT_ALIGNMENT_LABELS[v], value: v })),
        },
        children: { type: "slot" },
      },
      defaultProps: {
        width: "md",
        textAlign: "start",
        children: [],
      },
      render: ({ width, textAlign, children: Children }) => (
        <section
          style={{
            maxWidth: SECTION_WIDTH_MAX[width],
            margin: "0 auto",
            padding: "var(--space-8) var(--space-4)",
            ...textAlignStyle(textAlign),
          }}
        >
          <Children />
        </section>
      ),
    },
    CenteredBlock: {
      // Narrower-than-Section centered column for intro paragraphs,
      // CTAs, and pull-quotes. Sibling to Section: Section owns the
      // page-width chrome, CenteredBlock takes a slot inside a
      // Section (or at the page root) and constrains its children
      // tighter.
      //
      // Slot-based so the artist can drop any block inside; the
      // wrapper just adds `margin-inline: auto`, `text-align:
      // center`, and a max-width cap.
      fields: {
        maxWidth: {
          type: "select",
          label: "Max width",
          options: CENTERED_BLOCK_MAX_WIDTHS.map((v) => ({
            label: CENTERED_BLOCK_MAX_WIDTH_LABELS[v],
            value: v,
          })),
        },
        children: { type: "slot" },
      },
      defaultProps: { maxWidth: "narrow", children: [] },
      render: ({ maxWidth, children: Children }) => (
        <div
          style={{
            maxWidth: CENTERED_BLOCK_MAX_WIDTH_TOKEN[maxWidth],
            marginInline: "auto",
            textAlign: "center",
          }}
        >
          <Children />
        </div>
      ),
    },
    FullscreenSection: {
      fields: {
        headline: { type: "text" },
        body: { type: "textarea" },
        image: {
          type: "custom",
          render: ({ value, onChange }) => (
            <ImagePickerField
              value={(value as ImageMetadata | null) ?? null}
              onChange={(next) => onChange(next as ImageMetadata | null)}
            />
          ),
        },
        textAlign: {
          type: "select",
          options: TEXT_ALIGNMENTS.map((v) => ({ label: TEXT_ALIGNMENT_LABELS[v], value: v })),
        },
        overlayOpacity: {
          type: "number",
          min: 0,
          max: 1,
          step: 0.05,
        },
      },
      defaultProps: {
        headline: "Big headline",
        body: "Hero copy that introduces the page.",
        image: null,
        textAlign: "center",
        overlayOpacity: 0.3,
      },
      render: ({ headline, body, image, textAlign, overlayOpacity }) => {
        const clampedOpacity = Math.max(0, Math.min(1, overlayOpacity));
        return (
          <section
            style={{
              position: "relative",
              width: "100%",
              minHeight: "80vh",
              padding: "var(--space-16) var(--space-4)",
              display: "flex",
              alignItems: "center",
              justifyContent:
                textAlign === "center" ? "center" : textAlign === "end" ? "flex-end" : "flex-start",
              color: image ? "var(--color-action-fg)" : "var(--color-text)",
              background: image ? "transparent" : "var(--color-surface-raised)",
              overflow: "hidden",
            }}
          >
            {image ? (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 0,
                }}
              >
                <div style={{ position: "absolute", inset: 0 }}>
                  <PublicImage image={image as ImageMetadata} sizes="100vw" />
                </div>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "#000",
                    opacity: clampedOpacity,
                  }}
                />
              </div>
            ) : null}
            <div
              style={{
                position: "relative",
                zIndex: 1,
                maxWidth: "var(--max-width-content)",
                ...textAlignStyle(textAlign),
              }}
            >
              {headline ? (
                <h1 style={{ fontSize: "2.5rem", margin: 0 }}>{headline}</h1>
              ) : null}
              {body ? renderParagraphs(body, "fs") : null}
            </div>
          </section>
        );
      },
    },
    Columns: {
      // Each column is a slot — drop any block into a column independently.
      // The chosen `layout` decides how many columns render: 1-1 / 1-2 / 2-1
      // emit two columns (col3 is ignored even if it has children);
      // 1-1-1 emits all three. Keeping col3 as a real slot rather than a
      // conditional one means the artist's content survives if they switch
      // a 1-1-1 column back to 1-1 and then back again.
      fields: {
        layout: {
          type: "select",
          options: COLUMN_LAYOUTS.map((v) => ({ label: COLUMN_LAYOUT_LABELS[v], value: v })),
        },
        col1: { type: "slot" },
        col2: { type: "slot" },
        col3: { type: "slot" },
      },
      defaultProps: {
        layout: "1-1",
        col1: [],
        col2: [],
        col3: [],
      },
      render: ({ layout, col1: Col1, col2: Col2, col3: Col3 }) => {
        const slotCount = COLUMN_LAYOUT_SLOT_COUNT[layout];
        const cols = [Col1, Col2, Col3].slice(0, slotCount);
        return (
          <div
            style={{
              maxWidth: "var(--max-width-wide)",
              margin: "0 auto",
              padding: "var(--space-6) var(--space-4)",
              display: "grid",
              gridTemplateColumns: COLUMN_LAYOUT_TRACKS[layout],
              gap: "var(--space-6)",
            }}
          >
            {cols.map((Col, i) => (
              <div key={i}>
                <Col />
              </div>
            ))}
          </div>
        );
      },
    },
    RichText: {
      // Layout-transparent: no max-width, no horizontal padding. The
      // enclosing Section (or any other slot container) owns those —
      // doubling them up here is the regression the slot-conversion
      // PR exposed when RichText started showing up nested inside
      // Section. Top-level RichText (outside any Section) now stretches
      // to its parent's width; the seeded pages all wrap text in a
      // Section, and the editor's Insert menu naturally pushes new
      // text-style content into a container.
      fields: { text: { type: "textarea" } },
      defaultProps: {
        text: "Write your paragraph here.\n\nBlank lines start a new paragraph.",
      },
      render: ({ text }) => <div>{renderParagraphs(text, "rt")}</div>,
    },
    Quote: {
      // Layout-transparent: no max-width, no horizontal centering. The
      // enclosing Section (or any other slot container) owns horizontal
      // layout. Left padding stays — it offsets the text from the
      // `borderLeft` decoration, which is intrinsic to the block's
      // identity, not a layout container. Top/bottom margins stay too
      // (vertical breathing between adjacent blocks isn't owned by
      // Section).
      fields: {
        text: { type: "textarea" },
        attribution: { type: "text" },
      },
      defaultProps: {
        text: "A standout debut — confident, original, deeply moving.",
        attribution: "Music Publication",
      },
      render: ({ text, attribution }) => (
        <figure
          style={{
            margin: "var(--space-8) 0",
            padding: "var(--space-6) 0 var(--space-6) var(--space-4)",
            borderLeft: "4px solid var(--color-border-strong)",
            color: "var(--color-text-emphasis)",
            fontStyle: "italic",
          }}
        >
          <blockquote style={{ margin: 0, fontSize: "var(--font-size-lg)" }}>“{text}”</blockquote>
          {attribution ? (
            <figcaption
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-muted)",
                marginTop: "var(--space-2)",
                fontStyle: "normal",
              }}
            >
              — {attribution}
            </figcaption>
          ) : null}
        </figure>
      ),
    },
    Button: {
      fields: {
        text: { type: "text" },
        href: { type: "text" },
        variant: {
          type: "select",
          options: BUTTON_VARIANTS.map((v) => ({ label: v, value: v })),
        },
        isExternal: {
          type: "radio",
          options: [
            { label: "Same tab", value: false },
            { label: "Open in new tab", value: true },
          ],
        },
      },
      defaultProps: { text: "Click me", href: "#", variant: "primary", isExternal: false },
      render: ({ text, href, variant, isExternal }) => (
        <div style={{ textAlign: "center", padding: "var(--space-4)" }}>
          <a
            href={href}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer" : undefined}
            style={{ ...BUTTON_BASE, ...BUTTON_STYLE[variant] }}
          >
            {text}
          </a>
        </div>
      ),
    },
    Image: {
      // Layout-transparent: no max-width, no horizontal centering, no
      // horizontal padding. The enclosing Section (or other slot
      // container) owns those — doubling them up was the regression
      // the slot-conversion PR exposed for nested blocks. Top-level
      // standalone Image stretches to its parent's width — same
      // composition the RichText / Heading blocks follow.
      fields: {
        image: {
          type: "custom",
          render: ({ value, onChange }) => (
            <ImagePickerField
              value={(value as ImageMetadata | null) ?? null}
              onChange={(next) => onChange(next as ImageMetadata | null)}
            />
          ),
        },
        caption: { type: "text" },
      },
      defaultProps: { image: null, caption: "" },
      render: ({ image, caption }) => {
        if (!image) {
          return (
            <div
              style={{
                padding: "var(--space-8) 0",
                textAlign: "center",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
              }}
            >
              No image picked yet
            </div>
          );
        }
        // Puck's Config<T> generic collapses ImageMetadata's branded `id`
        // (`string & { ... [imageIdBrand]: never }`) into its methods-as-
        // properties form during type mapping, so `image` here is no longer
        // structurally assignable to ImageMetadata even though its runtime
        // shape is identical. Cast at the render boundary.
        return (
          <figure style={{ margin: 0 }}>
            <PublicImage image={image as ImageMetadata} />
            {caption ? (
              <figcaption
                style={{
                  fontSize: "var(--font-size-sm)",
                  color: "var(--color-text-muted)",
                  textAlign: "center",
                  marginTop: "var(--space-2)",
                }}
              >
                {caption}
              </figcaption>
            ) : null}
          </figure>
        );
      },
    },
    Card: {
      // Media + text tile. Vertical (image on top, default) for grid
      // layouts; horizontal (image on side) for list rows. Whole card
      // becomes a link when `href` is set.
      //
      // Adds over v1: eyebrow (small label above title), variant
      // (filled / outlined / minimal), size axis (sm / md / lg),
      // file-download affordance (button at the bottom with optional
      // size label). The legacy template also has icon-mode media for
      // non-image previews (audio / video / PDF tiles); skipped here
      // pending demand — see docs/follow-ups.md.
      //
      // Mutual exclusivity: `href` makes the WHOLE card a link;
      // `fileUrl` makes the download button a link instead. When
      // both are set, `href` wins and the download button is
      // suppressed — nesting an `<a download>` inside the outer
      // card-link `<a>` is invalid HTML (browsers implicitly
      // close the outer anchor at the inner one, breaking layout
      // and hydration). The artist's authoring contract is "pick
      // href OR fileUrl, not both."
      fields: {
        image: {
          type: "custom",
          label: "Image",
          render: ({ value, onChange }) => (
            <ImagePickerField
              value={(value as ImageMetadata | null) ?? null}
              onChange={(next) => onChange(next as ImageMetadata | null)}
            />
          ),
        },
        eyebrow: { type: "text", label: "Eyebrow (small label above title)" },
        title: { type: "text", label: "Title" },
        description: { type: "textarea", label: "Description" },
        href: { type: "text", label: "Link URL (optional)" },
        isExternal: {
          type: "radio",
          label: "Link target",
          options: [
            { label: "Same tab", value: false },
            { label: "New tab", value: true },
          ],
        },
        orientation: {
          type: "select",
          label: "Orientation",
          options: CARD_ORIENTATIONS.map((v) => ({
            label: CARD_ORIENTATION_LABELS[v],
            value: v,
          })),
        },
        variant: {
          type: "select",
          label: "Visual style",
          options: CARD_VARIANTS.map((v) => ({
            label: CARD_VARIANT_LABELS[v],
            value: v,
          })),
        },
        size: {
          type: "select",
          label: "Size",
          options: CARD_SIZES.map((v) => ({
            label: CARD_SIZE_LABELS[v],
            value: v,
          })),
        },
        fileUrl: { type: "text", label: "Downloadable file URL (optional)" },
        sizeLabel: { type: "text", label: "Size label (e.g. '2.3 MB')" },
        isHoverable: {
          type: "radio",
          label: "Hover affordance (non-link cards only)",
          options: [
            { label: "Static (default)", value: false },
            { label: "Lift on hover", value: true },
          ],
        },
      },
      defaultProps: {
        image: null,
        eyebrow: "",
        title: "Card title",
        description: "",
        href: "",
        isExternal: false,
        orientation: "vertical",
        variant: "filled",
        size: "md",
        fileUrl: "",
        sizeLabel: "",
        isHoverable: false,
      },
      render: ({
        image,
        eyebrow,
        title,
        description,
        href,
        isExternal,
        orientation,
        variant,
        size: rawSize,
        fileUrl,
        sizeLabel,
        isHoverable,
      }) => {
        // Coerce missing/unknown size (old on-disk cards) to md before
        // it feeds the size-driven token maps — see normaliseCardSize.
        const size = normaliseCardSize(rawSize);
        const inner = (
          <>
            {image ? (
              <div
                className="stagecraft-card-media"
                style={cardMediaStyle(orientation)}
              >
                <PublicImage
                  image={image as ImageMetadata}
                  sizes={
                    orientation === "horizontal"
                      ? "(max-width: 600px) 100vw, 33vw"
                      : "(max-width: 600px) 100vw, 50vw"
                  }
                />
              </div>
            ) : null}
            <div style={cardBodyStyle}>
              {eyebrow ? <div style={cardEyebrowStyle}>{eyebrow}</div> : null}
              {/* Title is a styled non-heading on purpose — a grid
                  of 6 cards would otherwise emit 6 `<h3>`s into the
                  document outline, which screen-reader users
                  navigating by heading would have to skip past.
                  Visual emphasis still reads as a title. Same
                  choice the legacy template made. */}
              <div style={cardTitleStyle(size)}>{title}</div>
              {description ? (
                <p style={cardDescriptionStyle}>{description}</p>
              ) : null}
              {/* Suppress the download anchor when the whole card is
                  already a link. Nested anchors are invalid HTML;
                  the browser would implicitly close the outer one
                  and break layout / hydration. */}
              {fileUrl && !href ? (
                <CardDownload fileUrl={fileUrl} sizeLabel={sizeLabel} />
              ) : null}
            </div>
          </>
        );

        const containerStyle = cardContainerStyle(orientation, variant, size);

        if (href) {
          // Whole card is a link. Drop the default underline (the
          // title carries visual emphasis) but keep the link
          // semantics for AT. The `stagecraft-card-link` class
          // adds a subtle hover affordance (border shift + lift)
          // — inline styles can't carry `:hover`, so the rule
          // lives in globals.css.
          return (
            <a
              href={href}
              target={isExternal ? "_blank" : undefined}
              rel={isExternal ? "noopener noreferrer" : undefined}
              className="stagecraft-card-link"
              style={{ ...containerStyle, textDecoration: "none", color: "inherit" }}
            >
              {inner}
            </a>
          );
        }
        // Non-link `<article>` variant. `isHoverable` opts into the
        // same lift-on-hover affordance link-cards always get —
        // useful when a grid of cards wants visual feedback on
        // mouseover without implying clickability. The CSS rule
        // in globals.css attaches via the same `:hover` style that
        // gates `.stagecraft-card-link`. Without the opt-in, the
        // card stays static (the conservative default — animation
        // on every card in a long list is busy).
        return (
          <article
            className={isHoverable ? "stagecraft-card-hoverable" : undefined}
            style={containerStyle}
          >
            {inner}
          </article>
        );
      },
    },
    Embed: {
      // Layout-transparent: no max-width, no horizontal centering, no
      // horizontal padding. Same reasoning as Image/Quote/RichText —
      // the enclosing Section owns layout. The pasted iframe's own
      // `width="100%"` (Spotify's default) already fills whatever
      // container it lands in.
      fields: {
        html: { type: "textarea" },
      },
      defaultProps: {
        html: '<iframe src="https://open.spotify.com/embed/track/EXAMPLE" width="100%" height="80"></iframe>',
      },
      render: ({ html }) => (
        // Embeds (Spotify/Bandcamp/YouTube/etc.) ship as `<iframe>` HTML
        // snippets that the artist pastes verbatim. dangerouslySetInnerHTML
        // is the right tool here — the artist authoring the page is the
        // operator, not an attacker, and the surrounding admin auth limits
        // who can store HTML. This is the same trade the legacy template's
        // `{% embed %}` made.
        <div
          style={{ margin: "var(--space-4) 0" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ),
    },
    EmbedResponsive: {
      // Sibling to Embed for embeds that need to scale with their
      // column at a fixed aspect ratio. Bandcamp / SoundCloud
      // typically ship a fixed-pixel iframe (`350x470`) that looks
      // awkward stretched; this block wraps it in an aspect-ratio
      // container that scales while preserving the ratio.
      //
      // Auto mode: parses the pasted iframe's `width` / `height`
      // (attributes or inline-style px) and derives the ratio.
      // When neither is available (Spotify's `width="100%"`), we
      // render passthrough — the wrapper would force a 0-height
      // iframe otherwise.
      //
      // Same dangerouslySetInnerHTML trade as Embed — admin-only
      // input surface.
      fields: {
        html: { type: "textarea" },
        aspectRatio: {
          type: "select",
          label: "Aspect ratio",
          options: EMBED_ASPECT_RATIOS.map((v) => ({
            label: EMBED_ASPECT_RATIO_LABELS[v],
            value: v,
          })),
        },
      },
      defaultProps: {
        html: '<iframe src="https://bandcamp.com/EmbeddedPlayer/EXAMPLE/size=large" width="350" height="470"></iframe>',
        aspectRatio: "auto",
      },
      render: ({ html, aspectRatio }) => {
        // Resolve the effective ratio. Explicit wins; "auto" derives
        // from the iframe's intrinsic dimensions.
        let resolvedRatio: string | null = null;
        if (aspectRatio !== "auto") {
          resolvedRatio = aspectRatio;
        } else {
          const dims = extractIframeIntrinsicDimensions(html);
          if (dims) resolvedRatio = `${dims.width} / ${dims.height}`;
        }

        // Passthrough fallback (no wrapper) when no ratio is
        // derivable — otherwise the wrapper would collapse a
        // percentage-width iframe to zero height. Emit the
        // iframe HTML unchanged so its declared sizing applies.
        if (resolvedRatio === null) {
          return (
            <div
              style={{ margin: "var(--space-4) 0" }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        // Wrapped case: strip the iframe's `width` / `height`
        // attributes and any `width: Npx` / `height: Npx` inline
        // style declarations so the wrapper's class-based sizing
        // wins. Without this, an iframe with `style="width: 350px"`
        // keeps its inline width (higher specificity than the
        // wrapper's class rule) and doesn't fill the wrapper.
        const innerHtml = stripIframeDimensions(html);

        return (
          <div
            className="stagecraft-embed-responsive"
            style={{
              margin: "var(--space-4) 0",
              aspectRatio: resolvedRatio,
            }}
            dangerouslySetInnerHTML={{ __html: innerHtml }}
          />
        );
      },
    },
    Spacer: {
      fields: {
        size: {
          type: "select",
          options: SPACER_SIZES.map((v) => ({ label: v, value: v })),
        },
      },
      defaultProps: { size: "md" },
      render: ({ size }) => (
        <div
          aria-hidden
          style={{ height: SPACER_HEIGHT[size] }}
        />
      ),
    },
    Divider: {
      fields: { inset: { type: "radio", options: [
        { label: "full-width", value: false },
        { label: "inset", value: true },
      ] } },
      defaultProps: { inset: false },
      render: ({ inset }) => (
        <hr
          style={{
            border: "none",
            borderTop: "1px solid var(--color-border)",
            margin: inset ? "var(--space-8) var(--space-16)" : "var(--space-8) 0",
          }}
        />
      ),
    },
    ContactForm: {
      // No artist-editable fields — the form is intentionally fixed
      // (name / email / subject / message) so a drag-and-drop drop-in
      // matches what the legacy template's `{% contact-form /%}` block
      // emitted. Delivery target lives on `site.json#contactEmail`,
      // edited at /admin/settings.
      fields: {},
      defaultProps: {},
      render: () => <ContactForm />,
    },
    NewsletterSignup: {
      // Single block (vs the legacy template's five composable
      // sub-blocks). The optional name field is the most-requested
      // extension; richer per-service field configuration (preference
      // dropdowns etc.) stays out of scope.
      //
      // Form submits cross-origin to the artist's chosen provider
      // (Mailchimp / ConvertKit / Buttondown / generic). No server
      // route on this template — the no-cors fetch in
      // NewsletterSignup.tsx posts straight to the provider.
      //
      // `resolveFields` rebuilds `actionUrl` as a custom field whose
      // render adds an inline helper / warning beneath the input —
      // Puck's stock `TextField` has no description / help-text slot.
      // The helper surfaces three states for Mailchimp authors:
      //   - empty → paste hint
      //   - parseable → positive confirmation (per-audience honeypot
      //     will activate)
      //   - non-parseable → warning that the per-audience honeypot
      //     can't be derived (falls back to the universal `_gotcha`).
      // The signup keeps submitting either way; the warning just
      // helps the artist paste the right URL up-front instead of
      // discovering "spam protection isn't working" months later.
      resolveFields: (data, { fields }) => ({
        // `service` is the only sibling field the hint depends on —
        // pass it through so the custom render can recompute the
        // hint per-keystroke against the live `value`. The render
        // function is reused across keystrokes (Puck only updates
        // its `value` prop), so `service` has to be baked into the
        // closure here.
        ...fields,
        actionUrl: newsletterUrlField(data.props.service),
      }),
      fields: {
        service: {
          type: "select",
          label: "Newsletter provider",
          options: NEWSLETTER_SERVICES.map((s) => ({
            label: NEWSLETTER_SERVICE_LABELS[s],
            value: s,
          })),
        },
        // Placeholder field — `resolveFields` above rebuilds this
        // every render against the current `service`. Puck needs a
        // value here at static-config parse time; the service arg
        // doesn't matter (any value is replaced before display).
        actionUrl: newsletterUrlField("mailchimp"),
        title: {
          type: "text",
          label: "Title (optional)",
        },
        emailLabel: {
          type: "text",
          label: "Email field label",
        },
        submitLabel: {
          type: "text",
          label: "Submit button label",
        },
        successMessage: {
          type: "textarea",
          label: "Success message",
        },
        hasNameField: {
          type: "radio",
          label: "Collect first name",
          options: [
            { label: "Email only", value: false },
            { label: "Email + name", value: true },
          ],
        },
        nameLabel: {
          type: "text",
          label: "Name field label",
        },
      },
      defaultProps: {
        service: "mailchimp" satisfies NewsletterService,
        actionUrl: "",
        title: "Stay in the loop",
        emailLabel: "Email",
        submitLabel: "Subscribe",
        successMessage: "Thanks for subscribing! Check your inbox to confirm.",
        hasNameField: false,
        nameLabel: "First name",
      },
      render: ({
        service,
        actionUrl,
        title,
        emailLabel,
        submitLabel,
        successMessage,
        hasNameField,
        nameLabel,
      }) => (
        <NewsletterSignup
          service={service}
          actionUrl={actionUrl}
          title={title}
          emailLabel={emailLabel}
          submitLabel={submitLabel}
          successMessage={successMessage}
          hasNameField={hasNameField}
          nameLabel={nameLabel}
        />
      ),
    },
    ImageCarousel: {
      // Inline-photos mode only (vs the legacy template's collection-
      // filter mode that pulled from the photos collection by
      // `usageSlot`). The `usageSlot` field doesn't exist on the
      // current ImageMetadata, and inline-photo authoring is the
      // higher-bandwidth UX anyway. Collection-source mode lands when
      // image-metadata-richness does.
      //
      // Each slide is `{ image: ImageMetadata, caption?: string }`.
      // Slides without an image are filtered out at render time
      // (artist dropped the block, added a row, hasn't picked yet).
      fields: {
        slides: {
          type: "array",
          label: "Slides",
          arrayFields: {
            image: {
              type: "custom",
              label: "Image",
              render: ({ value, onChange }) => (
                <ImagePickerField
                  value={value as ImageMetadata | null}
                  onChange={(next) => onChange(next as ImageMetadata)}
                />
              ),
            },
            caption: {
              type: "text",
              label: "Caption (optional)",
            },
          },
          getItemSummary: (item, i) => {
            const v = item as { image: ImageMetadata | null; caption: string };
            return v.caption || v.image?.alt || `Slide ${(i ?? 0) + 1}`;
          },
        },
        aspectRatio: {
          type: "select",
          label: "Aspect ratio",
          options: CAROUSEL_ASPECT_RATIOS.map((r) => ({
            label: CAROUSEL_ASPECT_RATIO_LABELS[r],
            value: r,
          })),
        },
        areArrowsHidden: {
          type: "radio",
          label: "Arrows",
          options: [
            { label: "Show", value: false },
            { label: "Hide", value: true },
          ],
        },
        areDotsHidden: {
          type: "radio",
          label: "Dot indicators",
          options: [
            { label: "Show", value: false },
            { label: "Hide", value: true },
          ],
        },
      },
      defaultProps: {
        slides: [],
        aspectRatio: "16/9" satisfies CarouselAspectRatio,
        areArrowsHidden: false,
        areDotsHidden: false,
      },
      render: ({ slides, aspectRatio, areArrowsHidden, areDotsHidden }) => {
        // Filter out slides with no image picked. The carousel
        // tolerates an empty array (renders null); render-time
        // filtering keeps the inspector pristine while the artist
        // is mid-edit.
        const usable = slides
          .filter((s): s is { image: ImageMetadata; caption: string } => s.image !== null)
          .map((s) => ({ image: s.image, caption: s.caption || undefined }));
        return (
          <ImageCarousel
            slides={usable}
            aspectRatio={aspectRatio}
            areArrowsHidden={areArrowsHidden}
            areDotsHidden={areDotsHidden}
          />
        );
      },
    },
  },
};
