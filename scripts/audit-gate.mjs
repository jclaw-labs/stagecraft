#!/usr/bin/env node
// @ts-check
/**
 * audit-gate.mjs — blocking `npm audit` gate with a checked-in allowlist.
 *
 * Runs `npm audit --json` in each project directory and fails when any
 * advisory at or above `--level` (default `high`) is present, unless that
 * advisory's GHSA id is allowlisted for the project in
 * `.github/audit-allowlist.json`. Packages that are only vulnerable through a
 * dependency chain (npm's string `via` entries) are judged by the advisories
 * the chain ends in, so an allowlisted advisory also clears every package
 * that depends on it.
 *
 * Usage (from the repo root):
 *   node scripts/audit-gate.mjs [--level high] [--allowlist FILE] DIR...
 *   node scripts/audit-gate.mjs --input REPORT.json --project DIR
 *
 * `--input` evaluates a saved `npm audit --json` report instead of running
 * npm; `--project` names which allowlist scope it belongs to.
 *
 * No dependencies: CI runs it without `npm ci`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {'info' | 'low' | 'moderate' | 'high' | 'critical'} Severity */

/** Ordered lowest to highest, matching npm's own scale. */
export const SEVERITIES = /** @type {const} */ ([
  "info",
  "low",
  "moderate",
  "high",
  "critical",
]);

/**
 * @typedef {object} AllowlistEntry
 * @property {string} package
 * @property {string[]} advisories GHSA ids
 * @property {string[]} projects  project dirs relative to the repo root
 * @property {string} reason
 * @property {string} removeWhen
 */

/**
 * @typedef {object} Advisory
 * @property {string} id      GHSA id, or `npm:<source>` when the URL has none
 * @property {string} url
 * @property {string} title
 * @property {Severity} severity
 * @property {string} package
 * @property {string} range
 */

/**
 * @typedef {object} GateResult
 * @property {Advisory[]} blocking   advisories at/above the level, not allowlisted
 * @property {Advisory[]} allowed    advisories at/above the level, allowlisted
 * @property {string[]} unresolved   packages at/above the level whose `via` chain names no advisory
 * @property {AllowlistEntry[]} stale entries scoped to this project that matched nothing
 */

const GHSA_RE = /GHSA(-[23456789cfghjmpqrvwx]{4}){3}/;
const GHSA_EXACT = new RegExp(`^${GHSA_RE.source}$`);

/**
 * @param {unknown} value
 * @returns {value is Severity}
 */
export function isSeverity(value) {
  return typeof value === "string" && SEVERITIES.includes(/** @type {Severity} */ (value));
}

/**
 * @param {Severity} severity
 * @param {Severity} level
 */
export function severityAtLeast(severity, level) {
  return SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf(level);
}

/**
 * Normalizes a project directory so `./`, `templates/musician-site/` and
 * `templates/musician-site` compare equal.
 * @param {string} dir
 */
export function normalizeProject(dir) {
  const normalized = path.posix.normalize(dir.replaceAll("\\", "/")).replace(/\/+$/, "");
  return normalized === "" ? "." : normalized;
}

/**
 * Validates the parsed allowlist file. Throws on any malformed entry so a
 * typo can't silently widen or narrow the gate.
 * @param {unknown} data
 * @returns {AllowlistEntry[]}
 */
