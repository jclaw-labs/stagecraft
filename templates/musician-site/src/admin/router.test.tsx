import { describe, expect, it } from "vitest";

import * as collectionItem from "./collections/[slug]/items/[itemSlug]/page.js";
import * as collectionNew from "./collections/new/page.js";
import * as login from "./login/page.js";
import * as root from "./page.js";
import AdminRouter, { ADMIN_ROUTES, generateMetadata, matchAdminRoute } from "./router.js";

const props = (path?: string[], searchParams: Record<string, string> = {}) => ({
  params: Promise.resolve(path ? { path } : {}),
  searchParams: Promise.resolve(searchParams),
});

/** `notFound()` throws an error whose digest ends in the status code. */
async function thrownDigest(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
  return undefined;
}

describe("admin router", () => {
  it("renders the page module for the path, with its params and the search params", async () => {
    const element = (await AdminRouter(props(["collections", "shows", "items", "first"], { q: "1" }))) as {
      type: unknown;
      props: { params: Promise<unknown>; searchParams: Promise<unknown> };
    };
    expect(element.type).toBe(collectionItem.default);
    expect(await element.props.params).toEqual({ slug: "shows", itemSlug: "first" });
    expect(await element.props.searchParams).toEqual({ q: "1" });
  });

  it("serves /admin itself, with or without an empty path", async () => {
    expect(((await AdminRouter(props())) as { type: unknown }).type).toBe(root.default);
    expect(((await AdminRouter(props([]))) as { type: unknown }).type).toBe(root.default);
  });

  it("prefers a literal segment over a dynamic one", () => {
    expect(matchAdminRoute(["collections", "new"])?.route.module).toBe(collectionNew);
    expect(matchAdminRoute(["login"])?.route.module).toBe(login);
  });

  it("calls notFound() for an unknown path", async () => {
    for (const path of [["nope"], ["collections", "shows", "items"], ["pages", "home", "extra"]]) {
      expect(await thrownDigest(() => AdminRouter(props(path)))).toMatch(/;404$/);
    }
  });

  it("returns no metadata for a page without any, or an unknown path", async () => {
    expect(await generateMetadata(props(["pages"]))).toEqual({});
    expect(await generateMetadata(props(["nope"]))).toEqual({});
  });

  it("serves 17 pages on unique patterns", () => {
    expect(ADMIN_ROUTES).toHaveLength(17);
    expect(new Set(ADMIN_ROUTES.map((r) => r.pattern)).size).toBe(ADMIN_ROUTES.length);
    for (const route of ADMIN_ROUTES) expect(typeof route.module.default, route.pattern).toBe("function");
  });
});
