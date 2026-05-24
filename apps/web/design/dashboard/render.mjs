/**
 * Renders every *.html comp in this directory to PNGs at two viewports
 * (desktop + mobile), so the redesign can be reviewed responsively.
 *
 *   node render.mjs                  # render all
 *   node render.mjs dashboard        # render a subset
 *
 * Output:  <name>.desktop.png  +  <name>.mobile.png
 *
 * Requires `playwright`. Point at a specific Chromium with
 * CHROMIUM_PATH=… if the bundled one isn't installed (cloud sessions):
 *   CHROMIUM_PATH=/path/to/chrome node render.mjs
 *
 * PNGs are git-ignored (regenerable); the HTML is the source of truth —
 * same convention as templates/musician-site/design/theme-comps.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const screens = (
  only.length
    ? only
    : fs.readdirSync(dir).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""))
).sort();

const viewports = [
  { name: "desktop", width: 1440, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const screen of screens) {
  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      ignoreHTTPSErrors: true, // sandbox proxy MITMs the Google Fonts TLS cert
    });
    const page = await ctx.newPage();
    await page.goto(`file://${path.join(dir, `${screen}.html`)}`, {
      waitUntil: "networkidle",
      timeout: 45000,
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(dir, `${screen}.${vp.name}.png`),
      fullPage: true,
    });
    await ctx.close();
    console.log("rendered", screen, vp.name);
  }
}

await browser.close();
console.log("done");