export function parseAllowlist(data) {
  if (!data || typeof data !== "object" || !Array.isArray(/** @type {any} */ (data).entries)) {
    throw new Error("allowlist must be an object with an `entries` array");
  }
  /** @type {unknown[]} */
  const entries = /** @type {any} */ (data).entries;
  return entries.map((raw, i) => {
    const where = `allowlist entry ${i}`;
    if (!raw || typeof raw !== "object") throw new Error(`${where} must be an object`);
    const entry = /** @type {Record<string, unknown>} */ (raw);
    for (const key of ["package", "reason", "removeWhen"]) {
      const value = entry[key];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${where} needs a non-empty \`${key}\``);
      }
    }
    for (const key of ["advisories", "projects"]) {
      const value = entry[key];
      if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string")) {
        throw new Error(`${where} needs a non-empty string array \`${key}\``);
      }
    }
    const advisories = /** @type {string[]} */ (entry.advisories);
    for (const id of advisories) {
      if (!GHSA_EXACT.test(id)) {
        throw new Error(`${where} has an advisory that is not a GHSA id: ${id}`);
      }
    }
    return {
      package: /** @type {string} */ (entry.package),
      advisories,
      projects: /** @type {string[]} */ (entry.projects).map(normalizeProject),
      reason: /** @type {string} */ (entry.reason),
      removeWhen: /** @type {string} */ (entry.removeWhen),
    };
  });
}

/**
 * @param {Record<string, unknown>} via an advisory object from a `via` array
 * @returns {Advisory}
 */
function toAdvisory(via) {
  const url = typeof via.url === "string" ? via.url : "";
  const ghsa = url.match(GHSA_RE)?.[0];
  const severity = isSeverity(via.severity) ? via.severity : "critical";
  return {
    id: ghsa ?? `npm:${String(via.source)}`,
    url,
    title: typeof via.title === "string" ? via.title : "",
    severity,
    package: typeof via.name === "string" ? via.name : "",
    range: typeof via.range === "string" ? via.range : "",
  };
}

/**
 * Evaluates one project's `npm audit --json` (report version 2) output.
 * @param {object} args
 * @param {unknown} args.report
 * @param {AllowlistEntry[]} args.allowlist
 * @param {string} args.project
 * @param {Severity} args.level
 * @returns {GateResult}
 */
export function evaluate({ report, allowlist, project, level }) {
  if (!report || typeof report !== "object") throw new Error("audit report is not an object");
  const r = /** @type {Record<string, any>} */ (report);
  if (r.error) {
    throw new Error(`npm audit failed: ${r.error.summary ?? JSON.stringify(r.error)}`);
  }
  if (r.auditReportVersion !== 2 || !r.vulnerabilities || typeof r.vulnerabilities !== "object") {
    throw new Error("unrecognized npm audit report (expected auditReportVersion 2)");
  }
  /** @type {Record<string, { severity?: unknown; via?: unknown[] }>} */
  const vulns = r.vulnerabilities;
  const scope = normalizeProject(project);
  const entries = allowlist.filter((e) => e.projects.includes(scope));
  /** @type {Map<string, AllowlistEntry>} */
  const allowedIds = new Map();
  for (const entry of entries) for (const id of entry.advisories) allowedIds.set(id, entry);

  /** @type {Map<string, Advisory>} every advisory in the report, by id */
  const advisories = new Map();
  for (const vuln of Object.values(vulns)) {
    for (const via of vuln.via ?? []) {
      if (via && typeof via === "object") {
        const advisory = toAdvisory(/** @type {Record<string, unknown>} */ (via));
        advisories.set(advisory.id, advisory);
      }
    }
  }

  /**
   * Advisories a package is vulnerable through, following string `via`
   * links to other packages in the report.
   * @param {string} name
   * @param {Set<string>} seen
   * @returns {Advisory[]}
   */
  const reachable = (name, seen = new Set()) => {
    if (seen.has(name)) return [];
    seen.add(name);
    /** @type {Advisory[]} */
    const found = [];
    for (const via of vulns[name]?.via ?? []) {
      if (typeof via === "string") found.push(...reachable(via, seen));
      else if (via && typeof via === "object") found.push(toAdvisory(/** @type {any} */ (via)));
    }
    return found;
  };

  /** @type {string[]} */
  const unresolved = [];
  for (const [name, vuln] of Object.entries(vulns)) {
    const severity = isSeverity(vuln.severity) ? vuln.severity : "critical";
    if (!severityAtLeast(severity, level)) continue;
    // A package rated at/above the level must trace to at least one advisory
    // that is too; otherwise the report is inconsistent and we fail closed.
    if (!reachable(name).some((a) => severityAtLeast(a.severity, level))) unresolved.push(name);
  }

  const relevant = [...advisories.values()].filter((a) => severityAtLeast(a.severity, level));
  const blocking = relevant.filter((a) => !allowedIds.has(a.id));
  const allowed = relevant.filter((a) => allowedIds.has(a.id));
  const stale = entries.filter((e) => !e.advisories.some((id) => advisories.has(id)));
  return { blocking, allowed, unresolved, stale };
}

