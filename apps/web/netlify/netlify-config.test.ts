import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Netlify deploys every file in the functions directory as a function, and
// resolves the directory from the repo root. Guards the wiring for the
// scheduled queue drain (docs/runbook.md §8).
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");

describe("netlify.toml", () => {
  const toml = readFileSync(join(appDir, "netlify.toml"), "utf8");
  const directory = /\[functions\][^[]*?directory\s*=\s*"([^"]+)"/.exec(toml)?.[1];

  it("points the functions directory at apps/web/netlify/functions", () => {
    expect(directory).toBeDefined();
    expect(resolve(repoRoot, directory!)).toBe(join(appDir, "netlify", "functions"));
  });

  it("keeps only function entry points in the functions directory", () => {
    expect(readdirSync(join(appDir, "netlify", "functions"))).toEqual(["drain-jobs.ts"]);
  });
});
