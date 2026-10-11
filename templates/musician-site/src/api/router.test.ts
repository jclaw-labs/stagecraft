import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("#lib/auth.js", async () => ({
  ...(await vi.importActual<typeof import("#lib/auth.js")>("#lib/auth.js")),
  getSession: getSessionMock,
}));

import { allowedMethods, API_METHODS, API_ROUTES, DELETE, dispatch, GET, PATCH, POST, PUT } from "./router.js";

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
const req = (method: string, body?: string) => new Request("https://site.test/api/x", { method, body });

beforeEach(() => {
  getSessionMock.mockReset();
});

describe("API router", () => {
  it("dispatches to the handler with the path's params", async () => {
    getSessionMock.mockResolvedValue({ email: "artist@example.com" });

    // A valid slug reaches the body check; an invalid one fails the slug check.
    const ok = await PUT(req("PUT", "not json"), ctx(["collections", "shows", "schema"]));
    expect(ok.status).toBe(400);
    expect(await ok.json()).toMatchObject({ error: "Body must be JSON" });

    const bad = await PUT(req("PUT", "{}"), ctx(["collections", "Not A Slug!", "schema"]));
    expect(await bad.json()).toMatchObject({ error: "Invalid collection slug" });
  });

  it("returns the handler's own response", async () => {
    getSessionMock.mockResolvedValue(null);
    const res = await GET(req("GET"), ctx(["collections", "shows", "items"]));
    expect(res.status).toBe(401);
  });

  it("answers an unknown path with a 404", async () => {
    for (const path of [[], ["nope"], ["collections", "shows"], ["contact", "extra"]]) {
      const res = await GET(req("GET"), ctx(path));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    }
  });

  it("answers a method the path doesn't serve with a 405 and an Allow header", async () => {
    const res = await DELETE(req("DELETE"), ctx(["contact"]));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await res.json()).toEqual({ error: "Method not allowed" });

    const item = await POST(req("POST"), ctx(["collections", "shows", "items", "a"]));
    expect(item.status).toBe(405);
    expect(item.headers.get("allow")).toBe("GET, PUT, PATCH, DELETE");
  });

  it("exports a handler per method, each dispatching that method", async () => {
    for (const [method, handler] of Object.entries({ GET, POST, PUT, PATCH, DELETE })) {
      const res = await handler(req(method), ctx(["auth", "verify"]));
      // auth/verify serves only GET.
      if (method !== "GET") expect(res.headers.get("allow")).toBe("GET");
    }
    expect(Object.keys({ GET, POST, PUT, PATCH, DELETE }).sort()).toEqual([...API_METHODS].sort());
  });

  it("dispatch matches the method it's given", async () => {
    const res = await dispatch("PATCH", req("PATCH"), ctx(["upload-image"]));
    expect(res.status).toBe(405);
  });

  it("serves every endpoint with at least one method, on a unique pattern", () => {
    for (const route of API_ROUTES) expect(allowedMethods(route.module), route.pattern).not.toEqual([]);
    expect(new Set(API_ROUTES.map((r) => r.pattern)).size).toBe(API_ROUTES.length);
    expect(API_ROUTES).toHaveLength(19);
  });
});
