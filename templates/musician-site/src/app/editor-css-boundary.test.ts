/**
 * Puck's stylesheet (`@measured/puck/puck.css`) is editor chrome: ~55 KB
 * of drag-and-drop UI rules plus a third-party `@import` of Inter. The
 * server `<Render>` the public site uses emits none of its class names,
 * so the stylesheet must stay behind `/admin` — a public module importing
 * it ships the whole thing to every visitor (issue #348).
 *
 * Static source scan rather than a render test: the import is a side
 * effect the bundler resolves, which a unit render can't observe.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");
const ADMIN = path.join(SRC, "app", "admin") + path.sep;

const PUCK_CSS_IMPORT =
  /(?:\bimport\b[^"';]*|require\()\s*["']@measured\/puck\/(?:puck\.css|no-external\.css|dist\/[^"']+\.css)["']/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx|css)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

const importers = sourceFiles(SRC)
  .filter((file) => PUCK_CSS_IMPORT.test(fs.readFileSync(file, "utf-8")))
  .map((file) => path.relative(SRC, file));

describe("puck.css import boundary", () => {
  it("is imported only by admin modules", () => {
    const outsideAdmin = importers.filter((rel) => !path.join(SRC, rel).startsWith(ADMIN));
    expect(outsideAdmin).toEqual([]);
  });

  it("is not imported by the public catch-all route", () => {
    expect(importers).not.toContain(path.join("app", "(public)", "[[...slug]]", "page.tsx"));
  });

  it("is still imported by every Puck editor", () => {
    expect(importers).toEqual(
      expect.arrayContaining([
        path.join("app", "admin", "pages", "[slug]", "Editor.tsx"),
        path.join("app", "admin", "collections", "[slug]", "template", "TemplateEditorClient.tsx"),
        path.join(
          "app",
          "admin",
          "collections",
          "[slug]",
          "items",
          "[itemSlug]",
          "body",
          "[fieldId]",
          "BodyEditorClient.tsx",
        ),
      ]),
    );
  });

  it("recognises the import forms it guards against", () => {
    expect(PUCK_CSS_IMPORT.test('import "@measured/puck/puck.css";')).toBe(true);
    expect(PUCK_CSS_IMPORT.test("import '@measured/puck/no-external.css';")).toBe(true);
    expect(PUCK_CSS_IMPORT.test('import "@measured/puck/dist/index.css";')).toBe(true);
    expect(PUCK_CSS_IMPORT.test('import styles from "@measured/puck/puck.css";')).toBe(true);
    expect(PUCK_CSS_IMPORT.test('import { Render } from "@measured/puck";')).toBe(false);
    expect(PUCK_CSS_IMPORT.test("// No `@measured/puck/puck.css` here")).toBe(false);
  });
});
