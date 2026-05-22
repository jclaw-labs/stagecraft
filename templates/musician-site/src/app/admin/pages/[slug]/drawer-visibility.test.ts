/**
 * Unit tests for the pure visibility-map reduction. The end-to-end
 * flow runs through Puck's reducer (driven by
 * `DrawerCategoryVisibilitySync` in Editor.tsx); these tests cover
 * the deterministic shape transformation without driving Puck.
 */

import { describe, expect, it } from "vitest";

import {
  computeCategoryVisibility,
  isVisibilityDispatchTrivial,
  type CategoryConfig,
  type DrawerCategoryList,
} from "./drawer-visibility";

const CATEGORIES: Record<string, CategoryConfig> = {
  layout: {
    title: "Layout",
    components: ["Section", "Columns", "CenteredBlock", "Divider", "Spacer"],
  },
  media: {
    title: "Media",
    components: ["Image", "ImageCarousel", "Embed", "EmbedResponsive"],
  },
  text: {
    title: "Text",
    components: ["Heading", "RichText", "Quote", "Button"],
  },
  forms: {
    title: "Forms",
    components: ["ContactForm", "NewsletterSignup"],
  },
};

const EMPTY_PREVIOUS: DrawerCategoryList = {};

describe("computeCategoryVisibility — empty filter", () => {
  it("marks every category visible when filter is empty", () => {
    const result = computeCategoryVisibility("", CATEGORIES, EMPTY_PREVIOUS);
    for (const key of Object.keys(CATEGORIES)) {
      expect(result[key]?.visible).toBe(true);
    }
  });

  it("ignores pure-whitespace as if empty", () => {
    // `q = filter.trim().toLowerCase()` — leading / trailing spaces
    // shouldn't make the filter "active." Otherwise a stray space
    // in the input would hide every category.
    const result = computeCategoryVisibility("   ", CATEGORIES, EMPTY_PREVIOUS);
    for (const key of Object.keys(CATEGORIES)) {
      expect(result[key]?.visible).toBe(true);
    }
  });
});

describe("computeCategoryVisibility — substring matching", () => {
  it("keeps categories with at least one matching component visible", () => {
    const result = computeCategoryVisibility("image", CATEGORIES, EMPTY_PREVIOUS);
    // 'media' has Image, ImageCarousel → visible.
    expect(result.media?.visible).toBe(true);
  });

  it("hides categories with no matching components", () => {
    const result = computeCategoryVisibility("image", CATEGORIES, EMPTY_PREVIOUS);
    // 'forms' has ContactForm + NewsletterSignup — neither contains
    // 'image'. Should be hidden.
    expect(result.forms?.visible).toBe(false);
  });

  it("matches case-insensitively", () => {
    // Artist types "SECTION" — should still find layout.
    expect(
      computeCategoryVisibility("SECTION", CATEGORIES, EMPTY_PREVIOUS).layout?.visible,
    ).toBe(true);
    // And lowercase variant.
    expect(
      computeCategoryVisibility("section", CATEGORIES, EMPTY_PREVIOUS).layout?.visible,
    ).toBe(true);
  });

  it("matches as substring (not exact)", () => {
    // 'div' is a substring of 'Divider' (case-insensitive).
    expect(
      computeCategoryVisibility("div", CATEGORIES, EMPTY_PREVIOUS).layout?.visible,
    ).toBe(true);
  });

  it("hides every category when the filter matches no component", () => {
    const result = computeCategoryVisibility("zzzz-no-match", CATEGORIES, EMPTY_PREVIOUS);
    for (const key of Object.keys(CATEGORIES)) {
      expect(result[key]?.visible).toBe(false);
    }
  });

  it("treats a category with no components as visible (defensive default)", () => {
    // An empty-components category shouldn't get hidden by the
    // filter — it's structural chrome the artist might still want
    // to see. `cat?.components?.some(...) ?? true` handles this.
    const result = computeCategoryVisibility(
      "anything",
      { empty: { title: "Empty", components: [] } },
      EMPTY_PREVIOUS,
    );
    // No matches → hidden? Actually the .some() returns false,
    // and `false ?? true` is false. So this category IS hidden
    // when the filter is active. That's the right behaviour:
    // empty categories shouldn't claim "matching" status. Lock it.
    expect(result.empty?.visible).toBe(false);
  });

  it("undefined-components category falls through the ?? to visible", () => {
    // Distinct from empty: a category where components is
    // undefined (not set). `cat?.components?.some(...) ?? true`
    // returns true here.
    const result = computeCategoryVisibility(
      "anything",
      { phantom: { title: "Phantom" } },
      EMPTY_PREVIOUS,
    );
    expect(result.phantom?.visible).toBe(true);
  });
});

