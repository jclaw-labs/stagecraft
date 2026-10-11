/**
 * The artist-repo shell (`templates/musician-site-shell`, ADR-016 §1)
 * against this package.
 *
 * The shell is a handful of files that re-export from the package, and
 * changing it is a major release (ADR-016 §3). These tests keep the two
 * in step from the package's side: every module and export the shell
 * names exists here, the route config Next.js reads statically is in
 * place, and the shell's file list is the one this package's
 * `REQUIRED_SHELL_VERSION` describes. They also read the package's own
 * app files, so a route file, route export or route config the package
 * gains without a shell change fails here. The e2e suite runs the shell
 * itself.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SHELL_DIR } from "#lib/collections/test-fixtures.js";
import { PACKAGE_NAME } from "#lib/with-stagecraft.js";

const SRC_DIR = import.meta.dirname;
const PACKAGE_DIR = path.dirname(SRC_DIR);

/**
 * The shell's code files at `REQUIRED_SHELL_VERSION`. Adding, renaming or
 * removing one changes the shell: raise `REQUIRED_SHELL_VERSION` and the
 * shell's `stagecraft.shellVersion` with it.
 */
const SHELL_CODE_FILES = [
  "next.config.ts",
  "src/app/(public)/[[...slug]]/page.tsx",
  "src/app/(public)/layout.tsx",
  "src/app/(public)/not-found.tsx",
  "src/app/admin/[[...path]]/page.tsx",
  "src/app/admin/not-found.tsx",
  "src/app/api/[...path]/route.ts",
  "src/app/global-not-found.tsx",
  "src/app/layout.tsx",
  "src/middleware.ts",
];

/** The shell's `.ts` and `.tsx` files, relative to it, outside `node_modules` and `.next`. */
function shellCodeFiles(dir = SHELL_DIR): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && entry.name !== "next-env.d.ts")
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter((file) => !/^(node_modules|\.next)\//.test(file))
    .sort();
}

const read = (file: string) => fs.readFileSync(path.join(SHELL_DIR, file), "utf8");

/**
 * The Next.js file conventions under `app/`: routes, layouts, boundaries
 * and metadata files. A colocated helper, or anything in a `_private`
 * folder, is none of these.
 */
const APP_FILE =
  /^(?:page|layout|template|default|route|not-found|global-not-found|forbidden|unauthorized|error|global-error|loading|sitemap|robots|manifest|favicon|icon|apple-icon|opengraph-image|twitter-image)\d*\.[a-z]+$/;

