/**
 * Renders every *.html comp in this directory to a same-named PNG.
 *
 *   node render.mjs            # render all
 *   node render.mjs pulse oak  # render a subset
 *
 * Requires `playwright` (the template's devDependency is fine). Point at a
 * specific Chromium with CHROMIUM_PATH=… if the bundled one isn't installed.
 * PNGs are git-ignored (regenerable); the HTML is the source of truth.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const themes = (only.length
  ? only
  : fs.readdirSync(dir).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""))
).sort();

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
for (const t of themes) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true, // sandbox proxy MITMs the Google Fonts TLS cert
  });
  const page = await ctx.newPage();
  await page.goto(`file://${path.join(dir, `${t}.html`)}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(dir, `${t}.png`), fullPage: true });
  await ctx.close();
  console.log("rendered", t);
}
await browser.close();
console.log("done");
