import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Render, type Data } from "@measured/puck";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildFirstRunSeed, homePageItemValues } from "@/lib/first-run-seeds";
import { buildPuckConfig } from "@/puck/build-config";

import {
  migrateBlocks,
  migrateCollectionDef,
  migrateItemValues,
  migratePuckData,
} from "./migrate-block-library";
import type { CollectionDef, FieldValue, Item } from "./schema";
import { PREBAKED_COLLECTIONS } from "./seeds";
import { resolveTemplate } from "./template/renderer";
import type { Template } from "./template/types";

const run = promisify(execFile);
const APP_DIR = process.cwd();
const CONTENT_DIR = path.join(APP_DIR, "src/content");
const SCRIPT = path.join(APP_DIR, "scripts/migrate-block-library.mjs");

const bind = (fieldId: string) => ({ kind: "binding", fieldId });
const lit = (value: unknown) => ({ kind: "literal", value });

/** A detail template as the old template editor wrote it. */
function oldVocabTemplate(): Template {
  return {
    content: [
      {
        type: "Section",
        props: {
          id: "sec",
          width: "narrow",
          padding: "large",
          children: [
            { type: "Text", props: { id: "t", content: bind("f_title"), variant: "lead" } },
            { type: "Image", props: { id: "i", src: bind("f_cover"), altOverride: lit("") } },
            { type: "RichTextRender", props: { id: "r", field: "f_body" } },
            {
              type: "Button",
              props: { id: "b", label: lit("All releases"), href: lit("/music"), variant: "primary" },
            },
          ],
        },
      },
    ],
    root: { props: {} },
  } as Template;
}

describe("migrateBlocks — template vocabulary", () => {
  it("maps Section widths onto sm / md / lg and drops padding", () => {
    const out = migrateBlocks([
      { type: "Section", props: { width: "narrow", padding: "none" } },
      { type: "Section", props: { width: "default" } },
      { type: "Section", props: { width: "wide", padding: "default" } },
      { type: "Section", props: { width: "full", padding: "large" } },
    ]);
    expect(out.map((b) => (b as { props: unknown }).props)).toEqual([
      { width: "sm" },
      { width: "md" },
      { width: "lg" },
      { width: "full" },
    ]);
  });

  it("renames Button label → text and Image src → image, keeping the binding", () => {
    const [button, image] = migrateBlocks([
      { type: "Button", props: { label: bind("f_cta"), href: lit("#") } },
      { type: "Image", props: { src: bind("f_cover"), altOverride: lit("Alt") } },
    ]) as Array<{ props: Record<string, unknown> }>;
    expect(button.props).toEqual({ text: bind("f_cta"), href: lit("#") });
    expect(image.props).toEqual({ image: bind("f_cover"), altOverride: lit("Alt") });
  });

  it("turns RichTextRender into a RichText bound to the same field", () => {
    const [block] = migrateBlocks([{ type: "RichTextRender", props: { id: "r1", field: "f_body" } }]);
    expect(block).toEqual({
      type: "RichText",
      props: { id: "r1", text: bind("f_body"), align: "start" },
    });
  });

  it("migrates blocks nested in any slot", () => {
    const [columns] = migrateBlocks([
      { type: "Columns", props: { col2: [{ type: "Button", props: { label: lit("Go") } }] } },
    ]) as Array<{ props: { col2: Array<{ props: unknown }> } }>;
    expect(columns.props.col2[0].props).toEqual({ text: lit("Go") });
  });

  it("is idempotent", () => {
    const once = migratePuckData(oldVocabTemplate());
    expect(migratePuckData(once)).toBe(once);
  });
});

describe("migration leaves page JSON and first-run seeds untouched", () => {
  it("returns every committed item unchanged (same object)", async () => {
    const collections = await readdir(path.join(CONTENT_DIR, "collections"));
    let checked = 0;
    for (const slug of collections) {
      const itemsDir = path.join(CONTENT_DIR, "collections", slug, "items");
      const files = await readdir(itemsDir).catch(() => [] as string[]);
      for (const file of files.filter((f) => f.endsWith(".json") && f !== "_order.json")) {
        const item = JSON.parse(await readFile(path.join(itemsDir, file), "utf-8")) as Item;
        expect(migrateItemValues(item.values), `${slug}/${file}`).toBe(item.values);
        checked += 1;
      }
      const def = JSON.parse(
        await readFile(path.join(CONTENT_DIR, "collections", slug, "_collection.json"), "utf-8"),
      ) as CollectionDef;
      expect(migrateCollectionDef(def), `${slug}/_collection.json`).toBe(def);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("returns the first-run seed pages and prebaked collections unchanged", () => {
    const seed = buildFirstRunSeed("Ada Lovelace", "Home", new Date("2026-06-01T00:00:00Z"));
    for (const page of [seed.homePage, ...seed.starterPages]) {
      expect(migratePuckData(page.data), page.slug).toBe(page.data);
    }
    const homeValues = homePageItemValues(seed.homePage) as Record<string, FieldValue>;
    expect(migrateItemValues(homeValues)).toBe(homeValues);
    for (const def of Object.values(PREBAKED_COLLECTIONS)) expect(migrateCollectionDef(def)).toBe(def);
  });
});

describe("a migrated template renders through the one library", () => {
  const item: Item = {
    id: "item_r",
    slug: "r",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    values: {
      f_title: { type: "text", value: "The Long Way Home" },
      f_body: {
        type: "richText",
        value: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Liner notes." }] }] },
      },
    },
  };

  it("keeps every bound value and drops the block whose image field is empty", () => {
    const resolved = resolveTemplate(migratePuckData(oldVocabTemplate()), item);
    const html = renderToStaticMarkup(
      <Render config={buildPuckConfig({ variant: "render" })} data={resolved as Data} />,
    );
    expect(html).toContain("max-width:var(--max-width-narrow)");
    expect(html).toContain("The Long Way Home");
    expect(html).toContain("<p>Liner notes.</p>");
    expect(html).toContain('href="/music"');
    expect(html).toContain("All releases");
    // f_cover has no value → the Image block hides (ADR-009 §4.1).
    expect(html).not.toContain("<picture");
    expect(html).not.toContain("linear-gradient");
  });
});

describe("scripts/migrate-block-library.mjs", () => {
  it("finds nothing to change in the committed content", async () => {
    const { stdout } = await run("node", [SCRIPT, CONTENT_DIR, "--check"]);
    expect(stdout).toContain("0 file(s) would change");
  });

  it("rewrites an old-vocabulary template once, then is a no-op", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "migrate-blocks-"));
    try {
      await cp(CONTENT_DIR, dir, { recursive: true });
      const defPath = path.join(dir, "collections/releases/_collection.json");
      const def = JSON.parse(await readFile(defPath, "utf-8"));
      await writeFile(defPath, JSON.stringify({ ...def, detailTemplate: oldVocabTemplate() }));

      await expect(run("node", [SCRIPT, dir, "--check"])).rejects.toMatchObject({ code: 1 });
      const first = await run("node", [SCRIPT, dir]);
      expect(first.stdout).toContain("1 file(s) changed");
      const migrated = JSON.parse(await readFile(defPath, "utf-8"));
      expect(migrated.detailTemplate).toEqual(migratePuckData(oldVocabTemplate()));
      const second = await run("node", [SCRIPT, dir]);
      expect(second.stdout).toContain("0 file(s) changed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
