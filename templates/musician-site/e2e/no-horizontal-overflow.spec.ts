import { expect, test, type Page } from "@playwright/test";

import { seedDemoContent } from "./setup/seed";

/**
 * Public pages must never scroll sideways (#388).
 *
 * Seeds the checked-in demo site, discovers every public page by
 * following same-origin links from `/`, then checks each one at a phone
 * and a desktop width. Discovering by crawl rather than a fixed list
 * keeps the check honest when the demo content changes.
 */

// Generous cap so a link loop can't run the crawl away.
const MAX_PAGES = 50;

async function internalLinks(page: Page): Promise<string[]> {
  return page.$$eval("a[href]", (anchors) =>
    anchors
      .map((a) => new URL((a as HTMLAnchorElement).href))
      .filter((url) => url.origin === window.location.origin)
      .map((url) => url.pathname),
  );
}

function isPublicPath(pathname: string): boolean {
  return !/^\/(admin|api|_next)(\/|$)/.test(pathname) && !/\.[a-z0-9]+$/i.test(pathname);
}

/** Returns a description of the overflow, or null when the page fits. */
async function overflowAt(page: Page, pathname: string, width: number): Promise<string | null> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  return scrollWidth > clientWidth ? `${pathname} at ${width}px: ${scrollWidth}px wide` : null;
}

test.describe("public pages have no horizontal overflow", () => {
  test.beforeAll(async () => {
    await seedDemoContent();
  });

  test("at 375px and 1440px", async ({ page }) => {
    // The dev server compiles on first hit, so the crawl needs more than
    // the default 30s.
    test.setTimeout(180_000);
    const overflowing: string[] = [];

    // Crawl at desktop width, checking each page as it's visited.
    await page.setViewportSize({ width: 1440, height: 900 });
    const seen = new Set<string>(["/"]);
    const queue = ["/"];
    const pages: string[] = [];
    while (queue.length > 0 && pages.length < MAX_PAGES) {
      const pathname = queue.shift()!;
      const res = await page.goto(pathname);
      if (!res?.ok()) continue;
      pages.push(pathname);
      const overflow = await overflowAt(page, pathname, 1440);
      if (overflow) overflowing.push(overflow);
      for (const link of await internalLinks(page)) {
        if (isPublicPath(link) && !seen.has(link)) {
          seen.add(link);
          queue.push(link);
        }
      }
    }
    // The demo site has a nav, so the crawl must find more than `/`.
    expect(pages.length).toBeGreaterThan(1);

    // Then every page found at phone width.
    await page.setViewportSize({ width: 375, height: 900 });
    for (const pathname of pages) {
      await page.goto(pathname);
      const overflow = await overflowAt(page, pathname, 375);
      if (overflow) overflowing.push(overflow);
    }

    expect(overflowing).toEqual([]);
  });

  test("the body is edge to edge and takes the theme background", async ({ page }) => {
    await page.goto("/");
    const body = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      const wrapper = document.querySelector(".stagecraft-site");
      return {
        margin: style.margin,
        background: style.backgroundColor,
        theme: wrapper ? getComputedStyle(wrapper).backgroundColor : null,
      };
    });
    expect(body.margin).toBe("0px");
    expect(body.theme).not.toBeNull();
    expect(body.background).toBe(body.theme);
  });
});
