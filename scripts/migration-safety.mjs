#!/usr/bin/env node
// @ts-check
/**
 * migration-safety.mjs — flags Prisma migrations that aren't backward
 * compatible (#361).
 *
 * On push to main, CI applies pending migrations to production at the same
 * time as the new code deploys, so for a while the *old* code runs against
 * the *new* schema. A migration is only safe if the old code keeps working
 * after it lands: expand first (add), contract later (drop) in a separate PR
 * once no deployed code uses the old shape. See docs/runbook.md §9.
 *
 * Flagged in new migration files:
 *   - DROP TABLE
 *   - DROP COLUMN
 *   - ALTER COLUMN ... TYPE / SET DATA TYPE
 *   - SET NOT NULL (always: a backfill in the same file doesn't help the old
 *     code, which can still insert NULLs)
 *   - ADD COLUMN ... NOT NULL without a DEFAULT (old code's inserts fail)
 *   - RENAME in ALTER TABLE / ALTER TYPE (tables, columns, enum types/values)
 * Flagged in the diff itself:
 *   - any change to, deletion or rename of an existing migration file
 *     (applied migrations are immutable; Prisma checksums them)
 *
 * Comments, string literals and quoted identifiers are masked before
 * matching, so `-- DROP TABLE` or `DEFAULT 'drop table'` don't trip it.
 *
 * Usage (from the repo root):
 *   node scripts/migration-safety.mjs --base origin/main   # CI: diff vs merge base
 *   node scripts/migration-safety.mjs FILE.sql...           # scan given files
 *
 * The PR label `migration:destructive-ok` skips the check in CI.
 * No dependencies: CI runs it without `npm ci`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = "packages/db/prisma/migrations";
export const ALLOW_LABEL = "migration:destructive-ok";

/** @typedef {'drop-table' | 'drop-column' | 'alter-column-type' | 'set-not-null' | 'add-not-null-without-default' | 'rename' | 'edited-migration'} FindingKind */

/**
 * @typedef {object} Finding
 * @property {FindingKind} kind
 * @property {string} file
 * @property {number} line   1-based; 0 when the finding is about the whole file
 * @property {string} message
 */

/** @type {Record<Exclude<FindingKind, 'edited-migration'>, string>} */
const MESSAGES = {
  "drop-table": "DROP TABLE breaks old code still reading the table",
  "drop-column": "DROP COLUMN breaks old code still selecting the column",
  "alter-column-type": "changing a column's type can break old code reading or writing it",
  "set-not-null": "SET NOT NULL breaks old code that inserts without the column",
  "add-not-null-without-default": "ADD COLUMN ... NOT NULL without DEFAULT breaks old code's inserts",
  rename: "RENAME breaks old code using the old name",
};

/**
 * Replaces comments with spaces and the contents of string literals and
 * quoted identifiers with `_`, keeping length and newlines so offsets in the
 * result map 1:1 onto the original text.
 * @param {string} sql
 * @returns {string}
 */
export function maskSql(sql) {
  let out = "";
  let i = 0;
  const keepNewline = (/** @type {string} */ c, /** @type {string} */ fill) => (c === "\n" ? "\n" : fill);
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && next === "*") {
      // Postgres block comments nest.
      let depth = 0;
      while (i < sql.length) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          out += "  ";
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          out += "  ";
          i += 2;
          if (depth === 0) break;
        } else {
          out += keepNewline(sql[i], " ");
          i++;
        }
      }
    } else if (c === "'" || c === '"') {
      out += c;
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) {
          out += "__";
          i += 2;
        } else if (sql[i] === c) {
          out += c;
          i++;
          break;
        } else {
          out += keepNewline(sql[i], "_");
          i++;
        }
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Splits masked SQL on `;` into statements with their start offsets.
 * @param {string} masked
 * @returns {{ text: string, start: number }[]}
 */
function splitStatements(masked) {
  /** @type {{ text: string, start: number }[]} */
  const out = [];
  let start = 0;
  for (let i = 0; i <= masked.length; i++) {
    if (i === masked.length || masked[i] === ";") {
      const text = masked.slice(start, i);
      if (text.trim()) out.push({ text, start });
      start = i + 1;
    }
  }
  return out;
}

/**
 * Splits an ALTER TABLE statement's action list on top-level commas.
 * @param {string} text
 * @param {number} base offset of `text` in the file
 * @returns {{ text: string, start: number }[]}
 */
function splitActions(text, base) {
  /** @type {{ text: string, start: number }[]} */
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (i === text.length || (c === "," && depth === 0)) {
      out.push({ text: text.slice(start, i), start: base + start });
      start = i + 1;
    }
  }
  return out;
}

const IDENT = String.raw`(?:"[^"]*"|[A-Za-z_][\w$]*)`;

