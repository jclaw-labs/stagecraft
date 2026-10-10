/**
 * Render parity for page JSON (#349).
 *
 * Renders every committed page and every first-run seed page through the
 * public page pipeline (walker + render config, as the `[[...slug]]`
 * catch-all does) and compares the HTML with snapshots recorded before the
 * page and template block libraries were merged. The block library, the
 * config factory and the content migration may change; the HTML a visitor
 * gets for existing pages may not.
 *
 * The clock is pinned because tour-date blocks filter on "today".
 */
import { readdirSync } from "node:fs";
import path from "node:path";

import type { Data } from "@measured/puck";
import { Render } from "@measured/puck";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getFsReadStore, listCollectionSlugs } from "@/lib/collections";
import { pageDataToItem } from "@/lib/collections/migrate-from-legacy";
import { pagesCollectionDef } from "@/lib/collections/seeds";
import { buildCollectionBlockRegistry } from "@/lib/collections/template/collection-block";
import { loadCollectionsForTemplate } from "@/lib/collections/template/load-collections";
import { resolveTemplate } from "@/lib/collections/template/renderer";
import type { Template } from "@/lib/collections/template/types";
import { readPageOrNull } from "@/lib/content";
import { buildFirstRunSeed } from "@/lib/first-run-seeds";

import { buildUnifiedPublicConfig } from "./unified-config";

const PINNED_NOW = new Date("2026-06-01T12:00:00Z");
const PAGES_DIR = path.join(process.cwd(), "src/content/collections/pages/items");
const SNAPSHOT_DIR = path.join(import.meta.dirname, "__snapshots__", "render-parity");

async function renderPageBody(slug: string, data: Template): Promise<string> {
  const slugs = await listCollectionSlugs();
  const pageItem = pageDataToItem(slug, data, {
    id: `page_${slug}`,
    createdAt: PINNED_NOW.toISOString(),
    updatedAt: PINNED_NOW.toISOString(),
  });
  const resolved = resolveTemplate(data, pageItem, {
    registry: buildCollectionBlockRegistry(slugs),
    currentItem: pageItem,
    itemDef: pagesCollectionDef,
    loadedCollections: await loadCollectionsForTemplate(data),
  });
  return renderToStaticMarkup(
    <Render config={buildUnifiedPublicConfig(slugs)} data={resolved as Data} />,
  );
}

const committedSlugs = readdirSync(PAGES_DIR)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const seed = buildFirstRunSeed("Ada Lovelace", "Home", PINNED_NOW);
const seedPages = [seed.homePage, ...seed.starterPages];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PINNED_NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

describe("committed page JSON renders unchanged", () => {
  it.each(committedSlugs)("%s", async (slug) => {
    const data = await readPageOrNull(slug, getFsReadStore());
    expect(data).not.toBeNull();
    const html = await renderPageBody(slug, data as Template);
    await expect(html).toMatchFileSnapshot(path.join(SNAPSHOT_DIR, `page-${slug}.html`));
  });
});

describe("first-run seed pages render unchanged", () => {
  it.each(seedPages.map((p) => [p.slug, p] as const))("%s", async (slug, page) => {
    const html = await renderPageBody(slug, page.data as Template);
    await expect(html).toMatchFileSnapshot(path.join(SNAPSHOT_DIR, `seed-${slug}.html`));
  });
});
