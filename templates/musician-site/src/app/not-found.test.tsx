/**
 * The root 404 must keep the artist's theme: unknown URLs no longer
 * reach the public catch-all (it's prerendered with
 * `dynamicParams = false`), so this page is what visitors see.
 *
 * Uses an isolated tmpdir content dir, matching layout.test.tsx.
 */

import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import NotFound, { generateMetadata } from "./not-found";
import { SITE_FIELD_IDS } from "@/lib/collections/seeds";
import { __resetBootstrapCacheForTests } from "@/lib/content";

let TMP_CONTENT_DIR: string;
let SITE_ITEM_PATH: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-not-found-"));
  SITE_ITEM_PATH = path.join(TMP_CONTENT_DIR, "collections/site/items/_singleton.json");
});

afterAll(async () => {
  await fs.rm(TMP_CONTENT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  process.env.STAGECRAFT_CONTENT_DIR = TMP_CONTENT_DIR;
  __resetBootstrapCacheForTests();
  await fs.rm(path.join(TMP_CONTENT_DIR, "collections"), { recursive: true, force: true });
  await fs.mkdir(path.dirname(SITE_ITEM_PATH), { recursive: true });
  await fs.writeFile(
    SITE_ITEM_PATH,
    JSON.stringify({
      id: "item_site",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      values: {
        [SITE_FIELD_IDS.artistName]: { type: "text", value: "Test Artist" },
        [SITE_FIELD_IDS.siteTitle]: { type: "text", value: "Test Artist — Official" },
        [SITE_FIELD_IDS.siteDescription]: { type: "longText", value: "Songs and shows" },
        [SITE_FIELD_IDS.contactEmail]: { type: "email", value: "a@e.com" },
      },
    }),
    "utf-8",
  );
});

/** Resolve the async public layout the 404 wraps, then render to HTML. */
async function renderNotFound(): Promise<string> {
  const tree = NotFound();
  if (!isValidElement(tree)) throw new Error("NotFound did not return an element");
  const layout = tree as ReactElement<{ children: ReactNode }>;
  const render = layout.type as (props: { children: ReactNode }) => Promise<ReactElement>;
  return renderToStaticMarkup(await render(layout.props));
}

describe("root not-found", () => {
  it("renders the 404 message inside the public layout's theme", async () => {
    const html = await renderNotFound();
    expect(html).toContain('class="stagecraft-site"');
    // Appearance tokens are injected, so the 404 picks up the theme.
    expect(html).toContain("--color-background:");
    expect(html).toContain("<h1");
    expect(html).toContain("404");
    expect(html).toContain("This page could not be found.");
    expect(html).toContain('href="/"');
  });

  it("renders its own body, not Next's internal 404 UI", () => {
    const source = readFileSync(path.join(import.meta.dirname, "not-found.tsx"), "utf-8");
    expect(source).not.toMatch(/from\s+["']next\/dist\//);
  });

  it("styles the body with tokens only, no raw colours or sizes", async () => {
    const html = await renderNotFound();
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(main).not.toMatch(/\d(px|rem|em)\b/);
  });

  it("uses the site title and description for the tab", async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe("Test Artist — Official");
    expect(meta.description).toBe("Songs and shows");
  });
});
