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
 * Narrower in scope than a full iframe sanitizer: we only need the dimensions, not the full
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
 *
 * The lookbehind `(?<=\\s)` requires whitespace before the attribute
 * name — without it, `\\bwidth` would also match the `width` inside
 * `data-width="N"` (the boundary between `-` and `w` is a word
 * boundary). Every well-formed iframe attribute is preceded by
 * whitespace (between `<iframe` and the first attr, between attrs).
 */
function readNumericAttr(tag: string, name: string): number | null {
  const re = new RegExp(`(?<=\\s)${name}\\s*=\\s*["']([^"']+)["']`, "i");
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

/**
 * Return the HTML with the first iframe's dimensional attributes
 * removed. Strips both the `width="N"` / `height="N"` attributes
 * and the `width: Npx` / `height: Npx` declarations inside an
 * inline `style="..."`. Idempotent — running twice produces the
 * same output.
 *
 * EmbedResponsive calls this before wrapping in an aspect-ratio
 * container. Without it, an iframe with `style="width: 350px"`
 * keeps its inline width (higher CSS specificity than the
 * wrapper's class-based `width: 100%`), so the iframe stays
 * 350px wide inside a wrapper sized to fill its column — the
 * wrapper has the right aspect ratio but the iframe doesn't
 * fill it.
 *
 * Out-of-scope (defer until needed):
 *   - Stripping the same dimensions from non-iframe wrapper
 *     elements (Bandcamp sometimes ships a `<div>` wrapper
 *     around the iframe).
 *   - Sanitising other attributes (`onload`, `srcdoc`) — the
 *     admin-only authoring surface keeps the threat model
 *     limited, same as Embed.
 */
export function stripIframeDimensions(html: string): string {
  const iframeMatch = html.match(/<iframe\b[^>]*>/i);
  if (!iframeMatch) return html;
  const original = iframeMatch[0];
  const startIdx = iframeMatch.index ?? 0;

  let cleaned = original;

  // 1. Strip `width="N"` and `height="N"` attributes (plus their
  //    leading whitespace so we don't leave a double-space).
  cleaned = cleaned.replace(/\s+(?:width|height)\s*=\s*["'][^"']*["']/gi, "");

  // 2. Strip `width: Npx` / `height: Npx` declarations from
  //    inline `style="..."`. Re-emit the style attribute with the
  //    cleaned value; drop the attribute entirely when nothing
  //    remains.
  cleaned = cleaned.replace(
    /(\s+style\s*=\s*["'])([^"']*)(["'])/i,
    (_full, prefix: string, style: string, suffix: string) => {
      const stripped = stripDimensionsFromStyle(style);
      if (stripped.length === 0) return "";
      return `${prefix}${stripped}${suffix}`;
    },
  );

  return html.slice(0, startIdx) + cleaned + html.slice(startIdx + original.length);
}

/**
 * Remove `width: ...` / `height: ...` declarations from a CSS
 * declaration list. Mirror of the legacy template's helper of the
 * same name. Empty return means every declaration was dimensional
 * and the caller should drop the `style=""` attribute entirely.
 */
function stripDimensionsFromStyle(style: string): string {
  return style
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => {
      if (decl.length === 0) return false;
      const colonIdx = decl.indexOf(":");
      if (colonIdx === -1) return true;
      const property = decl.slice(0, colonIdx).trim().toLowerCase();
      return property !== "width" && property !== "height";
    })
    .join("; ");
}
