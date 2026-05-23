import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  collectionDefRepoPath,
  createItem,
  deleteItem,
  ItemExistsError,
  itemRepoPath,
  listCollectionSlugs,
  listItemSlugs,
  listItemsInOrder,
  orderRepoPath,
  readCollectionDef,
  readItem,
  readOrder,
  readSingleton,
  renameItem,
  SINGLETON_ITEM_SLUG,
  writeCollectionDef,
  writeItem,
  writeOrder,
  writeSingleton,
} from "./index";
import type { CollectionDef, Item } from "./index";
import { CURRENT_COLLECTION_SCHEMA_VERSION } from "./schema";
import { FIXTURE_TIMESTAMP, tourDateItem, tourDatesDef } from "./test-fixtures";

let TMP_CONTENT_DIR: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-collections-"));
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  // Wipe between tests so each one starts from a clean tree.
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Repo path helpers
// ---------------------------------------------------------------------------

describe("repo path helpers", () => {
  it("collectionDefRepoPath returns the canonical location", () => {
    expect(collectionDefRepoPath("tour-dates")).toBe(
      "src/content/collections/tour-dates/_collection.json",
    );
  });

  it("itemRepoPath includes the items/ directory", () => {
    expect(itemRepoPath("tour-dates", "paris-2026")).toBe(
      "src/content/collections/tour-dates/items/paris-2026.json",
    );
  });

  it("orderRepoPath uses the reserved _order filename", () => {
    expect(orderRepoPath("tour-dates")).toBe(
      "src/content/collections/tour-dates/items/_order.json",
    );
  });
});

// ---------------------------------------------------------------------------
// Collection-level
// ---------------------------------------------------------------------------

