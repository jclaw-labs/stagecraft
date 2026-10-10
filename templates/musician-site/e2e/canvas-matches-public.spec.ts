import { expect, test, type Page } from "@playwright/test";

import { seedDemoContent } from "./setup/seed";

/**
 * The Puck editor canvas lays blocks out the way the published page does
 * (#395).
 *
 * The canvas renders the same blocks as the public page, but inside
 * Puck's iframe rather than the public layout. Any theme token or page
 * rule the public page gets and the canvas doesn't (the content measure,
 * radii, density spacing, the body margin) makes the editor show a
 * different layout from the one that ships. So this opens the demo home
 * page in both places at the same viewport and compares the body and
 * each top-level Section's box.
 */

const VIEWPORT = { width: 1280, height: 900 };

type Layout = {
  /** Width the document lays out at, after any scrollbar. */
  layoutWidth: number;
  body: { margin: string; background: string };
  /** Every top-level page Section, in document order. */
  sections: {
    left: number;
    width: number;
    paddingTop: string;
    paddingLeft: string;
    borderRadius: string;
  }[];
};

/**
 * Runs in the page (or the canvas iframe): measures the document `root`
 * belongs to. Self-contained, since Playwright serialises it.
 */
function measureLayout(root: Element): Layout {
  const doc = root.ownerDocument;
  const body = getComputedStyle(doc.body);
  // A Section block renders a <section>; the blocks inside it don't, and
  // the public header and footer aren't part of the page's content.
  const sections = Array.from(root.querySelectorAll("section"))
    .filter((el) => !el.parentElement?.closest("section"))
    .filter((el) => !el.closest("header, footer"))
    .map((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        paddingTop: style.paddingTop,
        paddingLeft: style.paddingLeft,
        borderRadius: style.borderRadius,
      };
    });
  return {
    layoutWidth: doc.documentElement.clientWidth,
    body: { margin: body.margin, background: body.backgroundColor },
    sections,
  };
}

async function publicLayout(page: Page): Promise<Layout> {
  await page.goto("/");
  return page.locator(".stagecraft-site").evaluate(measureLayout);
}

async function canvasLayout(page: Page): Promise<Layout> {
  await page.goto("/admin/pages/home");
  // A frame locator re-resolves the iframe, which Puck can remount while
  // the editor hydrates.
  const frame = page.frameLocator("#preview-frame");
  await frame.locator("#frame-root section").first().waitFor();
  return frame.locator("#frame-root").evaluate(measureLayout);
}

test.describe("the editor canvas matches the published page", () => {
  test.beforeEach(async () => {
    await seedDemoContent();
  });

  test("the body and sections have the same box at 1280px", async ({ page }) => {
    // First hits compile both the public route and the editor.
    test.setTimeout(120_000);
    await page.setViewportSize(VIEWPORT);

    const published = await publicLayout(page);
    const canvas = await canvasLayout(page);

    // The demo home page has `md` and `lg` Sections, and a card variant.
    expect(published.sections.length).toBeGreaterThan(1);
    // Puck sizes the iframe to its viewport setting and scales it to fit
    // the canvas, so this also checks the iframe lays out at the public
    // page's width; otherwise the section widths couldn't be compared.
    expect(canvas).toEqual(published);
  });
});
