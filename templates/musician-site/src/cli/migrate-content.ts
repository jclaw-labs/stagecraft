/**
 * `stagecraft-site migrate-content`: run the content upgrader chain over
 * a local checkout (ADR-016 §3). The CMS upgrades `_collection.json` on
 * read and writes the current `schemaVersion` back on the next save; this
 * does the same for every collection at once, for a site handled by hand.
 * The platform's `upgrade_site` job runs the same chain.
 *
 * Plain Node like the rest of the CLI: `node:` builtins and the upgraders
 * package, which imports nothing.
 */

import fs from "node:fs";
import path from "node:path";

import { upgradeCollection, type CollectionJson } from "@jclaw-labs/content-upgraders";

import type { CliIo } from "./run.js";

export const MIGRATE_CONTENT_USAGE = `Usage: stagecraft-site migrate-content [--check] [--content-dir <dir>]

Upgrade every src/content/collections/*/_collection.json to the
schemaVersion this package reads, writing changed files in place.

Options:
  --check              List what would change, and exit 1 if anything would
  --content-dir <dir>  Content directory (default: src/content)
`;

/** The `schemaVersion` this package reads and writes, from its package.json. */
export function packageSchemaVersion(): number {
  const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    stagecraft: { schemaVersion: number };
  };
  return pkg.stagecraft.schemaVersion;
}

/** Every `_collection.json` under `contentDir`, sorted. */
function collectionFiles(contentDir: string): string[] {
  const collections = path.join(contentDir, "collections");
  if (!fs.existsSync(collections)) return [];
  return fs
    .readdirSync(collections, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(collections, entry.name, "_collection.json"))
    .filter((file) => fs.existsSync(file))
    .sort();
}

type Options = { check: boolean; contentDir: string };

/** Parse `argv` (after the command), or return a usage error. */
function parseArgs(argv: readonly string[], cwd: string): Options | string {
  const options: Options = { check: false, contentDir: path.join(cwd, "src", "content") };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--content-dir" && argv[i + 1] !== undefined) options.contentDir = path.resolve(cwd, argv[++i]);
    else return `unknown option "${arg}"`;
  }
  return options;
}

/**
 * Run `migrate-content`. Returns the exit code: 0 when every collection
 * is (now) at `target`, 1 on a file newer than `target`, unreadable JSON,
 * a failed step, or anything left to upgrade under `--check`.
 */
export function migrateContent(
  argv: readonly string[],
  io: CliIo,
  { cwd = process.cwd(), target = packageSchemaVersion() }: { cwd?: string; target?: number } = {},
): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.out(MIGRATE_CONTENT_USAGE);
    return 0;
  }
  const options = parseArgs(argv, cwd);
  if (typeof options === "string") {
    io.err(`stagecraft-site migrate-content: ${options}\n\n${MIGRATE_CONTENT_USAGE}`);
    return 1;
  }

  const files = collectionFiles(options.contentDir);
  if (files.length === 0) {
    io.err(`stagecraft-site migrate-content: no collections under ${path.relative(cwd, options.contentDir) || "."}\n`);
    return 1;
  }

  let failed = false;
  let pending = 0;
  for (const file of files) {
    const name = path.relative(cwd, file);
    let collection: CollectionJson;
    try {
      collection = JSON.parse(fs.readFileSync(file, "utf8")) as CollectionJson;
    } catch (error) {
      io.err(`${name}: not valid JSON (${(error as Error).message})\n`);
      failed = true;
      continue;
    }
    const from = collection.schemaVersion;
    if (typeof from === "number" && from > target) {
      io.err(
        `${name}: schemaVersion ${from} is newer than the ${target} this package reads. ` +
          `Update @jclaw-labs/musician-site to a release that reads schemaVersion ${from}.\n`,
      );
      failed = true;
      continue;
    }
    if (from === target) continue;
    let upgraded: CollectionJson;
    try {
      upgraded = upgradeCollection(collection, target);
    } catch (error) {
      io.err(`${name}: ${(error as Error).message}\n`);
      failed = true;
      continue;
    }
    pending++;
    if (options.check) {
      io.out(`${name}: schemaVersion ${String(from)} → ${target} (not written, --check)\n`);
    } else {
      fs.writeFileSync(file, JSON.stringify(upgraded, null, 2) + "\n");
      io.out(`${name}: schemaVersion ${String(from)} → ${target}\n`);
    }
  }

  if (!failed) {
    io.out(
      pending === 0
        ? `All ${files.length} collections are at schemaVersion ${target}.\n`
        : `${options.check ? "Would upgrade" : "Upgraded"} ${pending} of ${files.length} collections to schemaVersion ${target}.\n`,
    );
  }
  return failed || (options.check && pending > 0) ? 1 : 0;
}