describe("collection-level operations", () => {
  it("listCollectionSlugs returns sorted slugs of every collection on disk", async () => {
    await writeCollectionDef("tour-dates", tourDatesDef());
    await writeCollectionDef("releases", { ...tourDatesDef(), slug: "releases" });
    expect(await listCollectionSlugs()).toEqual(["releases", "tour-dates"]);
  });

  it("listCollectionSlugs returns [] when no collections exist", async () => {
    expect(await listCollectionSlugs()).toEqual([]);
  });

  it("listCollectionSlugs ignores non-directory entries and badly-named dirs", async () => {
    await writeCollectionDef("tour-dates", tourDatesDef());
    await fs.mkdir(path.join(TMP_CONTENT_DIR, "collections", "Bad-Slug"), { recursive: true });
    await fs.writeFile(path.join(TMP_CONTENT_DIR, "collections", "stray.json"), "{}");
    expect(await listCollectionSlugs()).toEqual(["tour-dates"]);
  });

  it("readCollectionDef returns null for an unknown collection", async () => {
    expect(await readCollectionDef("does-not-exist")).toBeNull();
  });

  it("readCollectionDef parses a written def", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    const read = await readCollectionDef("tour-dates");
    expect(read).toEqual(def);
  });

  it("writeCollectionDef refuses a def whose slug doesn't match the target", async () => {
    await expect(
      writeCollectionDef("tour-dates", { ...tourDatesDef(), slug: "different" }),
    ).rejects.toThrow();
  });

  it("writeCollectionDef rejects an invalid def at write time", async () => {
    const bad = tourDatesDef();
    bad.fields = [
      { id: "dup", key: "a", type: "text", required: true },
      { id: "dup", key: "b", type: "text", required: true },
    ];
    bad.slugSourceFieldId = null;
    bad.defaultSort = null;
    await expect(writeCollectionDef("tour-dates", bad)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Item operations
// ---------------------------------------------------------------------------

describe("item operations", () => {
  it("listItemSlugs returns sorted slugs, excluding reserved files", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    await writeItem("tour-dates", "berlin-2026", tourDateItem("berlin-2026", "2026-07-20", "X", "Berlin"), def);
    await writeItem("tour-dates", "paris-2026", tourDateItem("paris-2026", "2026-07-15", "Y", "Paris"), def);
    await writeOrder("tour-dates", ["paris-2026", "berlin-2026"]);
    expect(await listItemSlugs("tour-dates")).toEqual(["berlin-2026", "paris-2026"]);
  });

  it("listItemSlugs returns [] when items/ doesn't exist", async () => {
    await writeCollectionDef("tour-dates", tourDatesDef());
    expect(await listItemSlugs("tour-dates")).toEqual([]);
  });

  it("readItem returns null when the item file doesn't exist", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    expect(await readItem("tour-dates", "nope", def)).toBeNull();
  });

  it("writeItem + readItem round-trips an item with its slug", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    const item = tourDateItem("paris-2026", "2026-07-15", "La Cigale", "Paris");
    await writeItem("tour-dates", "paris-2026", item, def);
    // updatedAt is rewritten to "now" on every write (see writeItem doc).
    // Compare everything except the timestamp the store owns.
    const round = await readItem("tour-dates", "paris-2026", def);
    expect(round).toMatchObject({
      id: item.id,
      slug: item.slug,
      createdAt: item.createdAt,
      values: item.values,
    });
    expect(Date.parse(round!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(item.updatedAt));
  });

  it("writeItem refreshes updatedAt to now (createdAt is preserved)", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    const item = tourDateItem("berlin-2026", "2026-07-20", "Bar", "Berlin");
    await writeItem("tour-dates", "berlin-2026", item, def);
    const after = await readItem("tour-dates", "berlin-2026", def);
    expect(after!.createdAt).toBe(item.createdAt);
    expect(after!.updatedAt).not.toBe(item.updatedAt);
  });

  it("createItem sets createdAt to now (not the caller-supplied value)", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    const item = tourDateItem("london-2026", "2026-07-25", "Bar", "London");
    await createItem("tour-dates", "london-2026", item, def);
    const after = await readItem("tour-dates", "london-2026", def);
    // createItem overrode the fixture timestamp with "now"
    expect(after!.createdAt).not.toBe(item.createdAt);
    expect(Date.parse(after!.createdAt)).toBeGreaterThanOrEqual(Date.parse(item.createdAt));
  });

  it("writeItem refuses an item whose slug doesn't match the target", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    await expect(
      writeItem(
        "tour-dates",
        "paris-2026",
        tourDateItem("different-slug", "2026-07-15", "X", "Y"),
        def,
      ),
    ).rejects.toThrow();
  });

  it("writeItem rejects an item that violates the collection schema", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    const bad: Item = {
      id: "item_bad",
      slug: "bad",
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: {
        // Missing required f_venue, f_city, f_status.
        f_date: { type: "date", value: "2026-07-15" },
      },
    };
    await expect(writeItem("tour-dates", "bad", bad, def)).rejects.toThrow();
  });

  it("createItem fails if the item already exists", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    const item = tourDateItem("paris-2026", "2026-07-15", "X", "Paris");
    await writeItem("tour-dates", "paris-2026", item, def);
    await expect(createItem("tour-dates", "paris-2026", item, def)).rejects.toThrow(
      ItemExistsError,
    );
  });

  it("deleteItem removes the file (and is a no-op on missing files)", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    await writeItem(
      "tour-dates",
      "paris-2026",
      tourDateItem("paris-2026", "2026-07-15", "X", "Paris"),
      def,
    );
    await deleteItem("tour-dates", "paris-2026");
    expect(await readItem("tour-dates", "paris-2026", def)).toBeNull();
    await deleteItem("tour-dates", "paris-2026");
  });

  describe("renameItem", () => {
    it("renames the file, preserves the item's id, and removes the old slug", async () => {
      const def = tourDatesDef();
      await writeCollectionDef("tour-dates", def);
      const item = tourDateItem("paris-2026", "2026-07-15", "La Cigale", "Paris");
      await writeItem("tour-dates", "paris-2026", item, def);

      const renamed = await renameItem("tour-dates", "paris-2026", "paris-night", def);
      expect(renamed.id).toBe(item.id);
      expect(renamed.slug).toBe("paris-night");
      expect(await readItem("tour-dates", "paris-2026", def)).toBeNull();
      expect((await readItem("tour-dates", "paris-night", def))?.id).toBe(item.id);
    });

    it("updates _order.json when the collection uses manual ordering", async () => {
      const def: CollectionDef = { ...tourDatesDef(), defaultSort: { mode: "manual" } };
      await writeCollectionDef("tour-dates", def);
      await writeItem(
        "tour-dates",
        "paris-2026",
        tourDateItem("paris-2026", "2026-07-15", "X", "Paris"),
        def,
      );
      await writeItem(
        "tour-dates",
        "berlin-2026",
        tourDateItem("berlin-2026", "2026-07-20", "Y", "Berlin"),
        def,
      );
      await writeOrder("tour-dates", ["paris-2026", "berlin-2026"]);

      await renameItem("tour-dates", "paris-2026", "paris-night", def);
      expect(await readOrder("tour-dates")).toEqual(["paris-night", "berlin-2026"]);
    });

    it("leaves _order.json alone when the collection isn't manually ordered", async () => {
      // tourDatesDef defaults to fieldSort, not manual. The rename still
      // succeeds; the (nonexistent) order file shouldn't get conjured up.
      const def = tourDatesDef();
      await writeCollectionDef("tour-dates", def);
      await writeItem(
        "tour-dates",
        "paris-2026",
        tourDateItem("paris-2026", "2026-07-15", "X", "Paris"),
        def,
      );
      await renameItem("tour-dates", "paris-2026", "paris-night", def);
      expect(await readOrder("tour-dates")).toBeNull();
    });

    it("throws ItemExistsError if the new slug already exists", async () => {
      const def = tourDatesDef();
      await writeCollectionDef("tour-dates", def);
      await writeItem(
        "tour-dates",
        "paris-2026",
        tourDateItem("paris-2026", "2026-07-15", "X", "Paris"),
        def,
      );
      await writeItem(
        "tour-dates",
        "berlin-2026",
        tourDateItem("berlin-2026", "2026-07-20", "Y", "Berlin"),
        def,
      );
      await expect(
        renameItem("tour-dates", "paris-2026", "berlin-2026", def),
      ).rejects.toThrow(ItemExistsError);
      // Old slug should still be readable — no partial state.
      expect(await readItem("tour-dates", "paris-2026", def)).not.toBeNull();
    });

    it("throws when the source slug doesn't exist", async () => {
      const def = tourDatesDef();
      await writeCollectionDef("tour-dates", def);
      await expect(
        renameItem("tour-dates", "ghost", "phantom", def),
      ).rejects.toThrow(/no item/);
    });

    it("throws when old and new slugs are identical", async () => {
      const def = tourDatesDef();
      await writeCollectionDef("tour-dates", def);
      await writeItem(
        "tour-dates",
        "paris-2026",
        tourDateItem("paris-2026", "2026-07-15", "X", "Paris"),
        def,
      );
      await expect(
        renameItem("tour-dates", "paris-2026", "paris-2026", def),
      ).rejects.toThrow(/must differ/);
    });
  });

  it("readItem strips values for fields that no longer exist on the schema", async () => {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    // Write file directly so we can include a value for a field id that
    // the current schema doesn't know about.
    const itemPath = path.join(
      TMP_CONTENT_DIR,
      "collections",
      "tour-dates",
      "items",
      "paris-2026.json",
    );
    await fs.mkdir(path.dirname(itemPath), { recursive: true });
    await fs.writeFile(
      itemPath,
      JSON.stringify({
        id: "item_p",
        createdAt: FIXTURE_TIMESTAMP,
        updatedAt: FIXTURE_TIMESTAMP,
        values: {
          f_date: { type: "date", value: "2026-07-15" },
          f_venue: { type: "text", value: "X" },
          f_city: { type: "text", value: "Paris" },
          f_status: { type: "select", value: "on_sale" },
          f_removed: { type: "text", value: "stale" },
        },
      }),
    );
    const read = await readItem("tour-dates", "paris-2026", def);
    expect(read?.values).not.toHaveProperty("f_removed");
    expect(read?.values).toHaveProperty("f_venue");
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe("listItemsInOrder", () => {
  async function seed() {
    const def = tourDatesDef();
    await writeCollectionDef("tour-dates", def);
    await writeItem(
      "tour-dates",
      "berlin-2026",
      tourDateItem("berlin-2026", "2026-07-20", "Bar", "Berlin"),
      def,
    );
    await writeItem(
      "tour-dates",
      "paris-2026",
      tourDateItem("paris-2026", "2026-07-15", "Foo", "Paris"),
      def,
    );
    await writeItem(
      "tour-dates",
      "london-2026",
      tourDateItem("london-2026", "2026-07-25", "Baz", "London"),
      def,
    );
    return def;
  }

  it("fieldSort asc orders by the field value", async () => {
    const def = await seed();
    const items = await listItemsInOrder("tour-dates", def);
    expect(items.map((i) => i.slug)).toEqual(["paris-2026", "berlin-2026", "london-2026"]);
  });

  it("fieldSort desc reverses the order", async () => {
    const def = await seed();
    def.defaultSort = { mode: "fieldSort", fieldId: "f_date", direction: "desc" };
    const items = await listItemsInOrder("tour-dates", def);
    expect(items.map((i) => i.slug)).toEqual(["london-2026", "berlin-2026", "paris-2026"]);
  });

  it("manual sort respects _order.json, with missing items at the end (alpha)", async () => {
    const def = await seed();
    def.defaultSort = { mode: "manual" };
    await writeOrder("tour-dates", ["london-2026", "paris-2026"]);
    const items = await listItemsInOrder("tour-dates", def);
    expect(items.map((i) => i.slug)).toEqual([
      "london-2026",
      "paris-2026",
      "berlin-2026", // not in order file → end, alpha
    ]);
  });

  it("manual sort with no _order.json falls back to alpha", async () => {
    const def = await seed();
    def.defaultSort = { mode: "manual" };
    const items = await listItemsInOrder("tour-dates", def);
    expect(items.map((i) => i.slug)).toEqual(["berlin-2026", "london-2026", "paris-2026"]);
  });

  it("null defaultSort orders alphabetically by slug", async () => {
    const def = await seed();
    def.defaultSort = null;
    const items = await listItemsInOrder("tour-dates", def);
    expect(items.map((i) => i.slug)).toEqual(["berlin-2026", "london-2026", "paris-2026"]);
  });
});

describe("ordering files", () => {
  it("readOrder returns null when _order.json doesn't exist", async () => {
    await writeCollectionDef("tour-dates", tourDatesDef());
    expect(await readOrder("tour-dates")).toBeNull();
  });

  it("writeOrder + readOrder round-trips", async () => {
    await writeCollectionDef("tour-dates", tourDatesDef());
    await writeOrder("tour-dates", ["a", "b", "c"]);
    expect(await readOrder("tour-dates")).toEqual(["a", "b", "c"]);
  });

  it("writeOrder rejects invalid slugs", async () => {
    await writeCollectionDef("tour-dates", tourDatesDef());
    await expect(writeOrder("tour-dates", ["NOT-VALID"])).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

describe("singletons", () => {
  function siteSettingsDef(): CollectionDef {
    return {
      schemaVersion: CURRENT_COLLECTION_SCHEMA_VERSION,
      slug: "site",
      singularName: "site settings",
      pluralName: "site settings",
      fields: [
        { id: "f_name", key: "artistName", type: "text", required: true },
      ],
      slugSourceFieldId: null,
      detailUrlPrefix: null,
      defaultSort: null,
      itemTemplate: null,
      detailTemplate: null,
      listTemplate: null,
      isSingleton: true,
    };
  }

  it("write and read a singleton (timestamps are normalised on write)", async () => {
    const def = siteSettingsDef();
    await writeCollectionDef("site", def);
    const item: Item = {
      id: "item_site",
      slug: SINGLETON_ITEM_SLUG,
      createdAt: FIXTURE_TIMESTAMP,
      updatedAt: FIXTURE_TIMESTAMP,
      values: { f_name: { type: "text", value: "Test Artist" } },
    };
    await writeSingleton("site", item, def);
    const round = await readSingleton("site", def);
    expect(round).toMatchObject({ id: item.id, slug: item.slug, values: item.values });
    // updatedAt was rewritten to "now" — it must parse as a valid date
    // and be no older than the original.
    expect(Date.parse(round!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(FIXTURE_TIMESTAMP));
  });

  it("readSingleton returns null when no singleton exists yet", async () => {
    const def = siteSettingsDef();
    await writeCollectionDef("site", def);
    expect(await readSingleton("site", def)).toBeNull();
  });
});
