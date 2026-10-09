import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guards for wrangler.jsonc. `wrangler deploy` uploads `vars` in plain text
 * and replaces them on every deploy, so a secret pasted there would leak into
 * the repo and the dashboard. A `routes` entry or custom domain would also
 * take traffic off Netlify before the cutover (#312).
 */

interface WranglerConfig {
  name?: string;
  workers_dev?: boolean;
  routes?: unknown;
  route?: unknown;
  vars?: Record<string, string>;
  env?: Record<string, unknown>;
}

function readWranglerConfig(): WranglerConfig {
  const file = path.resolve(import.meta.dirname, "../wrangler.jsonc");
  // TypeScript's tsconfig reader parses JSON with comments.
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, "utf8"));
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  return config as WranglerConfig;
}

describe("wrangler.jsonc", () => {
  const config = readWranglerConfig();

  it("deploys the stagecraft Worker to workers.dev only", () => {
    expect(config.name).toBe("stagecraft");
    expect(config.workers_dev).toBe(true);
    expect(config.routes).toBeUndefined();
    expect(config.route).toBeUndefined();
  });

  it("has no per-environment overrides that could add routes or vars", () => {
    expect(config.env).toBeUndefined();
  });

  // An exact match, so adding any var fails here first. Only non-secret,
  // Worker-wide settings belong in vars; secrets are listed in
  // docs/runbook.md ("Cloudflare Worker").
  it("sets only the in-process poller switch and the Neon driver as vars", () => {
    expect(config.vars).toEqual({
      STAGECRAFT_INPROCESS_WORKER: "false",
      DATABASE_DRIVER: "neon",
    });
  });
});