/** Patterns matched anywhere in a statement. */
const STATEMENT_PATTERNS = /** @type {const} */ ([
  ["drop-table", /\bDROP\s+TABLE\b/gi],
  ["drop-column", /\bDROP\s+COLUMN\b/gi],
  ["alter-column-type", new RegExp(String.raw`\bALTER\s+(?:COLUMN\s+)?${IDENT}\s+(?:SET\s+DATA\s+)?TYPE\b`, "gi")],
  ["set-not-null", /\bSET\s+NOT\s+NULL\b/gi],
]);

/**
 * Finds the backward-incompatible statements in one migration's SQL.
 * @param {string} sql
 * @param {string} file used in the findings
 * @returns {Finding[]}
 */
export function scanSql(sql, file) {
  const masked = maskSql(sql);
  const lineAt = (/** @type {number} */ offset) => masked.slice(0, offset).split("\n").length;
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {Exclude<FindingKind, 'edited-migration'>} */ kind, /** @type {number} */ offset) => {
    findings.push({ kind, file, line: lineAt(offset), message: MESSAGES[kind] });
  };

  for (const stmt of splitStatements(masked)) {
    for (const [kind, re] of STATEMENT_PATTERNS) {
      for (const m of stmt.text.matchAll(re)) add(kind, stmt.start + (m.index ?? 0));
    }

    const lead = stmt.text.match(/^\s*ALTER\s+(TABLE|TYPE)\b/i);
    if (!lead) continue;
    const rename = stmt.text.match(/\bRENAME\b/i);
    if (rename) add("rename", stmt.start + (rename.index ?? 0));

    if (lead[1].toUpperCase() !== "TABLE") continue;
    for (const action of splitActions(stmt.text, stmt.start)) {
      const addCol = action.text.match(/\bADD\s+(?:COLUMN\s+)?(?!CONSTRAINT\b|PRIMARY\b|UNIQUE\b|FOREIGN\b|CHECK\b|EXCLUDE\b)/i);
      if (!addCol) continue;
      if (/\bNOT\s+NULL\b/i.test(action.text) && !/\b(?:DEFAULT|GENERATED)\b/i.test(action.text)) {
        add("add-not-null-without-default", action.start + (addCol.index ?? 0));
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

/**
 * Classifies `git diff --name-status` output for the migrations dir: added
 * `.sql` files get scanned; any other change to an existing `.sql` file is a
 * finding on its own.
 * @param {string} nameStatus
 * @returns {{ added: string[], edited: Finding[] }}
 */
export function classifyDiff(nameStatus) {
  /** @type {string[]} */
  const added = [];
  /** @type {Finding[]} */
  const edited = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    const code = status[0];
    // For renames/copies the old path comes first.
    const oldPath = paths[0];
    const newPath = paths[paths.length - 1];
    if (code === "A") {
      if (newPath.endsWith(".sql")) added.push(newPath);
    } else if (oldPath.endsWith(".sql")) {
      const what = { M: "modified", D: "deleted", R: "renamed", C: "copied", T: "changed type" }[code] ?? `changed (${status})`;
      edited.push({
        kind: "edited-migration",
        file: oldPath,
        line: 0,
        message: `existing migration ${what}; applied migrations are immutable, add a new migration instead`,
      });
      if (code === "C" && newPath.endsWith(".sql")) added.push(newPath);
    }
  }
  return { added, edited };
}

/**
 * @param {string[]} argv
 * @param {{ log?: (s: string) => void, cwd?: string }} [io]
 * @returns {number} exit code
 */
export function main(argv, io = {}) {
  const log = io.log ?? ((s) => console.log(s));
  const cwd = io.cwd ?? process.cwd();
  /** @type {string | undefined} */
  let base;
  /** @type {string[]} */
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base") {
      base = argv[++i];
      if (base === undefined) throw new Error("--base needs a value");
    } else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else files.push(arg);
  }
  if (base ? files.length > 0 : files.length === 0) {
    throw new Error("pass --base REF, or migration files to scan");
  }

  /** @type {Finding[]} */
  let findings = [];
  /** @type {string[]} */
  let toScan = files;
  if (base) {
    const mergeBase = git(["merge-base", base, "HEAD"], cwd).trim();
    const diff = git(["diff", "--name-status", "-M", mergeBase, "HEAD", "--", MIGRATIONS_DIR], cwd);
    const { added, edited } = classifyDiff(diff);
    findings = edited;
    toScan = added;
    log(`migration safety: ${added.length} new migration file(s) since ${mergeBase.slice(0, 12)} (merge base with ${base})`);
  }
  for (const file of toScan) {
    findings.push(...scanSql(fs.readFileSync(path.resolve(cwd, file), "utf8"), file));
  }

  for (const f of findings) {
    const loc = f.line ? `,line=${f.line}` : "";
    log(`::error file=${f.file}${loc},title=Backward-incompatible migration (${f.kind})::${f.message}`);
  }
  if (findings.length === 0) {
    log("ok: no backward-incompatible migration changes");
    return 0;
  }
  log(
    `${findings.length} finding(s). Split the change into expand/contract steps (docs/runbook.md §9), ` +
      `or, if it is safe for the code running in production, add the PR label \`${ALLOW_LABEL}\` and re-run this job.`,
  );
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }
}
