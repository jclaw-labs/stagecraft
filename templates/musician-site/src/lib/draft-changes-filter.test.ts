import { describe, expect, it } from "vitest";

import { type DraftChange } from "./draft-changes";
import { pendingItemSlugs } from "./draft-changes-filter";

describe("pendingItemSlugs", () => {
  it("collects item slugs for the requested collection only", () => {
    const changes: DraftChange[] = [
      { kind: "item", status: "modified", collectionSlug: "pages", itemSlug: "about", path: "a" },
      { kind: "item", status: "added", collectionSlug: "pages", itemSlug: "tour", path: "b" },
      { kind: "item", status: "modified", collectionSlug: "photos", itemSlug: "about", path: "c" },
    ];
    expect(pendingItemSlugs(changes, "pages")).toEqual(new Set(["about", "tour"]));
  });

  it("ignores changes from other collections even when the slug matches", () => {
    const changes: DraftChange[] = [
      { kind: "item", status: "modified", collectionSlug: "photos", itemSlug: "about", path: "c" },
    ];
    expect(pendingItemSlugs(changes, "pages")).toEqual(new Set());
  });

  it("skips non-item kinds (singleton / def / order / image / other)", () => {
    const changes: DraftChange[] = [
      { kind: "singleton", status: "modified", collectionSlug: "pages", path: "s" },
      { kind: "def", status: "modified", collectionSlug: "pages", path: "d" },
      { kind: "order", status: "modified", collectionSlug: "pages", path: "o" },
      { kind: "image", status: "added", contentSlug: "pages", imageId: "img", path: "i" },
      { kind: "other", status: "modified", path: "x" },
    ];
    expect(pendingItemSlugs(changes, "pages")).toEqual(new Set());
  });

  it("returns an empty set for an empty change list", () => {
    expect(pendingItemSlugs([], "pages")).toEqual(new Set());
  });

  it("accepts the loose parsed-JSON shape the Pages panel passes", () => {
    // Simulates `body.status.changes` straight off the wire: untyped,
    // possibly missing fields. The filter must tolerate it.
    const parsed = [
      { kind: "item", collectionSlug: "pages", itemSlug: "home" },
      { kind: "item", collectionSlug: "pages" }, // no itemSlug — skipped
      { kind: "item", itemSlug: "orphan" }, // no collectionSlug — skipped
    ];
    expect(pendingItemSlugs(parsed, "pages")).toEqual(new Set(["home"]));
  });

  it("dedupes when a slug appears more than once", () => {
    const changes: DraftChange[] = [
      { kind: "item", status: "added", collectionSlug: "pages", itemSlug: "home", path: "a" },
      { kind: "item", status: "modified", collectionSlug: "pages", itemSlug: "home", path: "a" },
    ];
    expect(pendingItemSlugs(changes, "pages")).toEqual(new Set(["home"]));
  });
});
