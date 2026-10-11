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
 * the admin app (`src/admin/` and `src/app/admin/`) that reaches a value import of the main entry, directly
 * or through local modules it value-imports (#432).
 *
 * Static source scan rather than a render test: the import is a side
 * effect the bundler resolves, which a unit render can't observe.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");
/** The admin app: its page modules, and the routes that serve them. */
const ADMIN_DIRS = [path.join(SRC, "admin") + path.sep, path.join(SRC, "app", "admin") + path.sep];
const isAdmin = (file: string): boolean => ADMIN_DIRS.some((dir) => file.startsWith(dir));

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
    const outsideAdmin = importers.filter((rel) => !isAdmin(path.join(SRC, rel)));
    expect(outsideAdmin).toEqual([]);
  });

  it("is not imported by the public catch-all route", () => {
    expect(importers).not.toContain(path.join("app", "(public)", "[[...slug]]", "page.tsx"));
  });

  it("is still imported by every Puck editor", () => {
    expect(importers).toEqual(
      expect.arrayContaining([
        path.join("admin", "pages", "[slug]", "Editor.tsx"),
        path.join("admin", "collections", "[slug]", "template", "TemplateEditorClient.tsx"),
        path.join(
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

/**
 * Every specifier a module value-imports or re-exports; type-only imports
 * are skipped, and so are dynamic `import()` calls when `dynamic` is false. Parsed with TypeScript rather than matched with a regex, so
 * comments, missing semicolons and template-literal `import()` calls read
 * the way the bundler reads them.
 */
function valueImports(source: string, fileName: string, { dynamic = true } = {}): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (!clause.name &&
            bindings !== undefined &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly)));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      const typeOnly =
        node.isTypeOnly ||
        (clause !== undefined &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
    } else if (
      dynamic &&
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  // `<T>(x) => …` and `<T>value` only parse as TypeScript outside TSX.
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  visit(ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind));
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
  // `#lib/…`, `#components/…` and `#puck/…` are package.json subpath
  // imports onto `src/`.
  if (specifier.startsWith("#")) base = path.join(SRC, specifier.slice(1));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  if (/\.(ts|tsx)$/.test(base) && fs.existsSync(base)) return base;
  // `./helper.js` names `helper.ts`.
  base = base.replace(/\.jsx?$/, "");
  for (const extension of MODULE_EXTENSIONS) {
    if (fs.existsSync(base + extension)) return base + extension;
  }
  return null;
}

const PUCK_MAIN_ENTRY = "@puckeditor/core";

/** `valueImports` on a snippet parsed as a `.tsx` module. */
const tsxImports = (source: string): string[] => valueImports(source, "module.tsx");

/**
 * The chain of local modules from `entry` to one that value-imports
 * Puck's main entry, or null when none does.
 */
function pathToPuckMainEntry(entry: string): string[] | null {
  const seen = new Set<string>();
  const visit = (file: string): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const imports = valueImports(fs.readFileSync(file, "utf-8"), file);
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
  .filter((file) => /\.(ts|tsx)$/.test(file) && !isAdmin(file))
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
    const editor = path.join(SRC, "admin", "pages", "[slug]", "Editor.tsx");
    expect(pathToPuckMainEntry(editor)).toEqual([editor]);
  });

  it("follows local value imports to the module that imports Puck", () => {
    const templateEditor = path.join(
      SRC,
      "admin",
      "collections",
      "[slug]",
      "template",
      "TemplateEditorClient.tsx",
    );
    expect(resolveLocal("#puck/render-config.js", templateEditor)).toBe(
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
    expect(tsxImports('import { Render } from "@puckeditor/core";')).toEqual([PUCK_MAIN_ENTRY]);
    expect(tsxImports('import { Puck, type Data } from "@puckeditor/core";')).toEqual([
      PUCK_MAIN_ENTRY,
    ]);
    expect(tsxImports('import * as Puck from "@puckeditor/core";')).toEqual([PUCK_MAIN_ENTRY]);
    expect(tsxImports('export { Render } from "@puckeditor/core";')).toEqual([PUCK_MAIN_ENTRY]);
    expect(tsxImports('import "@puckeditor/core";')).toEqual([PUCK_MAIN_ENTRY]);
    expect(tsxImports('const m = await import("@puckeditor/core");')).toEqual([PUCK_MAIN_ENTRY]);
    expect(tsxImports('import {\n  Render,\n  type Config,\n} from "@puckeditor/core";')).toEqual(
      [PUCK_MAIN_ENTRY],
    );
    expect(tsxImports('import type { Data } from "@puckeditor/core";')).toEqual([]);
    expect(tsxImports('import { type Data, type Config } from "@puckeditor/core";')).toEqual([]);
    expect(tsxImports('export type { Data } from "@puckeditor/core";')).toEqual([]);
    expect(tsxImports('export * from "@puckeditor/core";')).toEqual([PUCK_MAIN_ENTRY]);
    expect(tsxImports("const m = import(`@puckeditor/core`);")).toEqual([PUCK_MAIN_ENTRY]);
    expect(
      tsxImports('import {\n  // only a type\n  type Data,\n} from "@puckeditor/core";'),
    ).toEqual([]);
    // A semicolon-less type alias must not swallow the value import after it.
    expect(
      tsxImports('export type P = { a: string }\nimport { Render } from "@puckeditor/core"'),
    ).toEqual([PUCK_MAIN_ENTRY]);
  });

  it("parses .ts modules without JSX, so generic arrows don't hide later imports", () => {
    const source = 'const id = <T>(x: T) => x;\nexport { Render } from "@puckeditor/core";';
    expect(valueImports(source, "helper.ts")).toEqual([PUCK_MAIN_ENTRY]);
  });

  it("resolves a .js-suffixed local specifier to its TypeScript source", () => {
    const from = path.join(SRC, "puck", "build-config.tsx");
    expect(resolveLocal("./render-config.js", from)).toBe(
      path.join(SRC, "puck", "render-config.tsx"),
    );
  });

  it("recognises a use client directive after a leading comment", () => {
    expect(isClientModule('"use client";\nexport {};')).toBe(true);
    expect(isClientModule("/**\n * Doc.\n */\n\n'use client';\n")).toBe(true);
    expect(isClientModule('// note\n"use client";\n')).toBe(true);
    expect(isClientModule('import x from "y";\n"use client";\n')).toBe(false);
    expect(isClientModule("export const a = 'use client';\n")).toBe(false);
  });
});

/**
 * Every admin page is served by one catch-all route, and Next.js ships a
 * route's client modules together, so Puck reached through static imports
 * (about 1 MB of script plus `puck.css`) loads on every admin page, the
 * sign-in page included. `admin/lazy-editors.tsx` loads each editor
 * through `next/dynamic` instead; this keeps it the only way to Puck's
 * main entry or stylesheet.
 */
const PUCK_EDITORS = [
  path.join(SRC, "admin", "pages", "[slug]", "Editor.tsx"),
  path.join(SRC, "admin", "collections", "[slug]", "template", "TemplateEditorClient.tsx"),
  path.join(SRC, "admin", "collections", "[slug]", "items", "[itemSlug]", "body", "[fieldId]", "BodyEditorClient.tsx"),
];

/** One of Puck's stylesheets. */
const isPuckStylesheet = (specifier: string): boolean => /^@puckeditor\/core\/.*\.css$/.test(specifier);

/**
 * The chain of static value imports from `entry` to a Puck editor, to a
 * module that imports a Puck stylesheet, or to a client module (or one it
 * imports) that value-imports Puck's main entry; else null. A server
 * module may import the main entry, which resolves to the `/rsc` build
 * there (see the top of this file), so a server `<Render>` preview is fine.
 */
function staticPathToPuck(entry: string): string[] | null {
  const seen = new Set<string>();
  const visit = (file: string, inClient: boolean): string[] | null => {
    if (PUCK_EDITORS.includes(file)) return [file];
    const source = fs.readFileSync(file, "utf-8");
    const client = inClient || isClientModule(source);
    const key = `${client}:${file}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const imports = valueImports(source, file, { dynamic: false });
    if (imports.some(isPuckStylesheet) || (client && imports.includes(PUCK_MAIN_ENTRY))) return [file];
    for (const specifier of imports) {
      const next = resolveLocal(specifier, file);
      const chain = next ? visit(next, client) : null;
      if (chain) return [file, ...chain];
    }
    return null;
  };
  return visit(entry, false);
}

const adminRouteFiles = sourceFiles(path.join(SRC, "app", "admin")).filter((file) => /\.(ts|tsx)$/.test(file));

describe("lazy Puck editor boundary", () => {
  it("no admin route reaches an editor or Puck through static imports", () => {
    const offenders = adminRouteFiles.flatMap((file) => {
      const chain = staticPathToPuck(file);
      return chain ? [chain.map((step) => path.relative(SRC, step)).join(" → ")] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("starts from the admin catch-all, which reaches every page module", () => {
    const catchAll = path.join(SRC, "app", "admin", "[[...path]]", "page.tsx");
    expect(adminRouteFiles).toContain(catchAll);
    expect(valueImports(fs.readFileSync(catchAll, "utf-8"), catchAll)).toContain("../../../admin/router.js");
    const router = path.join(SRC, "admin", "router.tsx");
    expect(valueImports(fs.readFileSync(router, "utf-8"), router)).toContain("./pages/[slug]/page.js");
  });

  it("loads every editor dynamically from lazy-editors", () => {
    const lazy = path.join(SRC, "admin", "lazy-editors.tsx");
    const source = fs.readFileSync(lazy, "utf-8");
    const staticImports = valueImports(source, lazy, { dynamic: false });
    const dynamicTargets = valueImports(source, lazy)
      .filter((specifier) => !staticImports.includes(specifier))
      .map((specifier) => resolveLocal(specifier, lazy));
    expect(dynamicTargets.sort()).toEqual([...PUCK_EDITORS].sort());
  });

  it("stops at a Puck stylesheet anywhere, and at Puck's main entry below a client module", () => {
    expect(isPuckStylesheet("@puckeditor/core/puck.css")).toBe(true);
    expect(isPuckStylesheet(PUCK_MAIN_ENTRY)).toBe(false);
    // render-config is a server module: its `<Render>` import is the /rsc build.
    const renderConfig = path.join(SRC, "puck", "render-config.tsx");
    expect(staticPathToPuck(renderConfig)).toBeNull();
    // lazy-editors is a client module, but it reaches the editors only
    // through `import()`.
    expect(staticPathToPuck(path.join(SRC, "admin", "lazy-editors.tsx"))).toBeNull();
  });

  it("skips dynamic imports only when asked", () => {
    const source = 'import a from "./a.js";\nconst b = import("./b.js");';
    expect(tsxImports(source)).toEqual(["./a.js", "./b.js"]);
    expect(valueImports(source, "module.tsx", { dynamic: false })).toEqual(["./a.js"]);
  });
});
