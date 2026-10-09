/**
 * The global 404 must keep the artist's theme: unknown URLs no longer
 * reach the public catch-all (it's prerendered with
 * `dynamicParams = false`), so this page is what visitors see.
 *
 * It must also stay the only public-themed 404 at the app root. Next
 * puts a root `app/not-found.tsx` into the RSC payload of every route,
 * so one wrapped in the public layout makes each admin response read
 * the site config and ship the theme (#390). The e2e spec
 * `e2e/not-found.spec.ts` checks the payloads themselves.
 *
 * Uses an isolated tmpdir content dir, matching layout.test.tsx.
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import GlobalNotFound, { generateMetadata } from "./global-not-found";
import config from "../../next.config";
import { SITE_FIELD_IDS } from "@/lib/collections/seeds";
import { __resetBootstrapCacheForTests } from "@/lib/content";

let TMP_CONTENT_DIR: string;
let SITE_ITEM_PATH: string;

beforeAll(async () => {
  TMP_CONTENT_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-global-not-found-"));
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

type WithChildren = ReactElement<{ children: ReactNode }>;

/**
 * Render the async public layout inside `<html><body>` to HTML.
 * `renderToStaticMarkup` can't await a server component, so resolve the
 * layout first and render what it returns.
 */
async function renderGlobalNotFound(): Promise<{ tree: WithChildren; html: string }> {
  const tree = GlobalNotFound();
  if (!isValidElement(tree)) throw new Error("GlobalNotFound did not return an element");
  const body = (tree as WithChildren).props.children as WithChildren;
  const layout = body.props.children as WithChildren;
  const render = layout.type as (props: { children: ReactNode }) => Promise<ReactElement>;
  return { tree: tree as WithChildren, html: renderToStaticMarkup(await render(layout.props)) };
}

describe("global not-found", () => {
  it("brings its own html and body, since it bypasses the root layout", async () => {
    const { tree } = await renderGlobalNotFound();
    expect(tree.type).toBe("html");
    expect((tree.props.children as WithChildren).type).toBe("body");
  });

  it("renders the 404 message inside the public layout's theme", async () => {
    const { html } = await renderGlobalNotFound();
    expect(html).toContain('class="stagecraft-site"');
    // Appearance tokens are injected, so the 404 picks up the theme.
    expect(html).toContain("--color-background:");
    expect(html).toContain("This page could not be found.");
  });

  it("uses the site title and description for the tab", async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe("Test Artist — Official");
    expect(meta.description).toBe("Songs and shows");
  });
});

describe("root 404 wiring", () => {
  it("is enabled in next.config", () => {
    expect(config.experimental?.globalNotFound).toBe(true);
  });

  it("has no root not-found.tsx, which would ride along in every admin payload", () => {
    for (const ext of ["tsx", "ts", "jsx", "js"]) {
      expect(existsSync(path.join(import.meta.dirname, `not-found.${ext}`))).toBe(false);
    }
  });
});
