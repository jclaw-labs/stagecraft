/**
 * Screenshot capture for the platform dashboard (apps/web).
 *
 * Not a test in the assertion sense — each "test" navigates to an
 * authenticated platform surface and writes a screenshot to
 * `.pr-screenshots/` at the repo root, the directory the PR-screenshots
 * relay workflow consumes. Run via `npm run capture:screenshots` (see
 * playwright.capture.config.ts).
 *
 * The capture config's global setup seeds a session + a populated site
 * and stashes the auth cookie, so the surfaces below render
 * authenticated, with content.
 *
 * File names are prefixed `platform-` so a single `.pr-screenshots/`
 * dir can hold captures from multiple apps without collisions (the
 * artist-site capture uses `artist-*`).
 */

import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { CAPTURE_SITE_ID } from "../playwright.capture.config";

const OUTPUT_DIR =
  process.env.PR_SCREENSHOTS_DIR ?? path.resolve(process.cwd(), "../../.pr-screenshots");

type Capture = {
  /** Output basename (no extension); becomes `<name>.png`. */
  name: string;
  path: string;
  /** Heading text that must be visible before capturing — the real
   *  correctness gate. A page that redirected to /login (session not
   *  accepted) or errored won't show it, so the capture fails loudly
   *  instead of shipping a screenshot of the wrong page. */
  waitForHeading: string;
  /** Extra settle for client-rendered surfaces. */
  settleMs?: number;
};

const CAPTURES: Capture[] = [
  { name: "platform-dashboard", path: "/dashboard", waitForHeading: "Dashboard" },
  { name: "platform-settings", path: "/settings", waitForHeading: "Settings" },
  // The site-detail page is client-rendered: it fetches /api/sites/[id]
  // then renders. Wait for the site-name heading + give it a beat to
  // settle the status banner.
  {
    name: "platform-site-detail",
    path: `/sites/${CAPTURE_SITE_ID}`,
    waitForHeading: "Sarah Chen",
    settleMs: 1500,
  },
];

test.beforeAll(() => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
});

for (const capture of CAPTURES) {
  test(`capture ${capture.name}`, async ({ page }) => {
    const response = await page.goto(capture.path, { waitUntil: "domcontentloaded" });
    // A 5xx means the server failed to render — fail loudly rather than
    // ship a screenshot of an error page. (Auth redirects resolve to a
    // 200 login page, so the heading check below is what catches them.)
    expect(
      response && response.status() < 500,
      `${capture.path} returned HTTP ${response?.status()}`,
    ).toBeTruthy();
    await expect(
      page.getByRole("heading", { name: capture.waitForHeading }),
    ).toBeVisible({ timeout: 15_000 });
    if (capture.settleMs) await page.waitForTimeout(capture.settleMs);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, `${capture.name}.png`),
      type: "png",
      fullPage: true,
    });
  });
}
