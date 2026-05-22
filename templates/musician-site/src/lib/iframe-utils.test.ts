import { describe, expect, it } from "vitest";

import {
  extractIframeIntrinsicDimensions,
  stripIframeDimensions,
} from "./iframe-utils";

describe("extractIframeIntrinsicDimensions", () => {
  it("reads width / height attributes (Bandcamp shape)", () => {
    const html = `<iframe style="border: 0" src="https://bandcamp.com/EmbeddedPlayer/..." width="350" height="470" seamless></iframe>`;
    expect(extractIframeIntrinsicDimensions(html)).toEqual({ width: 350, height: 470 });
  });

  it("reads inline style px declarations (alternative Bandcamp shape)", () => {
    const html = `<iframe style="border: 0; width: 350px; height: 470px;" src="..."></iframe>`;
    expect(extractIframeIntrinsicDimensions(html)).toEqual({ width: 350, height: 470 });
  });

  it("prefers attributes over inline style when both are present", () => {
    // Attribute wins — that's the form most platforms emit. Tied to
    // the function's documented priority order so it's deterministic.
    const html = `<iframe style="width: 100px; height: 200px" width="350" height="470" src="..."></iframe>`;
    expect(extractIframeIntrinsicDimensions(html)).toEqual({ width: 350, height: 470 });
  });

  it("returns null when width is a percentage (Spotify)", () => {
    // Spotify ships `width="100%"` which can't drive an aspect ratio
    // — there's no pixel value to compute from. EmbedResponsive
    // falls back to passthrough rendering.
    const html = `<iframe src="https://open.spotify.com/embed/..." width="100%" height="352"></iframe>`;
    expect(extractIframeIntrinsicDimensions(html)).toBeNull();
  });

  it("returns null when height is missing entirely", () => {
    const html = `<iframe src="..." width="350"></iframe>`;
    expect(extractIframeIntrinsicDimensions(html)).toBeNull();
  });

  it("returns null when there's no iframe tag", () => {
    // Defensive: artist pasted `<script>` or a `<div>` widget.
    // EmbedResponsive's caller will still render the markup
    // verbatim; we just don't get a wrapper aspect ratio.
    expect(extractIframeIntrinsicDimensions("<script>...</script>")).toBeNull();
    expect(extractIframeIntrinsicDimensions("")).toBeNull();
  });

  it("ignores width=0 / negative / non-numeric values", () => {
    expect(
      extractIframeIntrinsicDimensions(`<iframe src="..." width="0" height="100"></iframe>`),
    ).toBeNull();
    expect(
      extractIframeIntrinsicDimensions(`<iframe src="..." width="-10" height="100"></iframe>`),
    ).toBeNull();
    expect(
      extractIframeIntrinsicDimensions(`<iframe src="..." width="auto" height="100"></iframe>`),
    ).toBeNull();
  });

  it("handles single quotes around attribute values", () => {
    const html = `<iframe src='...' width='350' height='470'></iframe>`;
    expect(extractIframeIntrinsicDimensions(html)).toEqual({ width: 350, height: 470 });
  });

  it("only inspects the first iframe in the snippet", () => {
    // Defensive: someone pasted multiple iframes. Use the first
    // (most authoring UIs emit one).
    const html = `<iframe width="350" height="470"></iframe><iframe width="600" height="400"></iframe>`;
    expect(extractIframeIntrinsicDimensions(html)).toEqual({ width: 350, height: 470 });
  });

  it("accepts case-insensitive iframe / attribute names", () => {
    // HTML parses case-insensitively; some legacy snippets use
    // uppercase tags.
    const html = `<IFRAME WIDTH="350" HEIGHT="470" SRC="..."></IFRAME>`;
    expect(extractIframeIntrinsicDimensions(html)).toEqual({ width: 350, height: 470 });
  });

  it("ignores `data-width` / `data-height` attributes (regex-tightening guard)", () => {
    // Earlier impl used `\b${name}` which fired the word boundary
    // between `-` and `w`, accidentally matching `data-width=`.
    // Lookbehind requires whitespace before the attr name now.
    const html = `<iframe src="..." data-width="999" data-height="888"></iframe>`;
    expect(extractIframeIntrinsicDimensions(html)).toBeNull();
  });

  it("picks the real width/height past a `data-*` prefix", () => {
    // Defensive: if both `data-width` AND `width` are present, the
    // real attribute wins.
    const html = `<iframe data-width="999" width="350" height="470" data-height="888"></iframe>`;
    expect(extractIframeIntrinsicDimensions(html)).toEqual({ width: 350, height: 470 });
  });
});

describe("stripIframeDimensions", () => {
  it("removes the width / height attributes from the iframe tag", () => {
    const html = `<iframe src="https://bandcamp.com/x" width="350" height="470" seamless></iframe>`;
    const out = stripIframeDimensions(html);
    expect(out).not.toMatch(/\bwidth=/);
    expect(out).not.toMatch(/\bheight=/);
    // Other attributes preserved.
    expect(out).toContain('src="https://bandcamp.com/x"');
    expect(out).toContain("seamless");
  });

  it("removes width / height declarations from an inline style", () => {
    const html = `<iframe style="border: 0; width: 350px; height: 470px;" src="..."></iframe>`;
    const out = stripIframeDimensions(html);
    expect(out).not.toMatch(/width\s*:/);
    expect(out).not.toMatch(/height\s*:/);
    // `border: 0` is preserved.
    expect(out).toMatch(/style="border:\s*0"/);
  });

  it("drops the style attribute entirely when only dimensions remained", () => {
    // After stripping width + height, no other declarations are
    // left; the style attribute itself is dropped rather than
    // emitting `style=""`.
    const html = `<iframe style="width: 350px; height: 470px;" src="..."></iframe>`;
    const out = stripIframeDimensions(html);
    expect(out).not.toMatch(/style=/);
    expect(out).toContain('src="..."');
  });

  it("preserves attributes outside the iframe (e.g. wrapper text)", () => {
    const html = `before <iframe src="x" width="350" height="470"></iframe> after`;
    const out = stripIframeDimensions(html);
    expect(out).toMatch(/^before /);
    expect(out).toMatch(/ after$/);
    expect(out).not.toMatch(/\bwidth=/);
  });

  it("is a no-op when the html has no iframe", () => {
    const html = `<div>no iframe here</div>`;
    expect(stripIframeDimensions(html)).toBe(html);
  });

  it("is idempotent — running twice produces the same output", () => {
    const html = `<iframe src="x" width="350" height="470" style="width: 350px"></iframe>`;
    const once = stripIframeDimensions(html);
    const twice = stripIframeDimensions(once);
    expect(twice).toBe(once);
  });

  it("only rewrites the first iframe", () => {
    // EmbedResponsive only wraps the first iframe (matches the
    // `extractIframeIntrinsicDimensions` contract). Stripping
    // dimensions from later iframes would be misleading.
    const html = `<iframe src="a" width="100" height="100"></iframe><iframe src="b" width="200" height="200"></iframe>`;
    const out = stripIframeDimensions(html);
    // First iframe lost its width.
    expect(out.indexOf("width=")).toBeGreaterThan(out.indexOf('src="b"'));
  });

  it("preserves non-dimensional style declarations regardless of casing", () => {
    const html = `<iframe style="BORDER: 0; Width: 350Px; HEIGHT: 470px" src="..."></iframe>`;
    const out = stripIframeDimensions(html);
    // Casing in property names is normalised for the match but the
    // surviving declarations keep their original casing.
    expect(out).toMatch(/style="BORDER:\s*0"/);
    expect(out).not.toMatch(/Width:/i);
  });
});
