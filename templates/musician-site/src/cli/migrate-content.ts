/**
 * `stagecraft-site migrate-content`: run the content upgrader chain over
 * a local checkout (ADR-016 §3). The CMS upgrades `_collection.json` on
 * read and writes the current `schemaVersion` back on the next save; this
 * does the same for every collection at once. The platform's
 * `upgrade_site` job runs the same chain.
 *
 * The bin ships only in the published `@jclaw-labs/musician-site`
 * package, so this runs only in a site that depends on it (after #422),
 * as `npx --no-install stagecraft-site migrate-content`. A site that is a
 * copy of the template has no bin: its CMS upgrades each collection on
 * read and writes it back on the next save (runbook §11).
 *
 * Each file is written atomically (a temporary file in the same
 * directory, then a rename) as the chain's steps return it: the step's
 * key order, two-space JSON. The CLI doesn't validate or canonicalize the
 * result against the zod schema, which the CLI's plain-Node import rule
 * keeps out of `src/cli/`; the next CMS read validates it, and the next
 * save rewrites it in schema key order.
 *
 * Plain Node like the rest of the CLI: `node:` builtins and the upgraders
 * package, which imports nothing.
 */

import fs from "node:fs";
import path from "node:path";

import {
  newerSchemaVersionMessage,
  OLDEST_SCHEMA_VERSION,
  olderSchemaVersionMessage,
  upgradeCollection,
  type CollectionJson,
} from "@jclaw-labs/content-upgraders";

import type { CliIo } from "./run.js";

export const MIGRATE_CONTENT_USAGE = `Usage: stagecraft-site migrate-content [--check] [--content-dir <dir>]

Upgrade every src/content/collections/*/_collection.json to the
schemaVersion this package reads, writing changed files in place.

Only sites on the published @jclaw-labs/musician-site package have this
command; run it there as: npx --no-install stagecraft-site migrate-content
A copy of the template has no CLI: its CMS upgrades each collection on
read and writes it back on the next save.

Each file is written atomically, with the keys in the order the upgrade
steps leave them. The output isn't validated here: the next CMS read
validates it, and the next save rewrites it in the schema's key order.

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

/** Replace `file` with `content` atomically: a temporary sibling, then a rename. */
function writeFileAtomic(file: string, content: string): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
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
 * is (now) at `target`, 1 on a file newer than `target` or older than
 * the chain, unreadable JSON or JSON that isn't an object, a failed step,
 * or anything left to upgrade under `--check`.
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      io.err(`${name}: not valid JSON (${(error as Error).message})\n`);
      failed = true;
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      io.err(`${name}: not a JSON object\n`);
      failed = true;
      continue;
    }
    const collection = parsed as CollectionJson;
    const from = collection.schemaVersion;
    if (typeof from === "number" && from > target) {
      io.err(`${name}: ${newerSchemaVersionMessage(from, target)}\n`);
      failed = true;
      continue;
    }
    if (typeof from === "number" && from < OLDEST_SCHEMA_VERSION) {
      io.err(`${name}: ${olderSchemaVersionMessage(from, OLDEST_SCHEMA_VERSION)}\n`);
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
      writeFileAtomic(file, JSON.stringify(upgraded, null, 2) + "\n");
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
