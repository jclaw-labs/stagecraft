/**
 * Tests for the custom-admin-surfaces registry. Focused on the lookup
 * contract that the per-collection-item redirect (in
 * `app/admin/collections/[slug]/items/[itemSlug]/page.tsx`) and the
 * AdminShell sidebar both depend on.
 */

import { describe, expect, it } from "vitest";

import {
  CUSTOM_ADMIN_SURFACES,
  CUSTOM_PANEL_COLLECTION_SLUGS,
  findCustomSurface,
} from "./admin-surfaces";

describe("findCustomSurface", () => {
  it("returns the registered surface for a known custom-panel slug", () => {
    const surface = findCustomSurface("site");
    expect(surface).not.toBeNull();
    expect(surface?.route).toBe("/admin/settings");
    expect(surface?.collectionSlug).toBe("site");
  });

  it("returns null for slugs not in the registry", () => {
    expect(findCustomSurface("tour-dates")).toBeNull();
    expect(findCustomSurface("not-a-collection")).toBeNull();
  });

  it("returns the pages surface with an itemRoute that maps slug → /admin/pages/<slug>", () => {
    const surface = findCustomSurface("pages");
    expect(surface).not.toBeNull();
    expect(surface?.itemRoute?.("about")).toBe("/admin/pages/about");
    expect(surface?.itemRoute?.("home")).toBe("/admin/pages/home");
  });

  it("leaves itemRoute unset on singleton surfaces", () => {
    // The singleton redirect uses `route` directly; itemRoute is for
    // multi-item custom panels like Pages.
    expect(findCustomSurface("site")?.itemRoute).toBeUndefined();
    expect(findCustomSurface("header")?.itemRoute).toBeUndefined();
    expect(findCustomSurface("appearance")?.itemRoute).toBeUndefined();
  });
});

describe("CUSTOM_PANEL_COLLECTION_SLUGS", () => {
  it("contains exactly the slugs registered in CUSTOM_ADMIN_SURFACES", () => {
    const slugs = CUSTOM_ADMIN_SURFACES.map((s) => s.collectionSlug);
    expect([...CUSTOM_PANEL_COLLECTION_SLUGS].sort()).toEqual(slugs.sort());
  });

  it("is used by the sidebar to filter custom panels out of the generic Collections group", () => {
    // Smoke test on the membership contract. AdminShell consults
    // this set to decide what to render under "Collections" — if
    // this diverges from the registry, a custom panel could appear
    // in both groups.
    for (const surface of CUSTOM_ADMIN_SURFACES) {
      expect(CUSTOM_PANEL_COLLECTION_SLUGS.has(surface.collectionSlug)).toBe(true);
    }
  });
});

describe("CUSTOM_ADMIN_SURFACES integrity", () => {
  it("has no duplicate collectionSlugs", () => {
    const slugs = CUSTOM_ADMIN_SURFACES.map((s) => s.collectionSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has no duplicate routes", () => {
    // Two surfaces sharing a route would mean two sidebar entries
    // bouncing the user to the same page.
    const routes = CUSTOM_ADMIN_SURFACES.map((s) => s.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("has no duplicate section identifiers", () => {
    // The section field is what AdminShell matches against
    // `activeSection`. Duplicates would mean two sidebar entries
    // both highlight on the same page.
    const sections = CUSTOM_ADMIN_SURFACES.map((s) => s.section);
    expect(new Set(sections).size).toBe(sections.length);
  });
});
