/**
 * The artist-repo shell (`templates/musician-site-shell`, ADR-016 §1)
 * against this package.
 *
 * The shell is a handful of files that re-export from the package, and
 * changing it is a major release (ADR-016 §3). These tests keep the two
 * in step from the package's side: every module and export the shell
 * names exists here, the route config Next.js reads statically is in
 * place, and the shell's file list is the one this package's
 * `REQUIRED_SHELL_VERSION` describes. The e2e suite runs the shell itself.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "#lib/with-stagecraft.js";

const SHELL_DIR = path.resolve(import.meta.dirname, "../../musician-site-shell");
const SRC_DIR = import.meta.dirname;

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
