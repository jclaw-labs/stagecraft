/**
 * The `stagecraft-site` CLI (ADR-016 §1). It runs under plain Node from
 * the published package, which resolves no `@/` alias and no
 * extensionless specifier, so this module's import graph stays on
 * `node:` builtins: no CSS, no `next/*`, no `#lib/…`.
 *
 * `migrate-content` (#423) and `regenerate-images` land as later
 * commands.
 */

import fs from "node:fs";

/** Where the CLI writes. */
export type CliIo = { out: (text: string) => void; err: (text: string) => void };

/** The package's own version, from the package.json beside `dist/` and `src/`. */
export function packageVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

export const USAGE = `Usage: stagecraft-site <command> [options]

Maintenance commands for a Stagecraft musician site, run from the site's
root directory.

Options:
  -h, --help     Show this help
  -v, --version  Show the package version
`;

/** Run the CLI on `argv` (without the node and script paths). Returns the exit code. */
export function run(argv: readonly string[], io: CliIo): number {
  const [command] = argv;
  if (command === undefined || command === "-h" || command === "--help" || command === "help") {
    io.out(USAGE);
    return 0;
  }
  if (command === "-v" || command === "--version") {
    io.out(`${packageVersion()}\n`);
    return 0;
  }
  io.err(`stagecraft-site: unknown command "${command}"\n\n${USAGE}`);
  return 1;
}
