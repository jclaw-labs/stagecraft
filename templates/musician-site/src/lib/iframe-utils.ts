/**
 * Tiny iframe attribute parser. The EmbedResponsive block's "auto"
 * aspect-ratio mode reads the iframe's intrinsic `width` / `height`
 * to compute a wrapper aspect-ratio (so a Bandcamp `width="350"
 * height="470"` snippet renders as a 350:470 box that scales with
 * its column).
 *
 * Pure regex parsing — keep it deliberately limited. No DOMParser
 * (server-runtime safe), no nested-tag handling (artists paste
 * single-iframe snippets from "Share / Embed" UIs). When the regex
 * can't find both dimensions, return null and the caller falls
 * back to passthrough rendering (no wrapper).
 *
 * Same intent as the legacy template's `extractIframe` helper
 * (`templates/musician-site-legacy/.../Embed/extractIframe.ts`) but
 * narrower in scope: we only need the dimensions, not the full
 * attribute spread + sanitization (the new template's Embed renders
 * with `dangerouslySetInnerHTML` because the admin-only auth limits
 * the threat surface — same trade documented in `puck/config.tsx`).
 */

export type IframeIntrinsicDimensions = {
  width: number;
  height: number;
};

/**
 * Return the iframe's intrinsic pixel dimensions when both are
 * declarable. Sources, in priority order:
 *
 *   1. `width="N"` + `height="N"` attributes (Bandcamp, YouTube).
 *   2. `style="width: Npx; height: Npx"` inline declarations.
 *
 * Returns null when either dimension is missing or expressed in a
 * non-pixel unit (Spotify's `width="100%"`, Vimeo's `width: 100%`).
 * The EmbedResponsive caller treats null as "no aspect ratio
 * derivable" → fall back to passthrough.
 */
export function extractIframeIntrinsicDimensions(
  html: string,
): IframeIntrinsicDimensions | null {
  const iframeMatch = html.match(/<iframe\b[^>]*>/i);
  if (!iframeMatch) return null;
  const tag = iframeMatch[0];

  // Attribute form: width="350" height="470".
  const widthAttr = readNumericAttr(tag, "width");
  const heightAttr = readNumericAttr(tag, "height");
  if (widthAttr !== null && heightAttr !== null) {
    return { width: widthAttr, height: heightAttr };
  }

  // Inline-style form: style="width: 350px; height: 470px".
  const widthStyle = readNumericStylePx(tag, "width");
  const heightStyle = readNumericStylePx(tag, "height");
  if (widthStyle !== null && heightStyle !== null) {
    return { width: widthStyle, height: heightStyle };
  }

  return null;
}

/**
 * Return `width="<number>"` parsed as a number. Skips non-numeric
 * values (`"100%"`, `"auto"`) — they're not intrinsic pixel
 * dimensions and can't drive an aspect-ratio wrapper.
 */
function readNumericAttr(tag: string, name: string): number | null {
  // `\b` to avoid matching `something_width`. Allow either quote.
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const match = tag.match(re);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Return a pixel value from the inline `style="..."` attribute.
 * Bandcamp's snippet is `style="border: 0; width: 350px; height: 470px;"`.
 */
function readNumericStylePx(tag: string, prop: string): number | null {
  const styleMatch = tag.match(/\bstyle\s*=\s*["']([^"']*)["']/i);
  if (!styleMatch) return null;
  const style = styleMatch[1];
  const propRe = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.]+)\\s*px`, "i");
  const match = style?.match(propRe);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
