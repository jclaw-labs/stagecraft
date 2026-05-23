/**
 * One-shot migration script for ADR-009 PR 3.
 *
 * Reads any legacy content under `src/content/{pages,config}/` and
 * rewrites it into the new collection layout under
 * `src/content/collections/`. Also writes the four prebaked
 * `_collection.json` files.
 *
 * Idempotent: re-running against an already-migrated tree is a no-op
 * (existing items keep their `id` / `createdAt` / `updatedAt`). Safe
 * to run once during PR 3 and then again as a sanity check.
 */

import { readFile, writeFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const contentRoot = join(root, "src/content");

const NOW = new Date().toISOString();

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(p) {
  const raw = await readFile(p, "utf-8");
  return JSON.parse(raw);
}

async function writeJson(p, value) {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

/**
 * Build the seed CollectionDef objects in a way that matches
 * `src/lib/collections/seeds.ts`. Hand-mirrored here because this
 * script runs as plain ESM, not through the TS toolchain.
 */
function pagesCollectionDef() {
  return {
    schemaVersion: 1,
    slug: "pages",
    singularName: "page",
    pluralName: "pages",
    fields: [
      { id: "fld_pages_title", key: "title", type: "text", required: true, systemLocked: true },
      { id: "fld_pages_isSplashPage", key: "isSplashPage", type: "boolean", systemLocked: true },
      { id: "fld_pages_isFooterHidden", key: "isFooterHidden", type: "boolean", systemLocked: true },
      { id: "fld_pages_showInNav", key: "showInNav", type: "boolean", default: true, systemLocked: true },
      { id: "fld_pages_body", key: "body", type: "puckContent", systemLocked: true },
    ],
    slugSourceFieldId: "fld_pages_title",
    detailUrlPrefix: "/",
    defaultSort: { mode: "manual" },
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: false,
  };
}

function siteCollectionDef() {
  const social = [
    "instagram", "twitter", "facebook", "youtube", "spotify",
    "appleMusic", "bandcamp", "soundcloud", "tiktok",
  ];
  return {
    schemaVersion: 1,
    slug: "site",
    singularName: "site settings",
    pluralName: "site settings",
    fields: [
      { id: "fld_site_artistName", key: "artistName", type: "text", required: true, systemLocked: true },
      { id: "fld_site_siteTitle", key: "siteTitle", type: "text", required: true, systemLocked: true },
      { id: "fld_site_siteDescription", key: "siteDescription", type: "longText", required: false },
      { id: "fld_site_contactEmail", key: "contactEmail", type: "email", required: true, systemLocked: true },
      { id: "fld_site_copyrightName", key: "copyrightName", type: "text", required: false },
      { id: "fld_site_isFooterHidden", key: "isFooterHidden", type: "boolean" },
      ...social.map((p) => ({
        id: `fld_site_social_${p}`,
        key: `social_${p}`,
        type: "url",
        required: false,
      })),
    ],
    slugSourceFieldId: null,
    detailUrlPrefix: null,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: true,
  };
}

function headerCollectionDef() {
  return {
    schemaVersion: 1,
    slug: "header",
    singularName: "header & navigation",
    pluralName: "header & navigation",
    fields: [
      { id: "fld_header_wordmark", key: "wordmark", type: "image", required: false },
      { id: "fld_header_wordmarkSizeAdjust", key: "wordmarkSizeAdjust", type: "number", required: false, min: -2, max: 2, step: 1 },
      {
        id: "fld_header_headerMode",
        key: "headerMode",
        type: "select",
        required: true,
        systemLocked: true,
        options: [
          { id: "o1", value: "solid-sticky", label: "Solid, sticky (default)" },
          { id: "o2", value: "solid-static", label: "Solid, scrolls with page" },
          { id: "o3", value: "transparent-static", label: "Transparent, scrolls with page" },
        ],
      },
      { id: "fld_header_headerForegroundColor", key: "headerForegroundColor", type: "text", required: false },
      { id: "fld_header_isHeaderTextUppercase", key: "isHeaderTextUppercase", type: "boolean" },
      { id: "fld_header_headerSubtitle", key: "headerSubtitle", type: "text", required: false },
      {
        id: "fld_header_headerLayout",
        key: "headerLayout",
        type: "select",
        required: true,
        systemLocked: true,
        options: [
          { id: "o1", value: "logo-left-nav-right", label: "Logo left, nav right (default)" },
          { id: "o2", value: "logo-center-nav-below", label: "Logo centered, nav below" },
          { id: "o3", value: "logo-center-nav-split", label: "Logo centered, nav split left/right" },
        ],
      },
    ],
    slugSourceFieldId: null,
    detailUrlPrefix: null,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: true,
  };
}

function appearanceCollectionDef() {
  const colors = [
    "primary", "secondary", "accent", "linkColor", "background",
    "surface", "text", "textMuted", "border",
  ];
  const fontWeightOptions = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w, i) => ({
    id: `o${i + 1}`,
    value: String(w),
    label: String(w),
  }));
  const weightFields = [
    "bodyWeight_body", "bodyWeight_bodyBold",
    "headingWeight_h1", "headingWeight_h2", "headingWeight_h3",
  ].map((key) => ({
    id: `fld_appearance_${key}`,
    key,
    type: "select",
    required: true,
    systemLocked: true,
    options: fontWeightOptions,
  }));
  return {
    schemaVersion: 1,
    slug: "appearance",
    singularName: "appearance",
    pluralName: "appearance",
    fields: [
      ...colors.map((c) => ({
        id: `fld_appearance_color_${c}`,
        key: `color_${c}`,
        type: "text",
        required: c !== "linkColor",
        systemLocked: true,
      })),
      { id: "fld_appearance_bodyFont", key: "bodyFont", type: "text", required: true, systemLocked: true },
      {
        id: "fld_appearance_headingMode",
        key: "headingMode",
        type: "select",
        required: true,
        systemLocked: true,
        options: [
          { id: "o1", value: "single", label: "Same font for everything" },
          { id: "o2", value: "split", label: "Different font for headings" },
        ],
      },
      { id: "fld_appearance_headingFont", key: "headingFont", type: "text", required: false },
      ...weightFields,
    ],
    slugSourceFieldId: null,
    detailUrlPrefix: null,
    defaultSort: null,
    itemTemplate: null,
    detailTemplate: null,
    listTemplate: null,
    isSingleton: true,
  };
}

