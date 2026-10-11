#!/usr/bin/env node
/** Entry point for the `stagecraft-site` bin. The logic lives in `run.ts`. */

import { run } from "./run.js";

process.exitCode = run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
