#!/usr/bin/env node
// @ts-check
/**
 * worker-size-gate.mjs — fails CI when the Cloudflare Worker bundle nears
 * Cloudflare's compressed size limit.
 *
 * `npm run build:worker` ends with a wrangler dry run that prints
 * `Total Upload: <raw> KiB / gzip: <gzip> KiB` but doesn't enforce it. This
 * reads that output, fails above the limit, and warns above a lower line so
 * there's notice before a dependency bump crosses it. Output it can't find
 * the figure in fails too, so a wrangler format change can't turn the gate
 * into a silent pass.
 *
 * Usage (from apps/web):
 *   node scripts/worker-size-gate.mjs [--limit KIB] [--warn KIB] [LOG_FILE]
 *
 * Reads stdin when no LOG_FILE is given. Defaults: --limit 3072 (the 3 MiB
 * Workers Free plan limit), --warn 2900.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_LIMIT_KIB = 3072;
export const DEFAULT_WARN_KIB = 2900;

/** @typedef {'ok' | 'warn' | 'fail'} GateLevel */

/**
 * @typedef {object} GateResult
 * @property {GateLevel} level
 * @property {string} message
 * @property {number | null} gzipKiB null when the figure wasn't found
 */

/** Unit multipliers to KiB for the sizes wrangler prints. */
const UNIT_TO_KIB = /** @type {const} */ ({ KiB: 1, MiB: 1024 });

/** Removes ANSI colour codes, which wrangler adds when it thinks it's on a TTY. */
export function stripAnsi(/** @type {string} */ text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Returns the gzip size in KiB from wrangler's `Total Upload` line, or null
 * when there is none. When the output holds several (a re-run in one log),
 * the last one wins.
 *
 * @param {string} output
 * @returns {number | null}
 */
export function parseGzipKiB(output) {
  const pattern = /Total Upload:.*?\/\s*gzip:\s*([\d,]+(?:\.\d+)?)\s*(KiB|MiB)\b/g;
  let last = null;
  for (const match of stripAnsi(output).matchAll(pattern)) last = match;
  if (!last) return null;

  const value = Number(last[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return value * UNIT_TO_KIB[/** @type {keyof typeof UNIT_TO_KIB} */ (last[2])];
}

/**
 * @param {string} output wrangler (or whole `build:worker`) output
 * @param {{ limitKiB?: number, warnKiB?: number }} [options]
 * @returns {GateResult}
 */
export function evaluate(output, { limitKiB = DEFAULT_LIMIT_KIB, warnKiB = DEFAULT_WARN_KIB } = {}) {
  const gzipKiB = parseGzipKiB(output);
  if (gzipKiB === null) {
    return {
      level: "fail",
      gzipKiB,
      message:
        "Could not find wrangler's `Total Upload: … / gzip: N KiB` line in the build output, so the Worker size is unchecked. Did the dry run fail, or did wrangler change its output format?",
    };
  }

  const figure = `${gzipKiB.toFixed(2)} KiB gzip`;
  const percent = ((gzipKiB / limitKiB) * 100).toFixed(1);
  if (gzipKiB > limitKiB) {
    return {
      level: "fail",
      gzipKiB,
      message: `Worker bundle is ${figure}, over the ${limitKiB} KiB limit (${percent}%). Cloudflare would reject this deploy.`,
    };
  }
  if (gzipKiB >= warnKiB) {
    return {
      level: "warn",
      gzipKiB,
      message: `Worker bundle is ${figure}, ${percent}% of the ${limitKiB} KiB limit (warning line ${warnKiB} KiB).`,
    };
  }
  return {
    level: "ok",
    gzipKiB,
    message: `Worker bundle is ${figure}, ${percent}% of the ${limitKiB} KiB limit.`,
  };
}

/**
 * Parses `--limit N`, `--warn N` and an optional log file path.
 *
 * @param {string[]} argv
 * @returns {{ limitKiB: number, warnKiB: number, file: string | null }}
 */
export function parseArgs(argv) {
  let limitKiB = DEFAULT_LIMIT_KIB;
  let warnKiB = DEFAULT_WARN_KIB;
  /** @type {string | null} */
  let file = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit" || arg === "--warn") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${arg} needs a positive number of KiB`);
      }
      if (arg === "--limit") limitKiB = value;
      else warnKiB = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}`);
    } else if (file === null) {
      file = arg;
    } else {
      throw new Error(`Unexpected argument ${arg}`);
    }
  }

  if (warnKiB > limitKiB) {
    throw new Error(`--warn (${warnKiB}) must not be above --limit (${limitKiB})`);
  }
  return { limitKiB, warnKiB, file };
}

/**
 * CLI entry. Prints a GitHub Actions annotation and returns the exit code.
 *
 * @param {string[]} argv
 * @param {{ readInput?: (file: string | null) => string, log?: (line: string) => void }} [io]
 * @returns {number}
 */
export function main(argv, io = {}) {
  const readInput = io.readInput ?? ((file) => fs.readFileSync(file ?? 0, "utf8"));
  const log = io.log ?? ((line) => console.log(line));

  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    log(`::error::worker-size-gate: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const result = evaluate(readInput(args.file), args);
  if (result.level === "fail") {
    log(`::error::${result.message}`);
    return 1;
  }
  log(result.level === "warn" ? `::warning::${result.message}` : result.message);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
