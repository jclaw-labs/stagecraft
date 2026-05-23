/**
 * Unit coverage for the static-asset headers declared in
 * `next.config.ts`. The config is loaded as a module so we get the
 * fully-resolved `headers()` function tree and can assert against
 * the path patterns + header values directly — no Next.js dev
 * server required.
 */

import { describe, expect, it } from "vitest";

import config from "./next.config";

describe("next.config — static-asset headers", () => {
  it("declares an async headers() rule list", async () => {
    expect(typeof config.headers).toBe("function");
    const rules = await config.headers!();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it("targets the SVG upload path with the exact two-segment shape", async () => {
    // `/images/<contentSlug>/<id>/original.svg` — anything outside
    // that shape (a single-segment SVG, a /public/foo.svg etc.)
    // keeps its default headers. Locking the pattern prevents an
    // overly-permissive rewrite from sneaking in.
    const rules = await config.headers!();
    const svgRule = rules.find((r) => r.source.endsWith("original.svg"));
    expect(svgRule?.source).toBe("/images/:contentSlug/:id/original.svg");
  });

  it("sets Content-Disposition: attachment on SVGs (prevents top-level inline render)", async () => {
    // Direct top-level navigation to `/images/.../original.svg`
    // triggers a download dialog instead of inline rendering — the
    // attack vector for script-bearing SVGs (even after the
    // sanitiser strips them). `<img src="...">` ignores the
    // disposition, so the gallery flow is unaffected.
    const rules = await config.headers!();
    const svgRule = rules.find((r) => r.source.endsWith("original.svg"));
    const dispo = svgRule?.headers.find((h) => h.key === "Content-Disposition");
    expect(dispo?.value).toBe("attachment");
  });

  it("pins Content-Type: image/svg+xml + X-Content-Type-Options: nosniff", async () => {
    // Belt-and-suspenders: the explicit Content-Type prevents
    // host-level MIME-guess slips, and nosniff stops browsers
    // from second-guessing the declared type (blocking the
    // sniff-escalation-to-HTML attack class).
    const rules = await config.headers!();
    const svgRule = rules.find((r) => r.source.endsWith("original.svg"));
    const contentType = svgRule?.headers.find((h) => h.key === "Content-Type");
    expect(contentType?.value).toBe("image/svg+xml");
    const noSniff = svgRule?.headers.find((h) => h.key === "X-Content-Type-Options");
    expect(noSniff?.value).toBe("nosniff");
  });

  it("sets Cache-Control: no-transform on SVGs (CDN-rewrite defense)", async () => {
    // Some CDNs optimise SVG bytes by inlining as data URIs or
    // stripping XML declarations; `no-transform` forbids that
    // mutation. The sanitiser has already locked the content shape
    // at write time — allowing an intermediate to mutate it would
    // re-open the surface we just closed.
    const rules = await config.headers!();
    const svgRule = rules.find((r) => r.source.endsWith("original.svg"));
    const cache = svgRule?.headers.find((h) => h.key === "Cache-Control");
    expect(cache?.value).toBe("no-transform");
  });

  it("does NOT match raster image paths (jpg / png / webp / avif)", async () => {
    // Cosmetic-sanity check: the rule's `source` literally ends in
    // `original.svg`, so non-SVG raster paths can't accidentally
    // get attachment-forced (which would break the responsive
    // `<picture>` flow on the public site).
    const rules = await config.headers!();
    const sources = rules.map((r) => r.source);
    expect(sources.some((s) => s.endsWith(".jpg"))).toBe(false);
    expect(sources.some((s) => s.endsWith(".png"))).toBe(false);
    expect(sources.some((s) => s.endsWith(".webp"))).toBe(false);
    expect(sources.some((s) => s.endsWith(".avif"))).toBe(false);
  });

  it("matches the ICO upload path with nosniff but NOT attachment (favicons must render inline)", async () => {
    // ICO files lack the script-execution surface SVG has, but
    // pinning Content-Type + nosniff is defense-in-depth-
    // completeness. `Content-Disposition: attachment` would break
    // favicon use (browsers fetch `<link rel="icon">` inline; an
    // attachment header would prompt download instead), so the ICO
    // rule deliberately omits it.
    const rules = await config.headers!();
    const icoRule = rules.find((r) => r.source.endsWith("original.ico"));
    expect(icoRule?.source).toBe("/images/:contentSlug/:id/original.ico");
    const contentType = icoRule?.headers.find((h) => h.key === "Content-Type");
    expect(contentType?.value).toMatch(/^image\//);
    const noSniff = icoRule?.headers.find((h) => h.key === "X-Content-Type-Options");
    expect(noSniff?.value).toBe("nosniff");
    // Critically: NO attachment disposition (would break favicons).
    const dispo = icoRule?.headers.find((h) => h.key === "Content-Disposition");
    expect(dispo).toBeUndefined();
  });

  it("has exactly the expected rule count (lock against accidental rule sprawl)", async () => {
    // Future rule additions should be a deliberate decision —
    // updating this assertion is the cue to review whether the
    // new rule belongs.
    const rules = await config.headers!();
    expect(rules).toHaveLength(2);
  });
});
