/**
 * Playwright global setup — runs once before the test suite.
 *
 * Two jobs:
 *   1. Make sure the e2e content dir exists (the `webServer` env
 *      pins `STAGECRAFT_CONTENT_DIR` to it, but Next.js doesn't
 *      auto-create the directory).
 *   2. Sign in via `/api/auth/dev-login` and save the resulting
 *      session cookie as a `storageState.json`. Each spec then
 *      arrives already authenticated via Playwright's
 *      `use.storageState` config.
 *
 * `/api/auth/dev-login` is dev-only — it 404s when NODE_ENV is
 * "production". The webServer config in `playwright.config.ts`
 * forces NODE_ENV=development so the route is reachable.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { chromium, type FullConfig } from "@playwright/test";

import { captureLaunchOptions } from "../../capture/chromium";
import { E2E_CONTENT_DIR } from "../../playwright.config";

const STORAGE_STATE_PATH = path.join(
  process.cwd(),
  "e2e",
  ".auth",
  "storage-state.json",
);

export default async function globalSetup(config: FullConfig): Promise<void> {
  // Ensure the content dir exists. Specs wipe sub-items between
  // runs but expect the root to be present.
  await fs.mkdir(E2E_CONTENT_DIR, { recursive: true });
  await fs.mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) {
    throw new Error(
      "playwright globalSetup: baseURL missing from project config",
    );
  }

  const browser = await chromium.launch(captureLaunchOptions());
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();

    // Submit the dev-login form. The endpoint accepts a form POST
    // (the actual /admin/login surface submits one), responds 303 to
    // /admin with a session cookie set. Playwright's request API
    // follows the redirect; we stash the resulting cookie state.
    const res = await page.request.post("/api/auth/dev-login", {
      form: { email: "e2e@example.com" },
      maxRedirects: 0,
    });
    if (res.status() !== 303) {
      throw new Error(
        `dev-login expected 303, got ${res.status()} — is NODE_ENV=development on the dev server?`,
      );
    }
    await context.storageState({ path: STORAGE_STATE_PATH });
  } finally {
    await browser.close();
  }
}
