import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { E2E_CONTENT_DIR } from "../playwright.config";
import type { TemplateKind } from "../src/app/admin/collections/[slug]/template/TemplateEditorClient";
import { POSTS_FIELD_IDS } from "../src/lib/collections/field-ids";
import { BLOCK_DESCRIPTIONS } from "../src/puck/config";
import { seedDemoContent } from "./setup/seed";

/**
 * Smoke test for the Puck editors (#350, #432).
 *
 * Unit tests mock Puck, so a Puck upgrade that breaks drag-and-drop,
 * field editing or `onPublish` in the real editor would still pass them.
 * This drives every `<Puck>` mount end to end — the page editor, the item
 * and detail template editors and the item body editor: load, drag a
 * block from the drawer onto the canvas, edit it in the fields panel,
 * save, and check the saved JSON on disk — with no console errors or
 * unexpected warnings along the way.
 */

/**
 * Third-party font hosts the editors load from: the theme's Google Fonts
 * <link>, and the Inter stylesheet Puck's own editor CSS `@import`s from
 * rsms.me. The sandboxed runners these specs sometimes run in can't reach
 * them, and a failed `@import` also makes Puck's canvas iframe warn that
 * it couldn't copy the editor stylesheet. So every run answers these
 * hosts with an empty stylesheet: the result doesn't depend on the
 * network, and any failed load that's left is the app's own.
 */
const THIRD_PARTY_FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "rsms.me"];

/**
 * Console warnings the editors are allowed to log, each with the reason
 * it's expected. Puck reports deprecated APIs through `console.warn`
 * (bare `usePuck()` did in 0.23), so any other warning fails the spec:
 * after an upgrade, that's how the next deprecation shows up. Add an
 * entry only for a warning that isn't ours to fix. (Puck's dev-only
 * `console.info` about skipping runtime style injection is info, not a
 * warning; see `editor-css-boundary.test.ts`.)
 */
const ALLOWED_CONSOLE_WARNINGS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [];

function isAllowedWarning(text: string): boolean {
  return ALLOWED_CONSOLE_WARNINGS.some(({ pattern }) => pattern.test(text));
}

/**
 * Stubs the font hosts, then collects console errors, uncaught page
 * errors and warnings that aren't on the allowlist.
 */
