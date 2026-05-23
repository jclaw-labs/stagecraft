/**
 * Renders the public-layout's favicon + pageBackground wiring against
 * the artist's site config. Both fields are parity additions with the
 * legacy template (`siteConfig.favicon`, `siteConfig.pageBackground`);
 * tests lock the resulting `<link rel="icon">` URL + `background-image`
 * style so a future refactor can't silently drop them.
 *
 * Uses an isolated tmpdir (matching the pattern in publish.test.ts /
 * content.test.ts) so concurrent test files can't race on the same
 * on-disk singleton.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import PublicLayout, { generateMetadata } from "./layout";
import { __resetBootstrapCacheForTests } from "@/lib/content";
import { renderToStaticMarkup } from "react-dom/server";
import { SITE_FIELD_IDS } from "@/lib/collections/seeds";

let TMP_CONTENT_DIR: string;
let SITE_ITEM_PATH: string;

const IMAGE_FIXTURE = {
  id: "abc1234567890def",
  alt: "Logo",
  width: 256,
  height: 256,
  placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
  contentSlug: "site",
  originalExt: "png",
};

/**
 * Site singleton with the two new image fields populated. Other fields
 * use the prebaked defaults — only what we're asserting matters here.
 */
function siteItemWith(opts: { favicon?: boolean; pageBackground?: boolean }) {
  const values: Record<string, unknown> = {
    [SITE_FIELD_IDS.artistName]: { type: "text", value: "Test Artist" },
    [SITE_FIELD_IDS.siteTitle]: { type: "text", value: "Test" },
    [SITE_FIELD_IDS.contactEmail]: { type: "email", value: "a@e.com" },
  };
  if (opts.favicon) {
    values[SITE_FIELD_IDS.favicon] = { type: "image", value: IMAGE_FIXTURE };
  }
  if (opts.pageBackground) {
    values[SITE_FIELD_IDS.pageBackground] = {
      type: "image",
      value: { ...IMAGE_FIXTURE, alt: "Stage" },
    };
  }
  return {
    id: "item_site",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    values,
  };
}

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-public-layout-"));
  SITE_ITEM_PATH = path.join(
    TMP_CONTENT_DIR,
    "collections/site/items/_singleton.json",
  );
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  __resetBootstrapCacheForTests();
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
  await fs.mkdir(path.dirname(SITE_ITEM_PATH), { recursive: true });
});

afterEach(async () => {
  await fs.rm(SITE_ITEM_PATH, { force: true });
});

async function writeSite(opts: { favicon?: boolean; pageBackground?: boolean }) {
  await fs.writeFile(
    SITE_ITEM_PATH,
    JSON.stringify(siteItemWith(opts), null, 2),
    "utf-8",
  );
}

describe("(public) layout — generateMetadata", () => {
  it("emits a favicon link pointing at the original upload when favicon is set", async () => {
    await writeSite({ favicon: true });
    const meta = await generateMetadata();
    expect(meta.icons).toEqual({
      icon: "/images/site/abc1234567890def/original.png",
    });
  });

  it("emits no icons override when favicon is unset (Next falls back to default)", async () => {
    await writeSite({ favicon: false });
    const meta = await generateMetadata();
    expect(meta.icons).toBeUndefined();
  });
});

describe("(public) layout — pageBackground render", () => {
  it("renders a fixed-position underlay with the largest variant URL when set", async () => {
    // Fixture width is 256 — smaller than the smallest sharp variant
    // (400) — so the underlay should fall back to the original.
    // PNG is raster but has no avif/webp variants at width 256, so
    // the `<picture>` flow degrades to the original.
    await writeSite({ pageBackground: true });
    const tree = await PublicLayout({ children: null });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('src="/images/site/abc1234567890def/original.png"');
    // Underlay choices locked here: fixed positioning (works on iOS,
    // unlike background-attachment:fixed), cover-fit via
    // object-fit, color fallback for slow / failed loads, no
    // pointer events so it can't intercept clicks.
    expect(html).toContain("position:fixed");
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("object-position:center");
    expect(html).toContain("background-color:var(--color-background)");
    expect(html).toContain("pointer-events:none");
    // background-attachment:fixed was the v0 approach; replaced by
    // the fixed-positioned underlay because iOS Safari treats the
    // attachment as `scroll`. Lock the regression out.
    expect(html).not.toContain("background-attachment:fixed");
  });

  it("emits a <picture> with avif + webp for raster variants", async () => {
    // Simulate a hero-sized upload (2000w). The sharp pipeline emits
    // 400/800/1600 widths in both webp + avif whenever source ≥
    // variant; the largest eligible here is 1600. Format negotiation
    // via `<picture>` lets avif-capable browsers (Chrome 85+, Safari
    // 16+) pick the smaller file.
    const heroSite = siteItemWith({});
    heroSite.values[SITE_FIELD_IDS.pageBackground] = {
      type: "image",
      value: { ...IMAGE_FIXTURE, width: 2000, height: 1125, originalExt: "jpg" },
    };
    await fs.writeFile(SITE_ITEM_PATH, JSON.stringify(heroSite, null, 2), "utf-8");
    const tree = await PublicLayout({ children: null });
    const html = renderToStaticMarkup(tree);
    // Both variant URLs appear — `<source>` for avif, `<img src>`
    // for the webp fallback.
    expect(html).toContain('srcSet="/images/site/abc1234567890def/1600.avif"');
    expect(html).toContain('src="/images/site/abc1234567890def/1600.webp"');
    // Original isn't referenced when a variant exists — proves the
    // variant-aware fallback ordering.
    expect(html).not.toContain("original.jpg");
  });

  it("falls back to a bare <img> with the original URL for vector formats (SVG / ICO)", async () => {
    // Vectors bypass the sharp variant pipeline — no sized webp/avif
    // on disk. The underlay skips `<picture>` entirely and serves
    // the original. Emitting a `<source type="image/avif">` pointing
    // at an SVG would mis-declare the format and confuse the
    // browser; the bare `<img>` is the right shape.
    const svgSite = siteItemWith({});
    svgSite.values[SITE_FIELD_IDS.pageBackground] = {
      type: "image",
      value: {
        ...IMAGE_FIXTURE,
        width: 1024,
        height: 1024,
        originalExt: "svg",
      },
    };
    await fs.writeFile(SITE_ITEM_PATH, JSON.stringify(svgSite, null, 2), "utf-8");
    const tree = await PublicLayout({ children: null });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("/original.svg");
    // No `<picture>` / `<source>` for vector branch.
    expect(html).not.toMatch(/<picture/);
    expect(html).not.toMatch(/<source/);
    // Defensive: even though width 1024 > some sharp variants (400 /
    // 800), the vector branch must short-circuit before that check.
    expect(html).not.toContain("1600.webp");
    expect(html).not.toContain("800.webp");
  });

  it("omits the underlay entirely when pageBackground is null", async () => {
    await writeSite({ pageBackground: false });
    const tree = await PublicLayout({ children: null });
    const html = renderToStaticMarkup(tree);
    // Underlay element carries the only `aria-hidden="true"` in the
    // layout output today; absence is the cleanest signal.
    expect(html).not.toContain('aria-hidden="true"');
    expect(html).not.toContain("object-fit:cover");
  });
});
