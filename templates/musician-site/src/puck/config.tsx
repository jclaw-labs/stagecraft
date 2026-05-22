import type { Config, Slot } from "@measured/puck";
import type { CSSProperties, ReactNode } from "react";

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
  type NewsletterService,
} from "@/components/newsletter-types";
import { extractIframeIntrinsicDimensions } from "@/lib/iframe-utils";
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

export const puckConfig: Config<BlockProps, { title: string; isSplashPage: boolean; isFooterHidden: boolean }> = {
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
    },
    defaultProps: { title: "Untitled", isSplashPage: false, isFooterHidden: false },
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
        // percentage-width iframe to zero height.
        if (resolvedRatio === null) {
          return (
            <div
              style={{ margin: "var(--space-4) 0" }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        return (
          <div
            className="stagecraft-embed-responsive"
            style={{
              margin: "var(--space-4) 0",
              aspectRatio: resolvedRatio,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
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
      // sub-blocks) — most artists use email-only signup. Extension
      // (name capture, preference dropdowns) lands in a follow-up if
      // demand surfaces.
      //
      // Form submits cross-origin to the artist's chosen provider
      // (Mailchimp / ConvertKit / Buttondown / generic). No server
      // route on this template — the no-cors fetch in
      // NewsletterSignup.tsx posts straight to the provider.
      fields: {
        service: {
          type: "select",
          label: "Newsletter provider",
          options: NEWSLETTER_SERVICES.map((s) => ({
            label: NEWSLETTER_SERVICE_LABELS[s],
            value: s,
          })),
        },
        actionUrl: {
          type: "text",
          label: "Form submission URL",
        },
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
      },
      defaultProps: {
        service: "mailchimp" satisfies NewsletterService,
        actionUrl: "",
        title: "Stay in the loop",
        emailLabel: "Email",
        submitLabel: "Subscribe",
        successMessage: "Thanks for subscribing! Check your inbox to confirm.",
      },
      render: ({ service, actionUrl, title, emailLabel, submitLabel, successMessage }) => (
        <NewsletterSignup
          service={service}
          actionUrl={actionUrl}
          title={title}
          emailLabel={emailLabel}
          submitLabel={submitLabel}
          successMessage={successMessage}
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
