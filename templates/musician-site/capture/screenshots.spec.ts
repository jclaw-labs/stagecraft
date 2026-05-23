/**
 * Screenshot capture for the generated artist site.
 *
 * Not a test in the assertion sense — each "test" navigates to a page
 * and writes a screenshot to `.pr-screenshots/` at the repo root, the
 * directory the PR-screenshots relay workflow consumes. Run via
 * `npm run capture:screenshots` (see playwright.capture.config.ts).
 *
 * The capture config's global setup seeds a completed site + signs in,
 * so the admin surfaces below render authenticated, with content.
 *
 * File names are prefixed by surface so a single `.pr-screenshots/`
 * dir can hold captures from multiple apps without collisions:
 *   - `artist-home`        public home page
 *   - `artist-admin-*`     authenticated admin surfaces
 */

import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

// `.pr-screenshots/` lives at the repo root; the capture process runs
// from templates/musician-site. Overridable for non-standard layouts.
const OUTPUT_DIR =
  process.env.PR_SCREENSHOTS_DIR ?? path.resolve(process.cwd(), "../../.pr-screenshots");

type Format = "jpeg" | "png";

type Capture = {
  /** Output basename (no extension); becomes `<name>.<ext>`. */
  name: string;
  path: string;
  /** JPEG for content-heavy public pages (smaller); PNG for admin
   *  surfaces where crisp form text matters. */
  format: Format;
  /** Extra settle for client-rendered surfaces (the Puck editor
   *  hydrates + lays out its drawer/canvas after load). */
  settleMs?: number;
};

const CAPTURES: Capture[] = [
  // Public site.
  { name: "artist-home", path: "/", format: "jpeg" },
  // Authenticated admin surfaces.
  { name: "artist-admin-pages", path: "/admin/pages", format: "png" },
  { name: "artist-admin-settings", path: "/admin/settings", format: "png" },
  { name: "artist-admin-navigation", path: "/admin/navigation", format: "png" },
  { name: "artist-admin-appearance", path: "/admin/appearance", format: "png" },
  { name: "artist-admin-collections", path: "/admin/collections", format: "png" },
  // The Puck editor is the richest authed surface — heavy client
  // render, so give it a longer settle.
  { name: "artist-admin-page-editor", path: "/admin/pages/home", format: "png", settleMs: 2500 },
];

test.beforeAll(() => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
});

for (const capture of CAPTURES) {
  test(`capture ${capture.name}`, async ({ page }) => {
    const response = await page.goto(capture.path, { waitUntil: "networkidle" });
    // A 4xx/5xx means the page didn't render — fail loudly rather than
    // ship a screenshot of an error page.
    expect(
      response?.ok(),
      `${capture.path} returned HTTP ${response?.status()}`,
    ).toBeTruthy();
    // Admin surfaces are gated by middleware — an unauthenticated request
    // 302s to /admin/login (itself a 200), so response.ok() alone would
    // happily screenshot the sign-in form. Guard against that if the
    // seeded session didn't apply.
    if (capture.path.startsWith("/admin")) {
      expect(
        page.url(),
        `${capture.path} landed on the login page — session not applied?`,
      ).not.toContain("/admin/login");
    }
    if (capture.settleMs) await page.waitForTimeout(capture.settleMs);

    const ext = capture.format === "jpeg" ? "jpg" : "png";
    await page.screenshot({
      path: path.join(OUTPUT_DIR, `${capture.name}.${ext}`),
      type: capture.format,
      ...(capture.format === "jpeg" ? { quality: 80 } : {}),
      fullPage: true,
    });
  });
}
