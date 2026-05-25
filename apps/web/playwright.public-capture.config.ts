import { defineConfig } from "@playwright/test";

import { captureLaunchOptions } from "./capture/chromium";

/**
 * Screenshot capture for the PUBLIC marketing pages (apps/web).
 *
 * Unlike playwright.capture.config.ts — which seeds a Postgres-backed
 * NextAuth session to reach authenticated dashboard pages — the public
 * marketing routes (`/`, `/examples`, `/migrate`, `/privacy`, `/terms`)
 * query no database and call no `auth()`. So this config needs NO
 * Postgres, NO session seeding, and NO global setup: it serves a
 * production build (`next start`, via the npm script's `next build`)
 * with dummy env and screenshots each route. Production rather than
 * `next dev` so the shots match what users see and carry no dev overlay.
 *
 * This is the path to use in a cloud session with no docker daemon — a
 * missing database is NOT a reason to skip screenshots of public UI:
 *
 *   npm run capture:screenshots:public   # writes .pr-screenshots/site-*.jpg
 *
 * The browser is the pre-installed Chromium at /opt/pw-browsers, resolved
 * by captureLaunchOptions() (see capture/chromium.ts).
 */

const PORT = 3042;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./capture",
  testMatch: "public-screenshots.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    launchOptions: captureLaunchOptions(),
  },
  webServer: {
    command: `next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Public pages query no DB and call no auth(); these dummy values
      // only let the Next server boot without 1Password-backed secrets.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://stagecraft:stagecraft@localhost:5432/stagecraft?schema=public",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "public-capture-only-secret",
      AUTH_URL: BASE_URL,
      AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID ?? "public-capture-dummy-id",
      AUTH_GITHUB_SECRET:
        process.env.AUTH_GITHUB_SECRET ?? "public-capture-dummy-secret",
    },
  },
});
