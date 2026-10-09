import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMIT_KIB,
  DEFAULT_WARN_KIB,
  evaluate,
  main,
  parseArgs,
  parseGzipKiB,
} from "./worker-size-gate.mjs";

/** The tail of a real `npm run build:worker` log. */
function buildLog(gzip: string) {
  return [
    "template bundle: 351 files, 2679.0 KB raw, 617.4 KB gzipped → src/generated/template-bundle.json",
    "Worker saved in `.open-next/worker.js` 🚀",
    `Total Upload: 12543.86 KiB / gzip: ${gzip}`,
    "Your Worker has access to the following bindings:",
    "--dry-run: exiting now.",
  ].join("\n");
}

function run(argv: string[], input: string) {
  const lines: string[] = [];
  const code = main(argv, { readInput: () => input, log: (line) => lines.push(line) });
  return { code, output: lines.join("\n") };
}

describe("parseGzipKiB", () => {
  it("reads the gzip figure from the Total Upload line", () => {
    expect(parseGzipKiB(buildLog("2621.12 KiB"))).toBe(2621.12);
  });

  it("ignores the template bundle's own gzipped size", () => {
    expect(parseGzipKiB("template bundle: 351 files, 2679.0 KB raw, 617.4 KB gzipped")).toBeNull();
  });

  it("reads through ANSI colour codes", () => {
    expect(parseGzipKiB("\x1b[2mTotal Upload: 12543.86 KiB / gzip: \x1b[1m2621.12\x1b[22m KiB\x1b[0m")).toBe(2621.12);
  });

  it("converts MiB to KiB", () => {
    expect(parseGzipKiB(buildLog("3.5 MiB"))).toBe(3584);
  });

  it("accepts thousands separators", () => {
    expect(parseGzipKiB(buildLog("2,621.12 KiB"))).toBe(2621.12);
  });

  it("takes the last figure when the log has several", () => {
    expect(parseGzipKiB(`${buildLog("100.00 KiB")}\n${buildLog("2621.12 KiB")}`)).toBe(2621.12);
  });

  it.each(["", "Total Upload: 12543.86 KiB", "Total Upload: 12543.86 KiB / gzip: lots"])(
    "returns null when there is no usable figure (%o)",
    (output) => {
      expect(parseGzipKiB(output)).toBeNull();
    },
  );
});

describe("evaluate", () => {
  it("passes below the warning line", () => {
    expect(evaluate(buildLog("2621.12 KiB"))).toMatchObject({ level: "ok", gzipKiB: 2621.12 });
  });

  it("warns at and above the warning line", () => {
    expect(evaluate(buildLog(`${DEFAULT_WARN_KIB} KiB`)).level).toBe("warn");
    expect(evaluate(buildLog("3000.00 KiB")).level).toBe("warn");
  });

  it("still passes, with a warning, at the limit itself", () => {
    expect(evaluate(buildLog(`${DEFAULT_LIMIT_KIB} KiB`)).level).toBe("warn");
  });

  it("fails above the limit", () => {
    const result = evaluate(buildLog("3072.01 KiB"));
    expect(result.level).toBe("fail");
    expect(result.message).toContain("over the 3072 KiB limit");
  });

  it("fails when the figure is missing", () => {
    const result = evaluate("✘ [ERROR] Build failed with 1 error");
    expect(result).toMatchObject({ level: "fail", gzipKiB: null });
    expect(result.message).toContain("Could not find");
  });

  it("honours custom thresholds", () => {
    expect(evaluate(buildLog("1500 KiB"), { limitKiB: 2000, warnKiB: 1000 }).level).toBe("warn");
    expect(evaluate(buildLog("2500 KiB"), { limitKiB: 2000, warnKiB: 1000 }).level).toBe("fail");
  });
});

describe("parseArgs", () => {
  it("uses the defaults with no arguments", () => {
    expect(parseArgs([])).toEqual({ limitKiB: DEFAULT_LIMIT_KIB, warnKiB: DEFAULT_WARN_KIB, file: null });
  });

  it("reads thresholds and a log file", () => {
    expect(parseArgs(["--limit", "10240", "--warn", "9000", "build.log"])).toEqual({
      limitKiB: 10240,
      warnKiB: 9000,
      file: "build.log",
    });
  });

  it.each([
    [["--limit"], /positive number/],
    [["--warn", "abc"], /positive number/],
    [["--limit", "0"], /positive number/],
    [["--limit", "100"], /must not be above --limit/],
    [["--size", "1"], /Unknown option/],
    [["a.log", "b.log"], /Unexpected argument/],
  ])("rejects %o", (argv, error) => {
    expect(() => parseArgs(argv)).toThrow(error);
  });
});

describe("main", () => {
  it("exits 0 and prints the size below the warning line", () => {
    const { code, output } = run([], buildLog("2621.12 KiB"));
    expect(code).toBe(0);
    expect(output).toBe("Worker bundle is 2621.12 KiB gzip, 85.3% of the 3072 KiB limit.");
  });

  it("exits 0 with a warning annotation above the warning line", () => {
    const { code, output } = run([], buildLog("2950 KiB"));
    expect(code).toBe(0);
    expect(output).toMatch(/^::warning::/);
  });

  it("exits 1 with an error annotation above the limit", () => {
    const { code, output } = run([], buildLog("3100 KiB"));
    expect(code).toBe(1);
    expect(output).toMatch(/^::error::Worker bundle is 3100\.00 KiB gzip/);
  });

  it("exits 1 when the figure is missing", () => {
    const { code, output } = run([], "");
    expect(code).toBe(1);
    expect(output).toMatch(/^::error::Could not find/);
  });

  it("exits 2 on bad arguments without reading input", () => {
    const lines: string[] = [];
    const code = main(["--limit", "x"], {
      readInput: () => {
        throw new Error("should not read");
      },
      log: (line) => lines.push(line),
    });
    expect(code).toBe(2);
    expect(lines[0]).toMatch(/^::error::worker-size-gate: --limit needs a positive number/);
  });
});
