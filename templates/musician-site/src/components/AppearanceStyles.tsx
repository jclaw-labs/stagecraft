import {
  appearanceFontFamilies,
  resolveLinkColor,
  designSchema,
  type Appearance,
  type Design,
} from "@/lib/site-config-types";
import { buildFontStack } from "@/lib/google-fonts";

type Props = {
  appearance: Appearance;
};

// Named-step → concrete-value lookups for the design tokens. Kept here (not in
// the schema) so the schema stays declarative and the CSS mapping lives next
// to where it's emitted.
const SPACE_SCALE: Record<Design["density"], string> = {
  compact: "0.82",
  comfortable: "1",
  spacious: "1.25",
};
// Gap between adjacent plain sections (Section padding is half of this per
// side). Tuned tighter than the comps' first cut, which read as too airy.
const SECTION_SPACE: Record<Design["density"], string> = {
  compact: "2rem",
  comfortable: "3rem",
  spacious: "4.5rem",
};
const CONTENT_MEASURE: Record<Design["contentWidth"], string> = {
  narrow: "40rem",
  medium: "52rem",
  wide: "68rem",
};
const GUTTER: Record<Design["gutter"], string> = {
  tight: "0.5rem",
  normal: "1rem",
  airy: "1.75rem",
};
const RADIUS: Record<Design["radius"], string> = {
  sharp: "0px",
  soft: "0.5rem",
  round: "1.25rem",
};
const RADIUS_LG: Record<Design["radius"], string> = {
  sharp: "0px",
  soft: "1rem",
  round: "2rem",
};
const BTN_RADIUS: Record<Design["buttonShape"], string> = {
  square: "0px",
  rounded: "0.5rem",
  pill: "999px",
};
const SHADOW: Record<Design["shadowStyle"], string> = {
  none: "none",
  soft: "0 18px 40px -24px rgba(0, 0, 0, 0.28)",
  glow: "0 20px 60px -18px rgba(0, 0, 0, 0.5)",
  "hard-offset": "6px 6px 0 currentColor",
};
const RULE_WIDTH: Record<Design["ruleStyle"], string> = {
  none: "0px",
  hairline: "1px",
  bold: "3px",
  accent: "2px",
};
const IMG_RADIUS: Record<Design["imageTreatment"], string> = {
  plain: "0px",
  rounded: "1rem",
  framed: "0.25rem",
};
// Matte "frame" around images: framed gets padding + a border + a surface
// mat; plain/rounded get none (radius alone via --img-radius).
const IMG_FRAME: Record<Design["imageTreatment"], { pad: string; frame: string; bg: string }> = {
  plain: { pad: "0px", frame: "none", bg: "transparent" },
  rounded: { pad: "0px", frame: "none", bg: "transparent" },
  framed: { pad: "var(--space-2)", frame: "1px solid var(--color-border)", bg: "var(--color-surface)" },
};
// Theme button fill style — drives the *primary* button's look. Outline /
// underline reference the accent colour so the CTA still reads as accented.
const BUTTON_FILL: Record<
  Design["buttonFill"],
  { bg: string; fg: string; border: string; decoration: string }
> = {
  solid: {
    bg: "var(--color-accent)",
    fg: "var(--color-on-accent)",
    border: "var(--color-accent)",
    decoration: "none",
  },
  outline: {
    bg: "transparent",
    fg: "var(--color-accent)",
    border: "var(--color-accent)",
    decoration: "none",
  },
  underline: {
    bg: "transparent",
    fg: "var(--color-accent)",
    border: "transparent",
    decoration: "underline",
  },
};
// Gallery layout is structural (grid vs multi-column), so it can't be a
// single value-substitution var like the others. `grid` is the globals.css
// default; `portrait` / `masonry` ship as scoped overrides emitted below.
const GALLERY_LAYOUT_CSS: Record<Design["galleryLayout"], string> = {
  grid: "",
  portrait: `
    .stagecraft-site [data-gallery-item] { aspect-ratio: 3 / 4; }
  `,
  masonry: `
    .stagecraft-site [data-gallery] { display: block; columns: 200px; }
    .stagecraft-site [data-gallery-item] {
      aspect-ratio: auto;
      break-inside: avoid;
      margin: 0 0 var(--gutter);
    }
    .stagecraft-site [data-gallery-item] > *,
    .stagecraft-site [data-gallery-item] picture,
    .stagecraft-site [data-gallery-item] img { height: auto; }
  `,
};
const TRACKING_HEADING: Record<Design["headingTracking"], string> = {
  tight: "-0.02em",
  normal: "0",
  wide: "0.1em",
};
const SCALE_DISPLAY: Record<Design["headingScale"], string> = {
  modest: "0.92",
  balanced: "1.1",
  dramatic: "1.4",
};