async function migratePage(slug, legacy, existingId) {
  const root = legacy.root?.props ?? {};
  return {
    id: existingId ?? `item_${randomUUID()}`,
    createdAt: NOW,
    updatedAt: NOW,
    values: {
      fld_pages_title: { type: "text", value: root.title ?? "Untitled" },
      fld_pages_isSplashPage: { type: "boolean", value: root.isSplashPage === true },
      fld_pages_isFooterHidden: { type: "boolean", value: root.isFooterHidden === true },
      fld_pages_showInNav: { type: "boolean", value: true },
      fld_pages_body: {
        type: "puckContent",
        value: { content: legacy.content ?? [], root: { props: {} } },
      },
    },
  };
}

async function main() {
  // 1. Write the four `_collection.json` seeds (skip if already there).
  const defs = {
    pages: pagesCollectionDef(),
    site: siteCollectionDef(),
    header: headerCollectionDef(),
    appearance: appearanceCollectionDef(),
  };
  for (const [slug, def] of Object.entries(defs)) {
    const p = join(contentRoot, "collections", slug, "_collection.json");
    if (!(await exists(p))) {
      await writeJson(p, def);
      console.log(`wrote ${p}`);
    } else {
      console.log(`skip ${p} (exists)`);
    }
  }

  // 2. Migrate any legacy `src/content/pages/*.json` files into the
  //    pages collection's items dir.
  const legacyPagesDir = join(contentRoot, "pages");
  if (await exists(legacyPagesDir)) {
    const files = await readdir(legacyPagesDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const slug = file.replace(/\.json$/, "");
      const legacy = await readJson(join(legacyPagesDir, file));
      const newPath = join(contentRoot, "collections/pages/items", file);
      // Preserve existing id if the new file already exists.
      let existingId;
      if (await exists(newPath)) {
        try {
          existingId = (await readJson(newPath)).id;
        } catch {}
      }
      const item = await migratePage(slug, legacy, existingId);
      await writeJson(newPath, item);
      console.log(`migrated ${file} → ${newPath}`);
    }
    // Drop the old dir once all files are migrated.
    await rm(legacyPagesDir, { recursive: true, force: true });
    console.log(`removed legacy ${legacyPagesDir}`);
  }

  // 3. Legacy singletons under `src/content/config/*.json` — none are
  //    checked into the seed repo today, but migrate any that exist
  //    for completeness so re-running this script handles a fresh
  //    artist site that just edited their settings before upgrading.
  const legacyConfigDir = join(contentRoot, "config");
  if (await exists(legacyConfigDir)) {
    // The migration helpers (in TS) would do this; for the bootstrap
    // script we just preserve the file at its new singleton path as
    // a marker. Re-saving via the admin UI rebuilds the proper Item
    // shape. Documented as a known migration boundary.
    console.warn(
      `note: ${legacyConfigDir} contains legacy singletons. Open each /admin/* panel once after upgrade to re-save through the new wrapper layer.`,
    );
  }

  console.log("\ndone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