/** @param {string} dir */
function runNpmAudit(dir) {
  const out = spawnSync("npm", ["audit", "--json"], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (out.error) throw out.error;
  // npm audit exits 1 whenever it finds anything; the JSON is what matters.
  try {
    return JSON.parse(out.stdout);
  } catch {
    throw new Error(`npm audit in ${dir} produced no JSON (exit ${out.status}): ${out.stderr.trim()}`);
  }
}

/**
 * @param {string[]} argv
 * @param {{ log?: (s: string) => void; cwd?: string }} [io]
 * @returns {number} exit code
 */
export function main(argv, io = {}) {
  const log = io.log ?? ((s) => console.log(s));
  const cwd = io.cwd ?? process.cwd();
  /** @type {Severity} */
  let level = "high";
  let allowlistPath = path.join(cwd, ".github/audit-allowlist.json");
  /** @type {string | undefined} */
  let input;
  /** @type {string | undefined} */
  let inputProject;
  /** @type {string[]} */
  const dirs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === "--level") {
      const value = next();
      if (!isSeverity(value)) throw new Error(`--level must be one of ${SEVERITIES.join(", ")}`);
      level = value;
    } else if (arg === "--allowlist") allowlistPath = path.resolve(cwd, next());
    else if (arg === "--input") input = path.resolve(cwd, next());
    else if (arg === "--project") inputProject = next();
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else dirs.push(arg);
  }
  if (input ? dirs.length > 0 || !inputProject : dirs.length === 0) {
    throw new Error("pass project dirs, or --input REPORT --project DIR");
  }

  const allowlist = parseAllowlist(JSON.parse(fs.readFileSync(allowlistPath, "utf8")));
  /** @type {[string, () => unknown][]} */
  const jobs = input
    ? [[/** @type {string} */ (inputProject), () => JSON.parse(fs.readFileSync(/** @type {string} */ (input), "utf8"))]]
    : dirs.map((dir) => [dir, () => runNpmAudit(path.resolve(cwd, dir))]);

  let failed = false;
  for (const [project, load] of jobs) {
    log(`::group::npm audit gate (${project}, level ${level})`);
    try {
      const result = evaluate({ report: load(), allowlist, project, level });
      for (const a of result.allowed) {
        log(`allowlisted: ${a.package} ${a.id} (${a.severity}) ${a.title}`);
      }
      for (const e of result.stale) {
        log(`::warning title=npm audit allowlist::${e.package} entry matched no advisory in ${project}; remove it from the allowlist for this project`);
      }
      for (const a of result.blocking) {
        log(`::error title=npm audit::${project}: ${a.package} ${a.range} ${a.id} (${a.severity}) ${a.title} ${a.url}`);
      }
      for (const name of result.unresolved) {
        log(`::error title=npm audit::${project}: ${name} is rated at/above ${level} but its via chain names no such advisory`);
      }
      if (result.blocking.length > 0 || result.unresolved.length > 0) failed = true;
      else log(`ok: no ${level}+ advisories outside the allowlist`);
    } catch (err) {
      failed = true;
      log(`::error title=npm audit::${project}: ${err instanceof Error ? err.message : String(err)}`);
    }
    log("::endgroup::");
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }
}
