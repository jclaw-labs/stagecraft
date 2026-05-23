import { defineConfig } from "@playwright/test";
import path from "node:path";

import { captureLaunchOptions } from "./capture/chromium";

/**
 * Playwright config for SCREENSHOT CAPTURE of the platform dashboard
 * (apps/web) — not assertions.
 *
 * A Claude cloud session (or anyone) runs `npm run capture:screenshots`
 * to produce a standard set of authenticated platform screenshots,
 * written to `.pr-screenshots/` at the repo root. The PR-screenshots CI
 * workflow (.github/workflows/pr-screenshots.yml) then relays them to a
 * public gist and rewrites the PR body.
 *
 * Auth without OAuth. Unlike the artist-site capture (which POSTs to a
 * dev-login route), the platform has no such escape hatch — sign-in is
 * GitHub OAuth only. Instead, the global setup seeds a NextAuth session
 * directly in Postgres and hands Playwright the matching cookie. This
 * works because the platform uses Auth.js v5's *database* session
 * strategy (PrismaAdapter, no `session.strategy` override in
 * src/lib/auth.ts): the `authjs.session-token` cookie value IS the raw
 * `Session.sessionToken`, looked up verbatim by the adapter's
 * `getSessionAndUser` — no JWT, no signing. So a known token written to
 * both the Session row and the cookie authenticates every request.
 *
 * Prerequisites (the capture talks to a real database + dev server):
 *   1. Postgres up + migrated:  `docker compose up -d`  then
 *      `npm run db:migrate`  (from the repo root).
 *   2. Chromium for Playwright: `npx playwright install chromium` — only
 *      on machines without one. Cloud sessions auto-detect a pre-installed
 *      browser instead (see capture/chromium.ts).
 *
 * The dev server is booted here with a minimal env (real DATABASE_URL +
 * dummy auth secrets), bypassing the `npm run dev` script that sources
 * 1Password-backed secrets — the capture never performs live OAuth.
 */

const PORT = 3041;
const BASE_URL = `http://localhost:${PORT}`;

const DEFAULT_DATABASE_URL =
  "postgresql://stagecraft:stagecraft@localhost:5432/stagecraft?schema=public";

// Fixed identifiers shared by the global setup (which seeds them) and
// the capture spec (which navigates to the seeded site). The session
// token is written verbatim into both the Session row and the auth
// cookie — see the header note on the database session strategy.
export const CAPTURE_USER_EMAIL = "capture@stagecraft.test";
export const CAPTURE_SESSION_TOKEN =
  "stagecraft-capture-session-token-not-for-production";
export const CAPTURE_SITE_ID = "capturedemositeid0000000000";
export const CAPTURE_DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

export const CAPTURE_STORAGE_STATE = path.join(
  process.cwd(),
  "capture",
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
    // Falls back to a pre-installed Chromium in cloud sessions where
    // Playwright can't download its own; a no-op elsewhere. See ./capture/chromium.
    launchOptions: captureLaunchOptions(),
  },
  globalSetup: "./capture/setup.ts",
  webServer: {
    command: `next dev --port ${PORT}`,
    // `/login` renders a static sign-in form without calling `auth()`
    // (src/app/login/page.tsx), so it returns 200 regardless of session
    // or seeded rows — a stable readiness signal. (`/` and `/dashboard`
    // redirect based on session, which Playwright would chase.)
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Real database — the dev server reads sessions + sites from it.
      // Defaults to the docker-compose Postgres; override via the shell
      // for a different instance.
      DATABASE_URL: CAPTURE_DATABASE_URL,
      // Auth.js needs a secret present to boot; its value is irrelevant
      // for database-session *reads* (the cookie is a raw token, not a
      // signed JWT) and the capture never performs OAuth.
      AUTH_SECRET:
        process.env.AUTH_SECRET ?? "capture-only-auth-secret-not-for-production",
      AUTH_URL: BASE_URL,
      // Provider config must be present for NextAuth to initialise; the
      // capture never reaches GitHub, so dummies are fine.
      AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID ?? "capture-dummy-client-id",
      AUTH_GITHUB_SECRET:
        process.env.AUTH_GITHUB_SECRET ?? "capture-dummy-client-secret",
    },
  },
});
