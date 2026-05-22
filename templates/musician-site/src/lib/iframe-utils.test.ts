import { describe, expect, it } from "vitest";

import { extractIframeIntrinsicDimensions } from "./iframe-utils";

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
});