/**
 * Injects the appearance's color + font + design tokens as CSS custom
 * properties scoped to the public layout, and loads the right Google Fonts
 * file with only the weights actually used.
 *
 * Token names match `globals.css` so any inline `var(--*)` reference in a
 * block resolves to the artist's chosen theme automatically. Editor surfaces
 * (Puck chrome, admin sidebar) sit outside this provider and keep using the
 * neutral defaults from `globals.css`.
 */
export function AppearanceStyles({ appearance }: Props) {
  const linkColor = resolveLinkColor(appearance.colors);
  const families = appearanceFontFamilies(appearance);
  // Parse (not shallow-merge) so nested defaults (e.g. accentGradient) always
  // fill — robust against partial/legacy design objects.
  const design: Design = designSchema.parse(appearance.design ?? {});
  const displayFont = appearance.typography.displayFont ?? "";

  // Build a Google Fonts URL that loads each family with the union of its
  // requested weights — minimises bytes shipped to the browser.
  const fontsUrl = families.length
    ? `https://fonts.googleapis.com/css2?${families
        .map(
          (f) =>
            `family=${encodeURIComponent(f.family).replace(/%20/g, "+")}:wght@${f.weights.join(";")}`,
        )
        .join("&")}&display=swap`
    : null;

  const onAccent = design.onAccent.length > 0 ? design.onAccent : appearance.colors.surface;
  const grad = design.accentGradient;
  const accentImage =
    design.accentMode === "gradient" && grad.from.length > 0
      ? `linear-gradient(120deg, ${grad.from}${grad.via.length > 0 ? `, ${grad.via}` : ""}, ${
          grad.to.length > 0 ? grad.to : grad.from
        })`
      : `linear-gradient(${appearance.colors.accent}, ${appearance.colors.accent})`;
  const ruleColor =
    design.ruleStyle === "accent" ? appearance.colors.accent : appearance.colors.border;
  const footer =
    design.footerStyle === "inverse"
      ? { bg: appearance.colors.text, text: appearance.colors.background }
      : design.footerStyle === "accent"
        ? { bg: appearance.colors.accent, text: onAccent }
        : { bg: appearance.colors.surface, text: appearance.colors.text };
  const displayStack =
    displayFont.length > 0 ? `'${displayFont}', var(--font-headings)` : "var(--font-headings)";

  // Keep a `system-ui` step but end the stack with the family's *category*
  // generic (serif / monospace / cursive) instead of a blanket sans-serif —
  // so a serif body font doesn't flash sans while its webfont loads.
  // buildFontStack returns "'Family', <generic>"; we splice system-ui between.
  const fontStack = (family: string): string => {
    const built = buildFontStack(family);
    if (!built) return "system-ui, sans-serif";
    const [familyName, generic] = built.split(", ");
    return `${familyName}, system-ui, ${generic}`;
  };
  const headingFamily =
    appearance.typography.headingMode === "split" &&
    appearance.typography.headingFont.length > 0
      ? appearance.typography.headingFont
      : appearance.typography.bodyFont;

  const css = `
    :root {
      --color-primary: ${appearance.colors.primary};
      --color-secondary: ${appearance.colors.secondary};
      --color-accent: ${appearance.colors.accent};
      --color-link: ${linkColor};
      --color-background: ${appearance.colors.background};
      --color-surface: ${appearance.colors.surface};
      --color-text: ${appearance.colors.text};
      --color-text-muted: ${appearance.colors.textMuted};
      --color-border: ${appearance.colors.border};
      --color-action: ${appearance.colors.accent};
      --color-action-fg: ${appearance.colors.surface};
      --color-on-accent: ${onAccent};
      --gradient-accent: ${accentImage};
      --font-body: ${fontStack(appearance.typography.bodyFont)};
      --font-headings: ${fontStack(headingFamily)};
      --font-display: ${displayStack};
      --font-weight-body: ${appearance.typography.bodyWeights.body};
      --font-weight-body-bold: ${appearance.typography.bodyWeights.bodyBold};
      --font-weight-h1: ${appearance.typography.headingWeights.h1};
      --font-weight-h2: ${appearance.typography.headingWeights.h2};
      --font-weight-h3: ${appearance.typography.headingWeights.h3};
      --space-scale: ${SPACE_SCALE[design.density]};
      --section-space: ${SECTION_SPACE[design.density]};
      --content-measure: ${CONTENT_MEASURE[design.contentWidth]};
      --content-align: ${design.sectionAlign};
      --gutter: ${GUTTER[design.gutter]};
      --radius-theme: ${RADIUS[design.radius]};
      --radius-theme-lg: ${RADIUS_LG[design.radius]};
      --btn-radius: ${BTN_RADIUS[design.buttonShape]};
      --shadow-theme: ${SHADOW[design.shadowStyle]};
      --rule-width: ${RULE_WIDTH[design.ruleStyle]};
      --rule-color: ${ruleColor};
      --img-radius: ${IMG_RADIUS[design.imageTreatment]};
      --img-pad: ${IMG_FRAME[design.imageTreatment].pad};
      --img-frame: ${IMG_FRAME[design.imageTreatment].frame};
      --img-frame-bg: ${IMG_FRAME[design.imageTreatment].bg};
      --btn-bg: ${BUTTON_FILL[design.buttonFill].bg};
      --btn-fg: ${BUTTON_FILL[design.buttonFill].fg};
      --btn-border: ${BUTTON_FILL[design.buttonFill].border};
      --btn-decoration: ${BUTTON_FILL[design.buttonFill].decoration};
      --tracking-heading: ${TRACKING_HEADING[design.headingTracking]};
      --heading-transform: ${design.headingCase === "upper" ? "uppercase" : "none"};
      --scale-display: ${SCALE_DISPLAY[design.headingScale]};
      --footer-bg: ${footer.bg};
      --footer-text: ${footer.text};
    }
    .stagecraft-site, .stagecraft-site body {
      background: var(--color-background);
      color: var(--color-text);
      font-family: var(--font-body);
      font-weight: var(--font-weight-body);
    }
    .stagecraft-site h1 {
      font-family: var(--font-display, var(--font-headings));
      font-weight: var(--font-weight-h1);
      font-size: calc(clamp(2rem, 5.5vw, 3.25rem) * var(--scale-display, 1));
    }
    .stagecraft-site h2 {
      font-family: var(--font-headings);
      font-weight: var(--font-weight-h2);
      font-size: calc(clamp(1.5rem, 3.2vw, 2rem) * var(--scale-display, 1));
    }
    .stagecraft-site h3 {
      font-family: var(--font-headings);
      font-weight: var(--font-weight-h3);
      font-size: calc(clamp(1.15rem, 2vw, 1.4rem) * var(--scale-display, 1));
    }
    .stagecraft-site h1, .stagecraft-site h2, .stagecraft-site h3 {
      text-transform: var(--heading-transform);
      letter-spacing: var(--tracking-heading);
      line-height: var(--line-height-heading);
    }
    .stagecraft-site a { color: var(--color-link); }
    .stagecraft-site strong, .stagecraft-site b { font-weight: var(--font-weight-body-bold); }
    ${GALLERY_LAYOUT_CSS[design.galleryLayout]}
  `;

  return (
    <>
      {fontsUrl ? (
        <link rel="stylesheet" href={fontsUrl} />
      ) : null}
      {/* dangerouslySetInnerHTML is intentional — we're emitting computed
          CSS from validated, server-known values; this is the same pattern
          Next.js's <Script>/<Style> serialisation uses. */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
    </>
  );
}
