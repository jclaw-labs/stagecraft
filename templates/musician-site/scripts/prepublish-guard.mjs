/**
 * `prepublishOnly` guard: refuse `npm publish` from this directory. In
 * the monorepo the package.json depends on the upgraders through
 * `file:` and maps `#` imports to `src/` through `source` conditions,
 * neither of which works once installed. Publish the tarball that
 * `scripts/pack-musician-site.mjs` at the repo root packs from a staged
 * copy instead (docs/runbook.md §11); its package.json passes this check.
 *
 * Usage: npm publish runs it; `node scripts/prepublish-guard.mjs` by hand.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * What stops `pkg` from being published as it stands.
 *
 * @param {{ dependencies?: Record<string, string>; imports?: Record<string, unknown> }} pkg
 * @returns {string[]}
 */
export function publishProblems(pkg) {
  const problems = [];
  for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
    if (String(spec).startsWith("file:")) problems.push(`dependency ${name} is ${spec}`);
  }
  for (const [key, target] of Object.entries(pkg.imports ?? {})) {
    if (target && typeof target === "object" && "source" in target) {
      problems.push(`imports ${key} has a source condition`);
    }
  }
  return problems;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const problems = publishProblems(JSON.parse(fs.readFileSync("package.json", "utf8")));
  if (problems.length > 0) {
    console.error(
      [
        "Refusing to publish this directory. Publish the tarball from `npm run pack-musician-site -- --release`",
        "at the repo root instead (docs/runbook.md §11):",
        ...problems.map((p) => `  - ${p}`),
      ].join("\n"),
    );
    process.exit(1);
  }
}
