/**
 * Build-time entry points of the public catch-all: the set of URLs
 * `generateStaticParams` prerenders, the routing-conflict check that
 * runs there (so a conflict fails `next build`), and `dynamicParams`
 * turning every other URL into a 404.
 *
 * Uses an isolated tmpdir content dir, matching layout.test.tsx.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { dynamicParams, generateStaticParams } from "./page";
import {
  getFsReadStore,
  writeCollectionDef,
  writeItem,
  type CollectionDef,
} from "@/lib/collections";
import { tourDateItem, tourDatesDef } from "@/lib/collections/test-fixtures";
import { __resetBootstrapCacheForTests, emptyPageData, writePage } from "@/lib/content";

let TMP_CONTENT_DIR: string;
const store = getFsReadStore();

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
    await writePage(slug, emptyPageData(slug), store);
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
    await fs.rm(path.join(TMP_CONTENT_DIR, "collections", "pages", "_collection.json"));
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
