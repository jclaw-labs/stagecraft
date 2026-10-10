/**
 * Puck's stylesheet (`@puckeditor/core/puck.css`) is editor chrome: ~105 KB
 * of drag-and-drop UI rules plus a third-party `@import` of Inter. The
 * server `<Render>` the public site uses emits none of its class names,
 * so the stylesheet must stay behind `/admin` — a public module importing
 * it ships the whole thing to every visitor (issue #348).
 *
 * Since Puck 0.22 the editor also injects these styles at runtime when the
 * import is missing; only `<Puck>` does that, never `<Render>`. The editors
 * keep the static import so the chrome is styled on first paint, which is
 * why 0.23 logs a dev-only `console.info` ("Skipped runtime style
 * injection…") on every editor load. That's expected, not a regression.
 *
 * The same styles also ship as a JS string (`defaultUiStyles`, which
 * `@import`s rsms.me/inter). In 0.23 it sits in the chunk behind the main
 * `@puckeditor/core` entry, next to `Render`, and the package declares no
 * `sideEffects`, so a client bundle that value-imports the main entry can
 * carry that text with no CSS import in sight. The `/rsc` and `/internal`
 * entries don't reach that chunk. Server components are safe either way:
 * the main entry's `react-server` condition resolves to the `/rsc` build.
 * So the second suite below flags any `"use client"` module outside
 * `src/app/admin/` that reaches a value import of the main entry, directly
 * or through local modules it value-imports (#432).
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
  /(?:\bimport\b[^"';]*|require\()\s*["']@puckeditor\/core\/(?:puck\.css|no-external\.css|dist\/[^"']+\.css)["']/;

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
    expect(PUCK_CSS_IMPORT.test('import "@puckeditor/core/puck.css";')).toBe(true);
    expect(PUCK_CSS_IMPORT.test("import '@puckeditor/core/no-external.css';")).toBe(true);
    expect(PUCK_CSS_IMPORT.test('import "@puckeditor/core/dist/index.css";')).toBe(true);
    expect(PUCK_CSS_IMPORT.test('import styles from "@puckeditor/core/puck.css";')).toBe(true);
    expect(PUCK_CSS_IMPORT.test('import { Render } from "@puckeditor/core";')).toBe(false);
    expect(PUCK_CSS_IMPORT.test("// No `@puckeditor/core/puck.css` here")).toBe(false);
  });
});

/** Every specifier a module value-imports or re-exports; type-only imports are skipped. */
function valueImports(source: string): string[] {
  const specifiers: string[] = [];
  const fromClause = /^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm;
  for (const [, , typeOnly, clause, specifier] of source.matchAll(fromClause)) {
    if (typeOnly) continue;
    const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
    const allTypes =
      named !== null &&
      named[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .every((part) => part.startsWith("type "));
    if (!allTypes) specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) {
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(specifier);
  }
  return specifiers;
}

/** A `"use client"` directive at the top of a module, after any comments. */
function isClientModule(source: string): boolean {
  return /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*["']use client["']/.test(source);
}

const MODULE_EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** The local source file a specifier resolves to, or null for a package. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  if (/\.(ts|tsx)$/.test(base) && fs.existsSync(base)) return base;
  for (const extension of MODULE_EXTENSIONS) {
    if (fs.existsSync(base + extension)) return base + extension;
  }
  return null;
}

const PUCK_MAIN_ENTRY = "@puckeditor/core";

/**
 * The chain of local modules from `entry` to one that value-imports
 * Puck's main entry, or null when none does.
 */
function pathToPuckMainEntry(entry: string): string[] | null {
  const seen = new Set<string>();
  const visit = (file: string): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const imports = valueImports(fs.readFileSync(file, "utf-8"));
    if (imports.includes(PUCK_MAIN_ENTRY)) return [file];
    for (const specifier of imports) {
      const next = resolveLocal(specifier, file);
      const chain = next ? visit(next) : null;
      if (chain) return [file, ...chain];
    }
    return null;
  };
  return visit(entry);
}

const publicClientModules = sourceFiles(SRC)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !file.startsWith(ADMIN))
  .filter((file) => isClientModule(fs.readFileSync(file, "utf-8")));

describe("@puckeditor/core value-import boundary", () => {
  it("is not reached from a client module outside the admin app", () => {
    const offenders = publicClientModules.flatMap((file) => {
      const chain = pathToPuckMainEntry(file);
      return chain ? [chain.map((step) => path.relative(SRC, step)).join(" → ")] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("still finds the admin editors' value imports", () => {
    const editor = path.join(ADMIN, "pages", "[slug]", "Editor.tsx");
    expect(pathToPuckMainEntry(editor)).toEqual([editor]);
  });

  it("follows local value imports to the module that imports Puck", () => {
    const templateEditor = path.join(
      ADMIN,
      "collections",
      "[slug]",
      "template",
      "TemplateEditorClient.tsx",
    );
    expect(resolveLocal("@/puck/render-config", templateEditor)).toBe(
      path.join(SRC, "puck", "render-config.tsx"),
    );
    expect(pathToPuckMainEntry(path.join(SRC, "puck", "render-config.tsx"))).toEqual([
      path.join(SRC, "puck", "render-config.tsx"),
    ]);
  });

  it("checks the client modules outside the admin app", () => {
    expect(publicClientModules).toEqual(
      expect.arrayContaining([
        path.join(SRC, "components", "ContactForm.tsx"),
        path.join(SRC, "puck", "collection-view-editor.tsx"),
      ]),
    );
  });

  it("recognises value and type-only imports", () => {
    expect(valueImports('import { Render } from "@puckeditor/core";')).toEqual([PUCK_MAIN_ENTRY]);
    expect(valueImports('import { Puck, type Data } from "@puckeditor/core";')).toEqual([
      PUCK_MAIN_ENTRY,
    ]);
    expect(valueImports('import * as Puck from "@puckeditor/core";')).toEqual([PUCK_MAIN_ENTRY]);
    expect(valueImports('export { Render } from "@puckeditor/core";')).toEqual([PUCK_MAIN_ENTRY]);
    expect(valueImports('import "@puckeditor/core";')).toEqual([PUCK_MAIN_ENTRY]);
    expect(valueImports('const m = await import("@puckeditor/core");')).toEqual([PUCK_MAIN_ENTRY]);
    expect(valueImports('import {\n  Render,\n  type Config,\n} from "@puckeditor/core";')).toEqual(
      [PUCK_MAIN_ENTRY],
    );
    expect(valueImports('import type { Data } from "@puckeditor/core";')).toEqual([]);
    expect(valueImports('import { type Data, type Config } from "@puckeditor/core";')).toEqual([]);
    expect(valueImports('export type { Data } from "@puckeditor/core";')).toEqual([]);
  });

  it("recognises a use client directive after a leading comment", () => {
    expect(isClientModule('"use client";\nexport {};')).toBe(true);
    expect(isClientModule("/**\n * Doc.\n */\n\n'use client';\n")).toBe(true);
    expect(isClientModule('// note\n"use client";\n')).toBe(true);
    expect(isClientModule('import x from "y";\n"use client";\n')).toBe(false);
    expect(isClientModule("export const a = 'use client';\n")).toBe(false);
  });
});