async function watchConsole(page: Page): Promise<string[]> {
  await page.route(
    (url) => THIRD_PARTY_FONT_HOSTS.includes(url.hostname),
    (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  const problems: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error") problems.push(`error: ${text}`);
    else if (message.type() === "warning" && !isAllowedWarning(text)) {
      problems.push(`warning: ${text}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
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

/**
 * Drags a Quote from the drawer onto `target` and types a unique marker
 * into its text field. Dropping selects the new block, so its fields open
 * on the right; Puck keeps other field panels mounted but hidden, hence
 * `:visible`. Returns the marker.
 */
async function dropQuote(page: Page, target: Locator): Promise<string> {
  await dragOnto(page, page.getByTestId("drawer-item:Quote"), target);
  const marker = `Smoke test quote ${Date.now()}`;
  const quoteText = page.locator('textarea[name="text"]:visible');
  await quoteText.waitFor();
  await quoteText.fill(marker);
  return marker;
}

/** A drawer category's header button; Puck drops it when the category is hidden. */
function drawerCategoryHeader(page: Page, category: string): Locator {
  return page.locator(`button[aria-controls="puck-drawer-category-${category}"]`);
}

const TEMPLATE_KINDS: readonly TemplateKind[] = ["item", "detail"];

const TEMPLATE_SLOT: Record<TemplateKind, "itemTemplate" | "detailTemplate"> = {
  item: "itemTemplate",
  detail: "detailTemplate",
};

test.describe("Puck editors", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async () => {
    await seedDemoContent();
  });

  test("page editor: drag a block in, edit it, save", async ({ page }) => {
    // First hit compiles the editor route.
    test.setTimeout(180_000);
    const problems = await watchConsole(page);
    const pageFile = path.join(E2E_CONTENT_DIR, "collections/pages/items/home.json");
    const before = blockTypes(await readJson(pageFile)).filter((t) => t === "Quote").length;

    await page.goto("/admin/pages/home");
    const frame = page.frameLocator("#preview-frame");
    await frame.locator("#frame-root section").first().waitFor();

    const marker = await dropQuote(page, frame.locator("#frame-root section").first());
    await expect(frame.getByText(marker)).toBeVisible();
    // `BlockHelp` reads `selectedItem` from Puck's store through the
    // `createUsePuck` selector: the new Quote's description shows above
    // its fields.
    await expect(
      page.getByRole("note").filter({ hasText: BLOCK_DESCRIPTIONS.Quote }),
    ).toBeVisible();

    await clickPublish(page);
    // The first save compiles the item route in the dev server.
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({
      timeout: 30_000,
    });

    const saved = await readJson(pageFile);
    expect(blockTypes(saved).filter((t) => t === "Quote").length).toBe(before + 1);
    expect(strings(saved)).toContain(marker);

    // Real keystrokes after the save: the first one marks the editor dirty
    // and re-renders it, which must not remount the inspector (the
    // `fields` override keeps its identity), so every key lands.
    const quoteText = page.locator('textarea[name="text"]:visible');
    await quoteText.pressSequentially(" XYZ");
    await expect(quoteText).toBeFocused();
    await expect(quoteText).toHaveValue(`${marker} XYZ`);

    // `DrawerCategoryVisibilitySync` dispatches `setUi` through the
    // selected `dispatch`: a filter hides the categories with no match,
    // and clearing it brings them back. Typed key by key, so a drawer
    // remount would drop focus after the first character.
    const filter = page.getByRole("searchbox", { name: "Filter blocks" });
    await expect(drawerCategoryHeader(page, "layout")).toBeVisible();
    await filter.click();
    await filter.pressSequentially("quote");
    await expect(filter).toBeFocused();
    await expect(filter).toHaveValue("quote");
    await expect(drawerCategoryHeader(page, "layout")).toHaveCount(0);
    await expect(drawerCategoryHeader(page, "content")).toBeVisible();
    await filter.fill("");
    await expect(drawerCategoryHeader(page, "layout")).toBeVisible();

    expect(problems).toEqual([]);
  });

  for (const kind of TEMPLATE_KINDS) {
    test(`${kind} template editor: drag a block in, edit it, save`, async ({ page }) => {
      test.setTimeout(180_000);
      const problems = await watchConsole(page);
      const defFile = path.join(E2E_CONTENT_DIR, "collections/tour-dates/_collection.json");

      await page.goto(`/admin/collections/tour-dates/template/${kind}`);
      const frame = page.frameLocator("#preview-frame");
      await frame.locator("#frame-root").waitFor();

      const marker = await dropQuote(page, frame.locator("#frame-root"));
      // The preview pane renders the live template against a real item.
      await expect(page.getByTestId("template-preview-render")).toContainText(marker);

      await clickPublish(page);
      await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 30_000 });

      const def = (await readJson(defFile)) as Record<string, unknown>;
      const template = def[TEMPLATE_SLOT[kind]];
      expect(blockTypes(template)).toContain("Quote");
      expect(strings(template)).toContain(marker);
      expect(problems).toEqual([]);
    });
  }

  test("item body editor: drag a block in, edit it, save", async ({ page }) => {
    test.setTimeout(180_000);
    const problems = await watchConsole(page);
    const itemSlug = "on-the-road-this-summer";
    const itemFile = path.join(E2E_CONTENT_DIR, `collections/posts/items/${itemSlug}.json`);

    await page.goto(`/admin/collections/posts/items/${itemSlug}/body/${POSTS_FIELD_IDS.body}`);
    const frame = page.frameLocator("#preview-frame");
    await frame.locator("#frame-root").waitFor();

    const marker = await dropQuote(page, frame.locator("#frame-root"));
    await expect(frame.getByText(marker)).toBeVisible();

    await clickPublish(page);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 30_000 });

    const item = (await readJson(itemFile)) as { values: Record<string, unknown> };
    const body = item.values[POSTS_FIELD_IDS.body];
    expect(blockTypes(body)).toContain("Quote");
    expect(strings(body)).toContain(marker);
    expect(problems).toEqual([]);
  });
});
