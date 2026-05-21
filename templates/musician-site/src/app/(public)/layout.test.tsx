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
  it("renders the background-image style on the wrapper when set", async () => {
    await writeSite({ pageBackground: true });
    const tree = await PublicLayout({ children: null });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('background-image:url(&quot;/images/site/abc1234567890def/original.png&quot;)');
    // cover-fit, centered, fixed-attachment defaults — locked here
    // so a refactor of the wrapper style doesn't silently change the
    // legacy parity behaviour.
    expect(html).toContain("background-size:cover");
    expect(html).toContain("background-position:center");
    expect(html).toContain("background-attachment:fixed");
  });

  it("omits the background-image style when pageBackground is null", async () => {
    await writeSite({ pageBackground: false });
    const tree = await PublicLayout({ children: null });
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain("background-image");
  });
});
