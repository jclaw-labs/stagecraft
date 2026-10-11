/**
 * The admin and API routers are hand-kept tables (ADR-016 §1), so a
 * swapped entry or a forgotten one is the likely mistake: a swap can send
 * "Discard" to the publish handler, and a page or handler file with no
 * entry is a runtime 404 its own unit tests never see. Each module still
 * sits where its file route used to, so the directory names the pattern
 * it must be registered under.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_ROUTES } from "./admin/router.js";
import { API_ROUTES } from "./api/router.js";

const SRC = import.meta.dirname;

/** Every `fileName` below `root`, keyed by the pattern its directory names. */
function filesByPattern(root: string, fileName: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === fileName) found.set(dirPattern(path.relative(root, dir)), full);
    }
  };
  walk(root);
  return found;
}

/** `collections/[slug]/items` → `collections/:slug/items`. */
function dirPattern(relativeDir: string): string {
  return relativeDir
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => segment.replace(/^\[(.+)\]$/, ":$1"))
    .join("/");
}

const registries = [
  { name: "admin", routes: ADMIN_ROUTES, root: path.join(SRC, "admin"), fileName: "page.tsx" },
  { name: "API", routes: API_ROUTES, root: path.join(SRC, "api"), fileName: "route.ts" },
];

describe.each(registries)("$name route registry", ({ routes, root, fileName }) => {
  const files = filesByPattern(root, fileName);

  it("registers every module file under the pattern its directory names", () => {
    expect(routes.map((r) => r.pattern).sort()).toEqual([...files.keys()].sort());
  });

  it("serves each pattern with the module from that directory", async () => {
    for (const route of routes) {
      const file = files.get(route.pattern);
      expect(file, route.pattern).toBeDefined();
      expect(route.module, route.pattern).toBe(await import(file!));
    }
  });
});

/**
 * Next.js reads route segment config only from the route file, so in a
 * routed module it would do nothing while reading as if it did. The
 * catch-alls under `app/` carry it instead.
 */
const SEGMENT_CONFIG = ["dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime", "preferredRegion", "maxDuration"];

describe.each(registries)("$name routed modules", ({ routes }) => {
  it("export no route segment config", () => {
    for (const route of routes) {
      expect(Object.keys(route.module).filter((key) => SEGMENT_CONFIG.includes(key)), route.pattern).toEqual([]);
    }
  });
});

describe("dirPattern", () => {
  it("maps bracketed segments to dynamic ones", () => {
    expect(dirPattern("")).toBe("");
    expect(dirPattern(path.join("collections", "new"))).toBe("collections/new");
    expect(dirPattern(path.join("collections", "[slug]", "items", "[itemSlug]"))).toBe(
      "collections/:slug/items/:itemSlug",
    );
  });
});
