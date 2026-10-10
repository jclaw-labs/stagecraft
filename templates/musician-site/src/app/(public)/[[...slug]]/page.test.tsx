/**
 * Build-time entry points of the public catch-all: the set of URLs
 * `generateStaticParams` prerenders, the routing-conflict check that
 * runs there (so a conflict fails `next build`), `dynamicParams`
 * turning every other URL into a 404, and `generateMetadata`'s
 * dispatch between detail pages and pages.
 *
 * Uses an isolated tmpdir content dir, matching layout.test.tsx.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { dynamicParams, generateMetadata, generateStaticParams } from "./page";
import { writeCollectionDef, writeItem, type CollectionDef } from "@/lib/collections";
import { pageDataToItem } from "@/lib/collections/migrate-from-legacy";
import { POSTS_FIELD_IDS } from "@/lib/collections/field-ids";
import { pagesCollectionDef, postsCollectionDef } from "@/lib/collections/seeds";
import { tourDateItem, tourDatesDef } from "@/lib/collections/test-fixtures";
import { DEFAULT_SITE_CONFIG } from "@/lib/site-config-types";
import { __resetBootstrapCacheForTests } from "@/lib/content";
import { asImageId } from "@/lib/image-types";
import { emptyPageData } from "@/lib/page-data";

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-catch-all-"));
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  __resetBootstrapCacheForTests();
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
});

async function seedSite(opts: { pageSlugs: string[]; tourDefOverride?: Partial<CollectionDef> }) {
  for (const slug of opts.pageSlugs) {
    await writeItem("pages", slug, pageDataToItem(slug, emptyPageData(slug)), pagesCollectionDef);
  }
  const def = { ...tourDatesDef(), ...opts.tourDefOverride };
  await writeCollectionDef("tour-dates", def);
  await writeItem(
    "tour-dates",
    "mercury-lounge",
    tourDateItem("mercury-lounge", "2026-11-01", "Mercury Lounge", "New York"),
    def,
  );
  await writeItem(
    "tour-dates",
    "the-earl",
    tourDateItem("the-earl", "2026-11-08", "The Earl", "Atlanta"),
    def,
  );
}

const urls = (params: { slug: string[] }[]) => params.map((p) => "/" + p.slug.join("/")).sort();

describe("public catch-all — generateStaticParams", () => {
  it("lists the root, every page, and every collection item with a detail URL", async () => {
    await seedSite({ pageSlugs: ["home", "about"] });
    expect(urls(await generateStaticParams())).toEqual([
      "/",
      "/about",
      "/home",
      "/shows/mercury-lounge",
      "/shows/the-earl",
    ]);
  });

  it("skips items of a collection without detail pages", async () => {
    await seedSite({ pageSlugs: ["home"], tourDefOverride: { detailUrlPrefix: null } });
    expect(urls(await generateStaticParams())).toEqual(["/", "/home"]);
  });

  it("omits the root when there are no pages to own it", async () => {
    await seedSite({ pageSlugs: [] });
    expect(urls(await generateStaticParams())).toEqual([
      "/shows/mercury-lounge",
      "/shows/the-earl",
    ]);
  });

  it("lists every page when the pages collection def isn't on disk yet", async () => {
    // A repo without a committed `pages/_collection.json`: the def is
    // written by the first content read, which must land before the
    // defs are listed.
    await seedSite({ pageSlugs: ["home", "about"] });
    await fs.rm(path.join(TMP_CONTENT_DIR, "collections", "pages", "_collection.json"), {
      force: true,
    });
    __resetBootstrapCacheForTests();
    expect(urls(await generateStaticParams())).toEqual([
      "/",
      "/about",
      "/home",
      "/shows/mercury-lounge",
      "/shows/the-earl",
    ]);
  });

  it("throws on a routing conflict, so the build fails instead of the live site", async () => {
    // A Page slugged `shows` shadows the tour-dates `/shows` prefix.
    await seedSite({ pageSlugs: ["home", "shows"] });
    await expect(generateStaticParams()).rejects.toThrow(
      /Collection-routing conflict:\n.*"shows" shadows the "tour-dates"/,
    );
  });
});

describe("public catch-all — unknown URLs", () => {
  it("turns off dynamic params so any URL outside the static set 404s", () => {
    expect(dynamicParams).toBe(false);
  });
});

describe("public catch-all — generateMetadata", () => {
  const metadataFor = (slug: string[]) => generateMetadata({ params: Promise.resolve({ slug }) });

  // Pin the host env: a shell that exports Netlify's URL would otherwise
  // change `metadataBase`.
  beforeEach(() => {
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives a collection item's detail URL the item's own title", async () => {
    await seedSite({ pageSlugs: ["home"] });
    expect(await metadataFor(["shows", "mercury-lounge"])).toEqual({
      title: `Mercury Lounge — ${DEFAULT_SITE_CONFIG.artistName}`,
      description: DEFAULT_SITE_CONFIG.siteDescription,
    });
  });

  it("resolves a post's cover against the deployed origin", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("URL", "https://juneharlow.example");
    await seedSite({ pageSlugs: ["home"] });
    await writeCollectionDef("posts", postsCollectionDef);
    await writeItem(
      "posts",
      "behind-the-record",
      {
        id: "item_post_1",
        slug: "behind-the-record",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        values: {
          [POSTS_FIELD_IDS.title]: { type: "text", value: "Behind the Record" },
          [POSTS_FIELD_IDS.publishedAt]: { type: "date", value: "2026-04-02" },
          [POSTS_FIELD_IDS.coverImage]: {
            type: "image",
            value: {
              id: asImageId("abc1234567890def"),
              alt: "Studio shot",
              width: 1600,
              height: 900,
              placeholderDataUri: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAo=",
              contentSlug: "post",
              originalExt: "jpg",
            },
          },
        },
      },
      postsCollectionDef,
    );
    const metadata = await metadataFor(["news", "behind-the-record"]);
    expect(metadata.metadataBase?.href).toBe("https://juneharlow.example/");
    expect(metadata.openGraph?.images).toEqual([
      { url: "/images/post/abc1234567890def/1600.webp", alt: "Studio shot" },
    ]);
  });

  it("falls back to the site title for a detail URL with no item", async () => {
    await seedSite({ pageSlugs: ["home"] });
    expect((await metadataFor(["shows", "nowhere"])).title).toBe(DEFAULT_SITE_CONFIG.siteTitle);
  });

  it("keeps a page's own title", async () => {
    await seedSite({ pageSlugs: ["home", "about"] });
    expect((await metadataFor(["about"])).title).toBe(`about — ${DEFAULT_SITE_CONFIG.artistName}`);
  });

  it("reads a page through the page path, not the item path", async () => {
    // Both paths title a page by its root title; only the item path adds
    // a `metadataBase`. The pages def is on disk, as in a committed site,
    // so the URL does resolve to a Pages item.
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("URL", "https://juneharlow.example");
    await seedSite({ pageSlugs: ["home"] });
    await writeCollectionDef("pages", pagesCollectionDef);
    await writeItem("pages", "about", pageDataToItem("about", emptyPageData("About us")), pagesCollectionDef);
    expect(await metadataFor(["about"])).toStrictEqual({
      title: `About us — ${DEFAULT_SITE_CONFIG.artistName}`,
      description: DEFAULT_SITE_CONFIG.siteDescription,
    });
  });
});
