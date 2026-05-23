/**
 * Global setup for the screenshot-capture config.
 *
 * Two jobs, mirroring the e2e global setup but against the capture
 * content dir:
 *   1. Seed a *completed* artist site (past the welcome wizard) so the
 *      admin surfaces render with real content instead of bouncing to
 *      `/admin/welcome`.
 *   2. Sign in via `/api/auth/dev-login` and stash the session cookie
 *      so the capture spec arrives authenticated.
 */

import path from "node:path";

import { chromium, type FullConfig } from "@playwright/test";

import { seedCompletedSite } from "../e2e/setup/seed";
import { CAPTURE_CONTENT_DIR, CAPTURE_STORAGE_STATE } from "../playwright.capture.config";

export default async function captureSetup(config: FullConfig): Promise<void> {
  // Seed BEFORE the first request: the dev server reads the content
  // dir per-request (file-backed store), so seeding the tmp dir the
  // webServer points at is enough — no restart needed.
  await seedCompletedSite("Sarah Chen", CAPTURE_CONTENT_DIR);

  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) {
    throw new Error("capture setup: baseURL missing from project config");
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const res = await page.request.post("/api/auth/dev-login", {
      form: { email: "capture@example.com" },
      maxRedirects: 0,
    });
    if (res.status() !== 303) {
      throw new Error(
        `dev-login expected 303, got ${res.status()} — is NODE_ENV=development on the dev server?`,
      );
    }
    await context.storageState({ path: path.resolve(CAPTURE_STORAGE_STATE) });
  } finally {
    await browser.close();
  }
}
