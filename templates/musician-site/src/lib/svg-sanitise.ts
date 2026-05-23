import DOMPurify from "isomorphic-dompurify";

/**
 * Maximum number of removal descriptors returned in the
 * `SanitiseSvgResult`. A pathological SVG with hundreds of removed
 * items would otherwise produce a multi-KB API response (the route
 * forwards `removed` to the client). The log-line cap is the same.
 */
const REMOVED_DESCRIPTOR_CAP = 20;

/**
 * The result of sanitising an SVG: the cleaned buffer plus a stable,
 * UI-friendly description of what DOMPurify stripped. Callers that
 * don't care about the removal summary read `.buffer`; the upload
 * route forwards `.removed` to the client so the picker can show a
 * "we stripped N items from your SVG" hint.
 *
 * `removed` is capped at `REMOVED_DESCRIPTOR_CAP` items; the cap is
 * a defensive limit, not a tamper signal — the count is still useful
 * even when truncated.
 */
export type SanitiseSvgResult = {
  buffer: Buffer;
  removed: string[];
};

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
export function sanitiseSvg(buffer: Buffer): SanitiseSvgResult {
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

  // Telemetry: log a structured warning when DOMPurify strips
  // *meaningful* content. The artist sees a different SVG on the
  // public site than the one they uploaded — "why did my drop-
  // shadow disappear" support questions land in admin logs as a
  // deliberate signal rather than a silent rewrite. The `removed`
  // array is reset per `sanitize()` call so the snapshot here is
  // just this call's removals.
  //
  // `console.warn` lands in Vercel / Netlify function logs in
  // production and the dev server in local. The same summary now
  // also rides back through the upload-image route so the picker
  // can show "we stripped N items from your SVG" inline.
  const removed = describeMeaningfulRemovals(DOMPurify.removed ?? []);
  if (removed.length > 0) {
    console.warn(
      `sanitiseSvg: stripped ${removed.length} item(s) from SVG (${buffer.length} bytes): ${summariseRemovals(removed)}`,
    );
  }

  return {
    buffer: Buffer.from(sanitisedString, "utf-8"),
    // Cap the descriptor list at a defensive ceiling so a pathological
    // upload doesn't push a multi-KB payload back through the route.
    // The log line above keeps the full count for ops correlation.
    removed: removed.slice(0, REMOVED_DESCRIPTOR_CAP),
  };
}

/**
 * jsdom (DOMPurify's parser host) wraps a bare `<svg>` input in an
 * implicit `<html><head /><body>...</body></html>`; DOMPurify then
 * "removes" the wrapper as part of producing SVG output, reporting
 * it in `removed[]`. That's a parser artefact, not a tamper signal,
 * and warning about it on every clean SVG is just noise. Filter it
 * before counting / summarising.
 *
 * The list is stable across DOMPurify + jsdom releases as of 2026,
 * but a future library upgrade introducing a new implicit wrapper
 * (`<template>` say) would re-introduce noise. Catch it via the
 * "clean SVG doesn't warn" test below.
 */
const IMPLICIT_WRAPPER_TAGS = new Set(["html", "head", "body"]);

function describeMeaningfulRemovals(removed: ReadonlyArray<unknown>): string[] {
  const result: string[] = [];
  for (const entry of removed) {
    const described = describeRemoval(entry);
    if (described === null) continue;
    result.push(described);
  }
  return result;
}

/**
 * Short, stable string identifying what DOMPurify removed — suitable
 * for a log line. Each entry in `DOMPurify.removed` carries either
 * an `element` (tag stripped) or an `attribute` (one attr stripped
 * from a surviving tag); shape is loosely typed so we unwrap
 * defensively. Returns null for parser-artefact wrappers.
 */
function describeRemoval(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const obj = entry as {
    element?: { nodeName?: unknown; localName?: unknown };
    attribute?: { name?: unknown; nodeName?: unknown };
  };
  if (obj.element) {
    const name = String(obj.element.nodeName ?? obj.element.localName ?? "").toLowerCase();
    if (!name) return null;
    if (IMPLICIT_WRAPPER_TAGS.has(name)) return null;
    return `<${name}>`;
  }
  if (obj.attribute) {
    const name = String(obj.attribute.name ?? obj.attribute.nodeName ?? "").toLowerCase();
    if (!name) return null;
    return `${name}=`;
  }
  return null;
}

/**
 * Format the pre-filtered + described removal list into a log line.
 * Capped at the first 10 entries so a SVG with hundreds of bad
 * attrs doesn't produce a multi-KB log line; anything past the cap
 * shows as `... +N more`.
 */
function summariseRemovals(removed: ReadonlyArray<string>): string {
  const cap = 10;
  const head = removed.slice(0, cap).join(", ");
  const extra = removed.length > cap ? `, ... +${removed.length - cap} more` : "";
  return head + extra;
}