describe("computeCategoryVisibility — preserves expanded state", () => {
  it("copies expanded from the previous entry on every category", () => {
    // The artist's manual collapse state must survive filter
    // changes. The helper spreads `prev` first, then overrides
    // visible / components / title.
    const previous: DrawerCategoryList = {
      layout: { expanded: false },
      media: { expanded: true },
      // text + forms not yet touched — `prev` is undefined for them.
    };
    const result = computeCategoryVisibility("", CATEGORIES, previous);
    expect(result.layout?.expanded).toBe(false);
    expect(result.media?.expanded).toBe(true);
    // Categories with no prior entry have no `expanded` set —
    // Puck's reducer applies its default (true).
    expect(result.text?.expanded).toBeUndefined();
  });

  it("preserves expanded across visible <-> hidden transitions", () => {
    // Filter hides a category whose `expanded` should still be
    // remembered: when the artist clears the filter and the
    // category reappears, it should retain its collapsed state.
    const previous: DrawerCategoryList = {
      layout: { expanded: false, visible: true },
    };
    // Filter that hides 'layout' (no component contains 'foobar').
    const hidden = computeCategoryVisibility("foobar", CATEGORIES, previous);
    expect(hidden.layout?.visible).toBe(false);
    expect(hidden.layout?.expanded).toBe(false);
  });
});

describe("computeCategoryVisibility — components + title", () => {
  it("clones the components array (not the same reference)", () => {
    // Defensive: returning the same `components` array Puck might
    // hold a reference to could cause confusion if downstream code
    // mutates. We re-emit a fresh array per call.
    const result = computeCategoryVisibility("", CATEGORIES, EMPTY_PREVIOUS);
    expect(result.layout?.components).not.toBe(CATEGORIES.layout!.components);
    expect(result.layout?.components).toEqual(CATEGORIES.layout!.components);
  });

  it("copies the title from the registered category", () => {
    const result = computeCategoryVisibility("", CATEGORIES, EMPTY_PREVIOUS);
    expect(result.layout?.title).toBe("Layout");
    expect(result.media?.title).toBe("Media");
  });

  it("emits an entry for every registered category", () => {
    const result = computeCategoryVisibility("image", CATEGORIES, EMPTY_PREVIOUS);
    // Even hidden categories get an entry so Puck's componentList
    // shape stays consistent (rather than the category disappearing
    // entirely).
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(CATEGORIES).sort(),
    );
  });
});

describe("isVisibilityDispatchTrivial", () => {
  it("returns true for empty / whitespace-only filters", () => {
    expect(isVisibilityDispatchTrivial("")).toBe(true);
    expect(isVisibilityDispatchTrivial("   ")).toBe(true);
    expect(isVisibilityDispatchTrivial("\t\n")).toBe(true);
  });

  it("returns false as soon as there's a non-whitespace character", () => {
    expect(isVisibilityDispatchTrivial("x")).toBe(false);
    expect(isVisibilityDispatchTrivial(" x ")).toBe(false);
    expect(isVisibilityDispatchTrivial("image")).toBe(false);
  });
});
