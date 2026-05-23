import {
  appearanceFontFamilies,
  resolveLinkColor,
  type Appearance,
} from "@/lib/site-config-types";

type Props = {
  appearance: Appearance;
};

/**
 * Injects the appearance's color + font tokens as CSS custom properties
 * scoped to the public layout, and loads the right Google Fonts file with
 * only the weights actually used.
 *
 * Token names match `globals.css` so any inline `var(--color-*)` reference
 * in a block resolves to the artist's chosen palette automatically.
 *
 * Editor surfaces (Puck chrome, admin sidebar) sit outside this provider
 * and keep using the neutral defaults from `globals.css`.
 */
export function AppearanceStyles({ appearance }: Props) {
  const linkColor = resolveLinkColor(appearance.colors);
  const families = appearanceFontFamilies(appearance);

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
      --font-body: '${appearance.typography.bodyFont}', system-ui, sans-serif;
      --font-headings: '${appearance.typography.headingMode === "split" && appearance.typography.headingFont.length > 0 ? appearance.typography.headingFont : appearance.typography.bodyFont}', '${appearance.typography.bodyFont}', system-ui, sans-serif;
      --font-weight-body: ${appearance.typography.bodyWeights.body};
      --font-weight-body-bold: ${appearance.typography.bodyWeights.bodyBold};
      --font-weight-h1: ${appearance.typography.headingWeights.h1};
      --font-weight-h2: ${appearance.typography.headingWeights.h2};
      --font-weight-h3: ${appearance.typography.headingWeights.h3};
    }
    .stagecraft-site, .stagecraft-site body {
      background: var(--color-background);
      color: var(--color-text);
      font-family: var(--font-body);
      font-weight: var(--font-weight-body);
    }
    .stagecraft-site h1 { font-family: var(--font-headings); font-weight: var(--font-weight-h1); }
    .stagecraft-site h2 { font-family: var(--font-headings); font-weight: var(--font-weight-h2); }
    .stagecraft-site h3 { font-family: var(--font-headings); font-weight: var(--font-weight-h3); }
    .stagecraft-site a { color: var(--color-link); }
    .stagecraft-site strong, .stagecraft-site b { font-weight: var(--font-weight-body-bold); }
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
