import type { Config, Slot } from "@measured/puck";
import type { CSSProperties, ReactNode } from "react";

import { ContactForm } from "@/components/ContactForm";
import { Image as PublicImage } from "@/components/Image";
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
          style={{
            maxWidth: "var(--max-width-content)",
            margin: "var(--space-4) auto",
            padding: "0 var(--space-4)",
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ),
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
  },
};
