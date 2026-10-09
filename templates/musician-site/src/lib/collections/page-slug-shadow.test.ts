import { describe, expect, it } from "vitest";

import { pageSlugShadowError } from "./page-slug-shadow";
import type { ReadStore } from "./read-store";
import type { CollectionDef } from "./schema";
import { PREBAKED_COLLECTIONS } from "./seeds";

const PODCASTS_DEF: CollectionDef = {
  schemaVersion: 1,
  slug: "podcasts",
  singularName: "podcast",
  pluralName: "podcasts",
  fields: [{ id: "f_title", key: "title", type: "text", required: true }],
  slugSourceFieldId: "f_title",
  detailUrlPrefix: "/episodes",
  defaultSort: null,
  itemTemplate: null,
  detailTemplate: null,
  listTemplate: null,
  isSingleton: false,
} as CollectionDef;

/**
 * A store holding exactly `defs` on disk. `listed` adds slugs the
 * store lists but can't read (a def file that vanished mid-request).
 */
function storeWith(defs: CollectionDef[], listed: string[] = []): ReadStore {
  const bySlug = new Map(defs.map((d) => [d.slug, d]));
  return {
    listCollectionSlugs: async () => [...bySlug.keys(), ...listed],
    readCollectionDef: async (slug: string) => bySlug.get(slug) ?? null,
  } as Partial<ReadStore> as ReadStore;
}

const ALL_PREBAKED = Object.values(PREBAKED_COLLECTIONS);

describe("pageSlugShadowError", () => {
  it("returns null for a slug that shadows no prefix", async () => {
    expect(await pageSlugShadowError(storeWith(ALL_PREBAKED), "about")).toBeNull();
  });

  it.each([
    ["news", "posts", "/news"],
    ["releases", "releases", "/releases"],
    ["shows", "tour-dates", "/shows"],
  ])("names the collection and prefix %s shadows", async (slug, collectionSlug, prefix) => {
    expect(await pageSlugShadowError(storeWith(ALL_PREBAKED), slug)).toBe(
      `Cannot use slug "${slug}" — it shadows the "${collectionSlug}" collection's URL prefix "${prefix}". Pick a different slug.`,
    );
  });

  it("falls back to the prebaked defs when none are on disk", async () => {
    const error = await pageSlugShadowError(storeWith([]), "news");
    expect(error).toContain('"posts"');
    expect(error).toContain('"/news"');
  });

  it("checks custom collections on disk", async () => {
    const error = await pageSlugShadowError(storeWith([PODCASTS_DEF]), "episodes");
    expect(error).toContain('"podcasts"');
    expect(error).toContain('"/episodes"');
  });

  it("prefers the on-disk def over the prebaked one with the same slug", async () => {
    const posts = PREBAKED_COLLECTIONS.posts as CollectionDef;
    const store = storeWith([{ ...posts, detailUrlPrefix: "/blog" }]);
    expect(await pageSlugShadowError(store, "news")).toBeNull();
    expect(await pageSlugShadowError(store, "blog")).toContain('"/blog"');
  });

  it("skips a listed collection whose def can't be read", async () => {
    const store = storeWith([PODCASTS_DEF], ["gone"]);
    expect(await pageSlugShadowError(store, "gone")).toBeNull();
    expect(await pageSlugShadowError(store, "episodes")).toContain('"podcasts"');
  });

  it("ignores collections without a detail prefix", async () => {
    // `pages` itself is prebaked with detailUrlPrefix "/" and the
    // singletons with null; neither claims a top-level slug.
    expect(await pageSlugShadowError(storeWith(ALL_PREBAKED), "site")).toBeNull();
    expect(await pageSlugShadowError(storeWith(ALL_PREBAKED), "pages")).toBeNull();
  });
});
