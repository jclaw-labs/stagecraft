import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

import { captureLaunchOptions } from "./capture/chromium";

/**
 * Playwright config for the musician-site admin e2e suite.
 *
 * The e2e tests drive the welcome wizard + reset flow end-to-end —
 * stuff unit tests can't cover because it spans client UI ↔ Next
 * route handler ↔ on-disk content store ↔ redirect.
 *
 * Content isolation: the dev server runs against a fresh tmpdir per
 * test run (via `STAGECRAFT_CONTENT_DIR`). Specs reset the relevant
 * files in their own `beforeEach` so they don't bleed state into
 * each other. Workers is pinned to 1 — multi-worker would race on
 * the single content dir.
 *
 * Auth: a global setup signs in once via `/api/auth/dev-login` (the
 * existing dev-only escape hatch from the magic-link flow) and
 * stashes the session cookie at `e2e/.auth/storage-state.json`.
 * Tests reuse it through the `storageState` config below — no
 * per-test sign-in.
 */

const PORT = 3030;
const BASE_URL = `http://localhost:${PORT}`;

// One e2e content dir per test run. CI gets a fresh runner each time,
// so the tmpdir name only needs to be stable WITHIN one run.
export const E2E_CONTENT_DIR = path.join(os.tmpdir(), "stagecraft-e2e-content");

export default defineConfig({
  testDir: "./e2e",
  // Single worker — the dev server runs against one content dir on
  // disk, and concurrent specs would race on the seed/reset between
  // tests. The wizard suite is small (~2 specs) so serial is fine.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    // Reuse the storageState saved by the global setup so each test
    // arrives already signed in.
    storageState: "e2e/.auth/storage-state.json",
    trace: process.env.CI ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
    // Uses the pre-installed Chromium in cloud sessions where Playwright
    // can't download its own; a no-op in CI and local dev.
    launchOptions: captureLaunchOptions(),
  },
  globalSetup: "./e2e/setup/global-setup.ts",
  webServer: {
    command: `next dev --port ${PORT}`,
    // Probe `/admin/login` for readiness, not the catch-all root. The
    // public catch-all returns 404 against an empty content dir —
    // which is precisely the state e2e specs start from — and
    // Playwright's webServer treats 404 as "not ready" and waits
    // forever. `/admin/login` is a static server-rendered route that
    // returns 200 regardless of content, so it's a stable readiness
    // signal.
    url: `${BASE_URL}/admin/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // STAGECRAFT_CONTENT_DIR isolates the dev server's filesystem
      // reads/writes — anything the wizard or reset writes lands in
      // this tmpdir instead of the checked-in src/content/. Wiping
      // between tests is therefore safe. `next dev` already pins
      // NODE_ENV=development so /api/auth/dev-login is reachable.
      STAGECRAFT_CONTENT_DIR: E2E_CONTENT_DIR,
    },
  },
});
