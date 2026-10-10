/**
 * The public render path stays free of the editor modules: no
 * `build-config.tsx`, no admin components, no Collection view editor.
 * Walks the static (non-`import type`) imports from the public
 * catch-all page, so a transitive import fails here too, not only a
 * direct one.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");
const ENTRY = path.join(SRC, "app/(public)/[[...slug]]/page.tsx");
const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];
// `import … from "x"`, `export … from "x"` and side-effect `import "x"`,
// skipping `import type` / `export type`.
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;

function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
  else return null; // a package
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  return null; // CSS and other assets
}

function renderPathModules(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of fs.readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) {
      const resolved = resolveImport(match[1], file);
      if (resolved) queue.push(resolved);
    }
  }
  return new Set([...seen].map((file) => path.relative(SRC, file)));
}

describe("public render path", () => {
  const modules = renderPathModules(ENTRY);

  it("reaches the render config and the block library", () => {
    expect(modules).toContain("puck/render-config.tsx");
    expect(modules).toContain("puck/config.tsx");
  });

  it("leaves out the editor modules", () => {
    const editorModules = [...modules].filter(
      (file) =>
        file === "puck/build-config.tsx" ||
        file === "puck/collection-view-editor.tsx" ||
        file.startsWith("components/admin/"),
    );
    expect(editorModules).toEqual([]);
  });
});
