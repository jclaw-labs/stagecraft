/**
 * The published package runs from `dist/`, where nothing maps a path
 * alias or adds a file extension (ADR-016 §1). Every relative and `#`
 * import has to name the compiled `.js` file, and the old `@/` alias must
 * not come back. The build's bundler-style resolution accepts both, so
 * this test is what holds the line.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SCANNED = ["src", "e2e", "capture"];
const SKIPPED_DIRS = new Set(["node_modules", "content", "__snapshots__"]);

// `from "x"`, `import "x"` and `import("x")`, including `typeof import("x")`.
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\1/g;
// The vitest module helpers, which may take a `<typeof import("x")>` argument.
const VITEST = /\b(?:mock|doMock|unmock|importActual|importMock)(?:<[^\n]*?>)?\(\s*(["'])([^"'\n]+)\1/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Local specifiers in `source`: relative, `#` subpath and `@/` alias imports. */
export function localSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT), ...source.matchAll(VITEST)]
    .map((m) => m[2])
    .filter((s) => /^(\.|#|@\/)/.test(s));
}

const ALLOWED_EXTENSION = /\.(js|css|json)$/;

describe("localSpecifiers", () => {
  it("finds static, dynamic, side-effect and vitest specifiers", () => {
    const source = [
      'import { a } from "./a.js";',
      "import './side.css';",
      'export * from "#lib/b.js";',
      'const c = await import("#puck/c.js");',
      'vi.mock("#lib/d.js", () => ({}));',
      'await vi.importActual<typeof import("#lib/e.js")>("#lib/e.js");',
      'import fs from "node:fs";',
    ].join("\n");
    expect(localSpecifiers(source).sort()).toEqual(
      ["./a.js", "./side.css", "#lib/b.js", "#puck/c.js", "#lib/d.js", "#lib/e.js", "#lib/e.js"].sort(),
    );
  });
});

describe("import specifiers", () => {
  const files = SCANNED.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));
  const all = files.flatMap((file) =>
    localSpecifiers(fs.readFileSync(file, "utf8")).map((specifier) => ({
      file: path.relative(ROOT, file),
      specifier,
    })),
  );

  it("scans the source", () => {
    expect(all.length).toBeGreaterThan(500);
  });

  it("never uses the @/ alias", () => {
    expect(all.filter(({ specifier }) => specifier.startsWith("@/"))).toEqual([]);
  });

  it("names the compiled file in every relative and # import", () => {
    expect(all.filter(({ specifier }) => !ALLOWED_EXTENSION.test(specifier))).toEqual([]);
  });

  it("uses only the subpath imports package.json declares", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      imports: Record<string, unknown>;
    };
    const prefixes = Object.keys(pkg.imports).map((key) => key.replace(/\*$/, ""));
    expect(
      all.filter(({ specifier }) => specifier.startsWith("#") && !prefixes.some((p) => specifier.startsWith(p))),
    ).toEqual([]);
  });
});

describe("tsconfig paths", () => {
  it("mirror the source targets of package.json's imports", async () => {
    const ts = await import("typescript");
    const tsconfig = ts.parseConfigFileTextToJson(
      "tsconfig.json",
      fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8"),
    ).config as { compilerOptions: { paths: Record<string, string[]> } };
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      imports: Record<string, { source: string }>;
    };
    const expected = Object.fromEntries(Object.entries(pkg.imports).map(([key, target]) => [key, [target.source]]));
    expect(tsconfig.compilerOptions.paths).toEqual(expected);
  });
});
