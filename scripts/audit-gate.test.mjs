import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluate,
  main,
  normalizeProject,
  parseAllowlist,
  severityAtLeast,
} from "./audit-gate.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal npm audit v2 advisory object, as it appears in a `via` array. */
function advisory(name, ghsa, severity, source = 1) {
  return {
    source,
    name,
    dependency: name,
    title: `${name} is vulnerable`,
    url: `https://github.com/advisories/${ghsa}`,
    severity,
    range: "<9.9.9",
  };
}

/** Builds a report from `{ pkg: { severity, via } }`. */
function report(vulnerabilities) {
  return { auditReportVersion: 2, vulnerabilities, metadata: {} };
}

const BRACES = "GHSA-vfj7-8cjw-p6xm";
const DEEPMERGE = "GHSA-ggr8-5vv4-36mx";
const OTHER = "GHSA-35jh-r3h4-6jhm";

const allowlist = parseAllowlist({
  entries: [
    {
      package: "braces",
      advisories: [BRACES],
      projects: [".", "templates/musician-site"],
      reason: "no fix",
      removeWhen: "fixed",
    },
    {
      package: "deepmerge-ts",
      advisories: [DEEPMERGE],
      projects: ["."],
      reason: "pinned",
      removeWhen: "unpinned",
    },
  ],
});

/** braces advisory plus a via-only dependent chain, like the real tree. */
const bracesChain = {
  braces: { severity: "high", via: [advisory("braces", BRACES, "high")] },
  micromatch: { severity: "high", via: ["braces"] },
  "fast-glob": { severity: "high", via: ["micromatch"] },
};

describe("severityAtLeast", () => {
  it("orders npm severities", () => {
    expect(severityAtLeast("critical", "high")).toBe(true);
    expect(severityAtLeast("high", "high")).toBe(true);
    expect(severityAtLeast("moderate", "high")).toBe(false);
    expect(severityAtLeast("info", "info")).toBe(true);
  });
});

describe("normalizeProject", () => {
  it.each([
    ["./", "."],
    [".", "."],
    ["templates/musician-site/", "templates/musician-site"],
    ["./templates/musician-site", "templates/musician-site"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeProject(input)).toBe(expected);
  });
});

describe("parseAllowlist", () => {
  const valid = {
    package: "x",
    advisories: [BRACES],
    projects: ["./"],
    reason: "r",
    removeWhen: "w",
  };

  it("accepts a valid entry and normalizes projects", () => {
    expect(parseAllowlist({ entries: [valid] })[0].projects).toEqual(["."]);
  });

  it("rejects a file without an entries array", () => {
    expect(() => parseAllowlist({})).toThrow(/entries/);
    expect(() => parseAllowlist(null)).toThrow(/entries/);
  });

  it.each(["package", "reason", "removeWhen"])("requires a non-empty %s", (key) => {
    expect(() => parseAllowlist({ entries: [{ ...valid, [key]: " " }] })).toThrow(key);
  });

  it.each(["advisories", "projects"])("requires a non-empty %s array", (key) => {
    expect(() => parseAllowlist({ entries: [{ ...valid, [key]: [] }] })).toThrow(key);
  });

  it("rejects advisory ids that are not exact GHSA ids", () => {
    expect(() =>
      parseAllowlist({ entries: [{ ...valid, advisories: ["CVE-2024-4068"] }] }),
    ).toThrow(/GHSA/);
    expect(() =>
      parseAllowlist({ entries: [{ ...valid, advisories: [`${BRACES}x`] }] }),
    ).toThrow(/GHSA/);
  });

  it("parses the checked-in allowlist", () => {
    const file = path.join(repoRoot, ".github/audit-allowlist.json");
    const entries = parseAllowlist(JSON.parse(fs.readFileSync(file, "utf8")));
    expect(entries.map((e) => e.package)).toEqual(["braces", "postcss", "deepmerge-ts"]);
  });
});

