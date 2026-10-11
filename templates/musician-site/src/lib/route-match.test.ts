import { describe, expect, it } from "vitest";

import { matchPattern, matchRoute, patternSegments } from "./route-match.js";

describe("patternSegments", () => {
  it("splits on / and drops empty segments", () => {
    expect(patternSegments("")).toEqual([]);
    expect(patternSegments("collections/:slug")).toEqual(["collections", ":slug"]);
    expect(patternSegments("/a//b/")).toEqual(["a", "b"]);
  });
});

describe("matchPattern", () => {
  it("binds dynamic segments by name", () => {
    expect(matchPattern("collections/:slug/items/:itemSlug", ["collections", "shows", "items", "x"])).toEqual({
      slug: "shows",
      itemSlug: "x",
    });
  });

  it("matches the empty pattern only against no segments", () => {
    expect(matchPattern("", [])).toEqual({});
    expect(matchPattern("", ["x"])).toBeNull();
  });

  it("rejects a different literal or segment count", () => {
    expect(matchPattern("collections/:slug", ["pages", "home"])).toBeNull();
    expect(matchPattern("collections/:slug", ["collections"])).toBeNull();
    expect(matchPattern("collections/:slug", ["collections", "a", "b"])).toBeNull();
  });
});

describe("matchRoute", () => {
  const routes = [
    { pattern: "collections/:slug" },
    { pattern: "collections/new" },
    { pattern: "collections/:slug/items/:itemSlug" },
    { pattern: "collections/:slug/items/new" },
    { pattern: "" },
  ];

  it("prefers a literal segment over a dynamic one, whatever the order", () => {
    expect(matchRoute(routes, ["collections", "new"])?.route.pattern).toBe("collections/new");
    expect(matchRoute([...routes].reverse(), ["collections", "new"])?.route.pattern).toBe("collections/new");
    expect(matchRoute(routes, ["collections", "shows", "items", "new"])).toEqual({
      route: { pattern: "collections/:slug/items/new" },
      params: { slug: "shows" },
    });
  });

  it("falls back to the dynamic route", () => {
    expect(matchRoute(routes, ["collections", "shows"])).toEqual({
      route: { pattern: "collections/:slug" },
      params: { slug: "shows" },
    });
  });

  it("matches the base and returns null for an unknown path", () => {
    expect(matchRoute(routes, [])?.route.pattern).toBe("");
    expect(matchRoute(routes, ["nope"])).toBeNull();
  });
});
