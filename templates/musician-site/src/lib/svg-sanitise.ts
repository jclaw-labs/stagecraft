import DOMPurify from "isomorphic-dompurify";

/**
 * Strip executable content from an uploaded SVG before it lands on
 * disk. Runs at upload time inside `processImage` / `generateImage
 * Variants` so the public-served file never carries an unsanitised
 * payload.
 *
 * Threat model
 * ------------
 * SVGs are XML documents the browser parses with the same JS
 * privileges as HTML when fetched directly (top-level navigation
 * to `/images/.../original.svg`). A malicious SVG with `<script>`
 * tags, `on*` event handlers, `javascript:` URLs, or external
 * `<foreignObject>` content can run code in the artist's own
 * origin — which carries the magic-link session cookie. The
 * upload endpoint is admin-only, so the practical attack today is
 * "the artist uploaded a `<script>`-bearing SVG knowingly," but:
 *
 *   - The artist may upload an SVG from a third party (vector
 *     stock site, brand asset bundle) without realising it carries
 *     active content.
 *   - Future contributor / fan-submitted upload surfaces open the
 *     door wider.
 *
 * Defense-in-depth: sanitise on the way in. A future
 * `Content-Disposition: attachment` header on raw SVG responses
 * would prevent top-level navigation rendering entirely; that's a
 * separate Next.js middleware change.
 *
 * Implementation
 * --------------
 * `isomorphic-dompurify` wraps DOMPurify with a jsdom-backed
 * window so the sanitiser runs server-side. Configured with the
 * SVG profile (`USE_PROFILES: { svg: true, svgFilters: true }`)
 * which whitelists the SVG element / attribute set and removes
 * everything else. The SVG filters profile retains
 * `<feGaussianBlur>` etc. — common in artist-produced SVGs —
 * without re-opening the script vector.
 *
 * `FORBID_TAGS: ["script"]` is redundant with the SVG profile but
 * documents the intent explicitly. `FORBID_ATTR: ["onload", ...]`
 * is the belt-and-suspenders attribute-handler block; DOMPurify
 * also strips `on*` by default but pinning a few common names
 * surfaces in code review what we care about.
 */
export function sanitiseSvg(buffer: Buffer): Buffer {
  // Defensive: the pipeline only calls this for `originalExt === "svg"`,
  // but a misconfigured caller passing binary bytes (PNG mis-routed
  // here, say) would silently produce ASCII-stripped junk. Surface
  // the misuse as a thrown error instead.
  const text = buffer.toString("utf-8");
  if (text.trimStart().length === 0) {
    throw new Error("sanitiseSvg: empty buffer");
  }
  if (!text.trimStart().startsWith("<")) {
    throw new Error("sanitiseSvg: input does not look like XML/SVG");
  }

  const sanitisedString = DOMPurify.sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // `foreignObject` is allowed by DOMPurify's SVG profile but is
    // an HTML-in-SVG escape hatch (can embed `<iframe>` etc.) — the
    // ONE meaningful addition this `FORBID_TAGS` list makes over the
    // profile's defaults. `script` is already forbidden by the SVG
    // profile and listed here for documentation only.
    FORBID_TAGS: ["script", "foreignObject"],
    // DOMPurify's SVG profile uses an attribute whitelist that does
    // NOT include any `on*` event handlers, so these are already
    // stripped. Listing them here documents intent and surfaces in
    // code review what we explicitly care about. New handler names
    // (touchstart, pointermove, wheel, etc.) land at the same
    // cadence as the spec; the profile's allowlist catches them
    // automatically, so this list doesn't need to be exhaustive.
    FORBID_ATTR: [
      "onload",
      "onerror",
      "onclick",
      "onmouseover",
      "onfocus",
      "onblur",
    ],
  });
  return Buffer.from(sanitisedString, "utf-8");
}