describe("evaluate", () => {
  const level = "high";

  it("passes when every high advisory, and its via-only dependents, is allowlisted", () => {
    const result = evaluate({ report: report(bracesChain), allowlist, project: ".", level });
    expect(result.blocking).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.allowed.map((a) => a.id)).toEqual([BRACES]);
  });

  it("blocks a high advisory outside the allowlist", () => {
    const result = evaluate({
      report: report({
        ...bracesChain,
        lodash: { severity: "high", via: [advisory("lodash", OTHER, "high", 2)] },
      }),
      allowlist,
      project: ".",
      level,
    });
    expect(result.blocking.map((a) => a.id)).toEqual([OTHER]);
  });

  it("blocks critical advisories at level high", () => {
    const result = evaluate({
      report: report({ x: { severity: "critical", via: [advisory("x", OTHER, "critical")] } }),
      allowlist,
      project: ".",
      level,
    });
    expect(result.blocking).toHaveLength(1);
  });

  it("ignores advisories below the level", () => {
    const result = evaluate({
      report: report({ x: { severity: "moderate", via: [advisory("x", OTHER, "moderate")] } }),
      allowlist,
      project: ".",
      level,
    });
    expect(result.blocking).toEqual([]);
  });

  it("applies an entry only to its listed projects", () => {
    const vulns = { "deepmerge-ts": { severity: "high", via: [advisory("deepmerge-ts", DEEPMERGE, "high")] } };
    expect(evaluate({ report: report(vulns), allowlist, project: "./", level }).blocking).toEqual([]);
    expect(
      evaluate({ report: report(vulns), allowlist, project: "templates/musician-site", level })
        .blocking.map((a) => a.id),
    ).toEqual([DEEPMERGE]);
  });

  it("blocks when a package mixes an allowlisted and a new high advisory", () => {
    const result = evaluate({
      report: report({
        braces: {
          severity: "high",
          via: [advisory("braces", BRACES, "high", 1), advisory("braces", OTHER, "high", 2)],
        },
      }),
      allowlist,
      project: ".",
      level,
    });
    expect(result.blocking.map((a) => a.id)).toEqual([OTHER]);
  });

  it("matches advisories by GHSA id, not package name", () => {
    const result = evaluate({
      report: report({ braces: { severity: "high", via: [advisory("braces", OTHER, "high")] } }),
      allowlist,
      project: ".",
      level,
    });
    expect(result.blocking.map((a) => a.id)).toEqual([OTHER]);
  });

  it("fails closed on a high package whose via chain names no high advisory", () => {
    const result = evaluate({
      report: report({
        a: { severity: "high", via: ["b"] },
        b: { severity: "high", via: ["a"] },
      }),
      allowlist,
      project: ".",
      level,
    });
    expect(result.unresolved.sort()).toEqual(["a", "b"]);
  });

  it("reports entries for this project that match nothing as stale", () => {
    const result = evaluate({ report: report({}), allowlist, project: ".", level });
    expect(result.stale.map((e) => e.package)).toEqual(["braces", "deepmerge-ts"]);
    const template = evaluate({ report: report({}), allowlist, project: "templates/musician-site", level });
    expect(template.stale.map((e) => e.package)).toEqual(["braces"]);
  });

  it("throws on an npm error report", () => {
    expect(() =>
      evaluate({ report: { error: { summary: "network down" } }, allowlist, project: ".", level }),
    ).toThrow(/network down/);
  });

  it("throws on an unrecognized report shape", () => {
    expect(() => evaluate({ report: { vulnerabilities: {} }, allowlist, project: ".", level })).toThrow(
      /auditReportVersion/,
    );
    expect(() => evaluate({ report: "nope", allowlist, project: ".", level })).toThrow();
  });
});

describe("main", () => {
  function setup(vulns) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-gate-"));
    fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report(vulns)));
    fs.writeFileSync(
      path.join(dir, "allowlist.json"),
      JSON.stringify({
        entries: [
          { package: "braces", advisories: [BRACES], projects: ["."], reason: "r", removeWhen: "w" },
        ],
      }),
    );
    const lines = [];
    const run = (...extra) =>
      main(["--input", "report.json", "--project", ".", "--allowlist", "allowlist.json", ...extra], {
        cwd: dir,
        log: (s) => lines.push(s),
      });
    return { run, lines };
  }

  it("exits 0 when only allowlisted advisories remain", () => {
    const { run, lines } = setup(bracesChain);
    expect(run()).toBe(0);
    expect(lines.some((l) => l.startsWith("allowlisted: braces"))).toBe(true);
  });

  it("exits 1 and emits an error annotation for a new high advisory", () => {
    const { run, lines } = setup({ x: { severity: "high", via: [advisory("x", OTHER, "high")] } });
    expect(run()).toBe(1);
    expect(lines.some((l) => l.startsWith("::error") && l.includes(OTHER))).toBe(true);
  });

  it("honours --level", () => {
    const { run } = setup({ x: { severity: "high", via: [advisory("x", OTHER, "high")] } });
    expect(run("--level", "critical")).toBe(0);
  });

  it("warns about stale entries without failing", () => {
    const { run, lines } = setup({});
    expect(run()).toBe(0);
    expect(lines.some((l) => l.startsWith("::warning") && l.includes("braces"))).toBe(true);
  });

  it("exits 1 when the report cannot be evaluated", () => {
    const { run, lines } = setup({});
    expect(run("--input", "allowlist.json")).toBe(1);
    expect(lines.some((l) => l.startsWith("::error"))).toBe(true);
  });

  it("rejects bad arguments", () => {
    expect(() => main([])).toThrow(/project dirs/);
    expect(() => main(["--level", "severe", "."])).toThrow(/--level/);
    expect(() => main(["--bogus"])).toThrow(/unknown option/);
    expect(() => main(["--input", "r.json"])).toThrow(/--project/);
  });
});
