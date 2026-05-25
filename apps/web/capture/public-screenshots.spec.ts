/**
 * Screenshot capture for the PUBLIC marketing pages (apps/web).
 *
 * Each "test" navigates to a public route and writes a screenshot to
 * `.pr-screenshots/` at the repo root — the directory the PR-screenshots
 * relay workflow consumes. No auth, no database: these routes are static
 * and public. See playwright.public-capture.config.ts. Run via
 * `npm run capture:screenshots:public`.
 *
 * File names are prefixed `site-` (public pages) per the create-pr skill's
 * naming convention.
 */
import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const OUTPUT_DIR =
  process.env.PR_SCREENSHOTS_DIR ??
  path.resolve(process.cwd(), "../../.pr-screenshots");

type Capture = {
  /** Output basename (no extension); becomes `<name>.jpg`. */
  name: string;
  path: string;
  /** Heading pattern that must be visible before capturing — the real
   *  correctness gate. A page that errored or 404'd won't show it, so the
   *  capture fails loudly instead of shipping a screenshot of the wrong page. */
  waitForHeading: RegExp;
};

const CAPTURES: Capture[] = [
  { name: "site-home", path: "/", waitForHeading: /Own your website/i },
  {
    name: "site-examples",
    path: "/examples",
    waitForHeading: /Templates for every kind of act/i,
  },
  { name: "site-migrate", path: "/migrate", waitForHeading: /Bring your site over/i },
  { name: "site-privacy", path: "/privacy", waitForHeading: /Privacy Policy/i },
  { name: "site-terms", path: "/terms", waitForHeading: /Terms of Service/i },
];

test.beforeAll(() => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
});

for (const capture of CAPTURES) {
  test(`capture ${capture.name}`, async ({ page }) => {
    const response = await page.goto(capture.path, { waitUntil: "domcontentloaded" });
    expect(
      response && response.status() < 500,
      `${capture.path} returned HTTP ${response?.status()}`,
    ).toBeTruthy();
    await expect(
      page.getByRole("heading", { name: capture.waitForHeading }).first(),
    ).toBeVisible({ timeout: 15_000 });
    // Strip the Next.js dev-mode indicator so it doesn't leak into the shot
    // (it only exists under `next dev`, never in production).
    await page.evaluate(() => {
      for (const sel of ["nextjs-portal", "#__next-build-watcher"]) {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      }
    });
    // Let webfonts + layout settle so the shot isn't captured mid-reflow.
    await page.waitForTimeout(600);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, `${capture.name}.jpg`),
      type: "jpeg",
      quality: 80,
      fullPage: true,
    });
  });
}