/** An app's convention files under `src/app` (`APP_FILE`), relative to the app, sorted. */
function appFiles(appRoot: string): string[] {
  return fs
    .readdirSync(path.join(appRoot, "src/app"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && APP_FILE.test(entry.name))
    .map((entry) => path.relative(appRoot, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter((file) => !file.split("/").some((segment) => segment.startsWith("_")))
    .sort();
}

/** The files Next.js reads from an app: `next.config.ts`, the middleware, and its `src/app` convention files. */
const nextFiles = (appRoot: string) => ["next.config.ts", "src/middleware.ts", ...appFiles(appRoot)].sort();

/** Route segment config and the middleware `config`: exports Next.js reads statically. */
const STATIC_CONFIG_NAMES = [
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "config",
];

/** Each static config `export const` in a source file, by name, with its value's whitespace collapsed. */
function staticConfig(source: string): Map<string, string> {
  const statement = new RegExp(
    `export const (${STATIC_CONFIG_NAMES.join("|")})\\b(?:\\s*:[^=]*)?\\s*=\\s*([\\s\\S]*?);`,
    "g",
  );
  return new Map([...source.matchAll(statement)].map(([, name, value]) => [name, squash(value)]));
}

/** The exports Next.js looks for in a route, layout, page or middleware module. */
const ROUTE_EXPORTS = new Set([
  "default",
  "metadata",
  "generateMetadata",
  "viewport",
  "generateViewport",
  "generateStaticParams",
  "middleware",
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  ...STATIC_CONFIG_NAMES,
]);

const squash = (source: string) => source.replace(/\s+/g, " ").trim();

/** The names a shell file exports: what it re-exports from the package and its own `export const`s. */
function shellExports(source: string): Set<string> {
  const reexported = [...source.matchAll(/export\s*\{([^}]*)\}\s*from/g)].flatMap(([, names]) =>
    names
      .split(",")
      .map((name) => name.trim().split(/\s+as\s+/).pop()!)
      .filter(Boolean),
  );
  const declared = [...source.matchAll(/export const (\w+)/g)].map(([, name]) => name);
  return new Set([...reexported, ...declared]);
}

const SHELL_ROUTE_FILES = SHELL_CODE_FILES.filter((file) => file.startsWith("src/"));

/** Each `export { … } from` or `import { … } from` the package, with the names it takes. */
function packageBindings(source: string): Array<{ subpath: string; names: string[] }> {
  const prefix = `${PACKAGE_NAME}/`;
  return [...source.matchAll(/(?:export|import)\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)]
    .filter(([, , specifier]) => specifier.startsWith(prefix))
    .map(([, names, specifier]) => ({
      subpath: specifier.slice(prefix.length),
      names: names
        .split(",")
        .map((name) => name.trim().split(/\s+as\s+/)[0])
        .filter(Boolean),
    }));
}

/** The source module a package subpath names (`./*` → `dist/*.js`, built from `src/*.ts(x)`). */
function sourceModule(subpath: string): string | undefined {
  return [".ts", ".tsx"].map((ext) => path.join(SRC_DIR, subpath + ext)).find((file) => fs.existsSync(file));
}

describe("the artist-repo shell", () => {
  it("has exactly the files of its shell version", () => {
    expect(shellCodeFiles()).toEqual(SHELL_CODE_FILES);
  });

  it("has a file for each file Next.js reads from the package's own app", () => {
    expect(nextFiles(SHELL_DIR)).toEqual(nextFiles(PACKAGE_DIR));
  });

  it.each(SHELL_ROUTE_FILES)("%s exports every route export the package's own file has", async (file) => {
    const own = await import(path.join(PACKAGE_DIR, file));
    const routeExports = Object.keys(own).filter((name) => ROUTE_EXPORTS.has(name));
    expect(routeExports.length).toBeGreaterThan(0);
    const exported = shellExports(read(file));
    for (const name of routeExports) expect(exported, name).toContain(name);
  });

  it.each(SHELL_ROUTE_FILES)("%s carries the package's own static route config as the same literals", (file) => {
    const own = staticConfig(fs.readFileSync(path.join(PACKAGE_DIR, file), "utf8"));
    const shell = staticConfig(read(file));
    for (const [name, value] of own) expect(shell.get(name), name).toBe(value);
  });

  it.each(SHELL_CODE_FILES)("%s imports only what the package exports", async (file) => {
    const bindings = packageBindings(read(file));
    expect(bindings.length).toBeGreaterThan(0);
    for (const { subpath, names } of bindings) {
      const source = sourceModule(subpath);
      expect(source, `${PACKAGE_NAME}/${subpath}`).toBeDefined();
      const exports = await import(source!);
      for (const name of names) expect(exports[name], `${name} from ${subpath}`).toBeDefined();
    }
  });

  it("keeps the route config Next.js reads statically as literals", () => {
    expect(read("src/app/admin/[[...path]]/page.tsx")).toContain('export const dynamic = "force-dynamic";');
    expect(read("src/app/(public)/[[...slug]]/page.tsx")).toContain("export const dynamicParams = false;");
    expect(read("src/middleware.ts")).toMatch(
      /export const config = \{\s*matcher: \["\/admin\/:path\*", "\/api\/:path\*"\],\s*\};/,
    );
  });

  it("depends on this package and carries the starter content", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies[PACKAGE_NAME]).toBe("file:../musician-site");
    expect(fs.existsSync(path.join(SHELL_DIR, "src/content/collections/pages/_collection.json"))).toBe(true);
  });
});
