import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { E2E_CONTENT_DIR } from "../playwright.config";
import { seedDemoContent } from "./setup/seed";

/**
 * Smoke test for the Puck editors (#350).
 *
 * Unit tests mock Puck, so a Puck upgrade that breaks drag-and-drop,
 * field editing or `onPublish` in the real editor would still pass them.
 * This drives the page editor and a collection template editor end to
 * end: load, drag a block from the drawer onto the canvas, edit it in the
 * fields panel, save, and check the saved JSON on disk — with no console
 * errors along the way.
 */

/**
 * Hosts whose failed loads the editors are allowed to log. The sandboxed
 * runners these specs run in can't reach third-party font hosts: the
 * theme's Google Fonts <link>, and the Inter stylesheet Puck's own editor
 * CSS `@import`s from rsms.me. That's the environment, not the editor. A
 * failed load from the app's own origin still fails the test.
 */
const IGNORED_FAILED_LOAD_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "rsms.me"];

function isIgnoredFailedLoad(text: string, url: string): boolean {
  if (!text.startsWith("Failed to load resource: net::ERR_")) return false;
  try {
    return IGNORED_FAILED_LOAD_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isIgnoredFailedLoad(text, message.location().url)) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/**
 * Drags a drawer item onto a canvas drop target. Puck's drag-and-drop
 * listens to pointer events and only starts a drag past a small distance,
 * so this moves the mouse in steps rather than teleporting it.
 */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("dragOnto: source or target isn't visible");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, {
    steps: 5,
  });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 40), {
    steps: 20,
  });
  // Let the drop zone register the hover before releasing.
  await page.waitForTimeout(300);
  await page.mouse.up();
}

/**
 * Clicks Puck's header "Publish" action (which only saves — see
 * Editor.tsx). Puck renders it as a clickable element that isn't a
 * <button>, so it's found by its text.
 */
async function clickPublish(page: Page): Promise<void> {
  await page.getByText("Publish", { exact: true }).click();
}

/** Every `type` in a Puck tree, depth first (slots included). */
function blockTypes(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(blockTypes);
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const own = typeof record.type === "string" && "props" in record ? [record.type] : [];
  return [...own, ...Object.values(record).flatMap(blockTypes)];
}

/** Every string anywhere in a JSON tree. */
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object") return Object.values(node).flatMap(strings);
  return [];
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf-8"));
}

test.describe("Puck editors", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async () => {
    await seedDemoContent();
  });

  test("page editor: drag a block in, edit it, save", async ({ page }) => {
    // First hit compiles the editor route.
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    const pageFile = path.join(E2E_CONTENT_DIR, "collections/pages/items/home.json");
    const before = blockTypes(await readJson(pageFile)).filter((t) => t === "Quote").length;

    await page.goto("/admin/pages/home");
    const frame = page.frameLocator("#preview-frame");
    await frame.locator("#frame-root section").first().waitFor();

    await dragOnto(
      page,
      page.getByTestId("drawer-item:Quote"),
      frame.locator("#frame-root section").first(),
    );

    // Dropping selects the new block; its fields open on the right. Puck
    // keeps other field panels mounted but hidden, hence `:visible`.
    const marker = `Smoke test quote ${Date.now()}`;
    const quoteText = page.locator('textarea[name="text"]:visible');
    await quoteText.waitFor();
    await quoteText.fill(marker);
    await expect(frame.getByText(marker)).toBeVisible();

    await clickPublish(page);
    // The first save compiles the item route in the dev server.
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 30_000,
    });

    const saved = await readJson(pageFile);
    expect(blockTypes(saved).filter((t) => t === "Quote").length).toBe(before + 1);
    expect(strings(saved)).toContain(marker);
    expect(errors).toEqual([]);
  });

  test("item template editor: drag a block in, edit it, save", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectConsoleErrors(page);
    const defFile = path.join(E2E_CONTENT_DIR, "collections/tour-dates/_collection.json");

    await page.goto("/admin/collections/tour-dates/template/item");
    const frame = page.frameLocator("#preview-frame");
    await frame.locator("#frame-root").waitFor();

    await dragOnto(page, page.getByTestId("drawer-item:Quote"), frame.locator("#frame-root"));

    const marker = `Smoke test quote ${Date.now()}`;
    const quoteText = page.locator('textarea[name="text"]:visible');
    await quoteText.waitFor();
    await quoteText.fill(marker);
    // The preview pane renders the live template against a real item.
    await expect(page.getByTestId("template-preview-render")).toContainText(marker);

    await clickPublish(page);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 30_000 });

    const def = (await readJson(defFile)) as { itemTemplate?: unknown };
    expect(blockTypes(def.itemTemplate)).toContain("Quote");
    expect(strings(def.itemTemplate)).toContain(marker);
    expect(errors).toEqual([]);
  });
});
