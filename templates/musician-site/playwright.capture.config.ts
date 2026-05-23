import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

/**
 * Playwright config for SCREENSHOT CAPTURE (not assertions).
 *
 * A Claude cloud session (or anyone) runs `npm run capture:screenshots`
 * to produce a standard set of authenticated admin + public screenshots
 * of a generated artist site, written to `.pr-screenshots/` at the repo
 * root. The PR-screenshots CI workflow (.github/workflows/pr-screenshots.yml)
 * then relays them to a public gist and rewrites the PR body.
 *
 * Why a separate config from the e2e one:
 *   - It boots its own dev server on a distinct port + content dir, so
 *     it doesn't collide with `npm run test:e2e`.
 *   - Its global setup seeds a *completed* site (past the welcome
 *     wizard) so the admin surfaces render with content, then signs in
 *     via `/api/auth/dev-login` and stashes the session — the same
 *     dev-only escape hatch the e2e suite uses.
 *   - `next dev` forces NODE_ENV=development, so dev-login is reachable.
 */

const PORT = 3031;
const BASE_URL = `http://localhost:${PORT}`;

// Distinct from the e2e content dir so a capture run never disturbs an
// e2e run (and vice versa). Stable within one run; the global setup
// re-seeds it from scratch.
export const CAPTURE_CONTENT_DIR = path.join(
  os.tmpdir(),
  "stagecraft-capture-content",
);

export const CAPTURE_STORAGE_STATE = path.join(
  process.cwd(),
  "e2e",
  ".auth",
  "capture-storage-state.json",
);

export default defineConfig({
  testDir: "./capture",
  workers: 1,
  fullyParallel: false,
  // Capture is artifact-generation, not a gate — never retry (a retry
  // would just re-screenshot) and fail loudly so a broken page surfaces.
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    storageState: CAPTURE_STORAGE_STATE,
    viewport: { width: 1440, height: 900 },
  },
  globalSetup: "./capture/setup.ts",
  webServer: {
    command: `next dev --port ${PORT}`,
    // `/admin/login` is a static 200 regardless of content state — a
    // stable readiness signal (the public catch-all 404s on an empty
    // content dir, which Playwright would treat as "not ready").
    url: `${BASE_URL}/admin/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      STAGECRAFT_CONTENT_DIR: CAPTURE_CONTENT_DIR,
    },
  },
});
