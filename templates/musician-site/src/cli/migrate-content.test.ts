import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fake chain where version 0 stores the plural name as `plural`.
vi.mock("@jclaw-labs/content-upgraders", () => ({
  upgradeCollection: (collection: Record<string, unknown>, target: number) => {
    if (collection.schemaVersion === -5) throw new RangeError("schemaVersion -5 is older than 0, the oldest supported.");
    const { plural, ...rest } = collection;
    return target === 1 && collection.schemaVersion === 0 ? { ...rest, pluralName: plural, schemaVersion: 1 } : collection;
  },
}));

import { migrateContent, MIGRATE_CONTENT_USAGE, packageSchemaVersion } from "./migrate-content.js";
import { run } from "./run.js";

let cwd: string;

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-content-"));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

const defPath = (slug: string, dir = "src/content") => path.join(cwd, dir, "collections", slug, "_collection.json");

function writeDef(slug: string, content: unknown, dir?: string) {
  fs.mkdirSync(path.dirname(defPath(slug, dir)), { recursive: true });
  fs.writeFileSync(defPath(slug, dir), typeof content === "string" ? content : JSON.stringify(content));
}

const readDef = (slug: string, dir?: string) => JSON.parse(fs.readFileSync(defPath(slug, dir), "utf8"));

function migrate(argv: string[] = []) {
  let out = "";
  let err = "";
  const code = migrateContent(argv, { out: (t) => (out += t), err: (t) => (err += t) }, { cwd, target: 1 });
  return { code, out, err };
}

describe("migrate-content", () => {
  it("upgrades older collections in place and leaves current ones alone", () => {
    writeDef("shows", { schemaVersion: 0, slug: "shows", plural: "shows" });
    writeDef("pages", { schemaVersion: 1, slug: "pages", pluralName: "pages" });
    const before = fs.readFileSync(defPath("pages"), "utf8");

    const result = migrate();

    expect(result).toMatchObject({ code: 0, err: "" });
    expect(result.out).toContain("src/content/collections/shows/_collection.json: schemaVersion 0 → 1");
    expect(result.out).toContain("Upgraded 1 of 2 collections to schemaVersion 1.");
    expect(readDef("shows")).toEqual({ schemaVersion: 1, slug: "shows", pluralName: "shows" });
    expect(fs.readFileSync(defPath("shows"), "utf8")).toMatch(/^\{\n {2}"schemaVersion": 1,[\s\S]*\}\n$/);
    expect(fs.readFileSync(defPath("pages"), "utf8")).toBe(before);
  });

  it("reports when everything is current", () => {
    writeDef("pages", { schemaVersion: 1 });
    expect(migrate()).toEqual({ code: 0, out: "All 1 collections are at schemaVersion 1.\n", err: "" });
  });

  it("--check lists what would change without writing, and exits 1", () => {
    writeDef("shows", { schemaVersion: 0, plural: "shows" });
    const result = migrate(["--check"]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("schemaVersion 0 → 1 (not written, --check)");
    expect(result.out).toContain("Would upgrade 1 of 1 collections");
    expect(readDef("shows").schemaVersion).toBe(0);
  });

  it("--check exits 0 when nothing would change", () => {
    writeDef("pages", { schemaVersion: 1 });
    expect(migrate(["--check"]).code).toBe(0);
  });

  it("fails closed on a newer collection, naming what to update, and still upgrades the rest", () => {
    writeDef("future", { schemaVersion: 2 });
    writeDef("shows", { schemaVersion: 0, plural: "shows" });
    const result = migrate();
    expect(result.code).toBe(1);
    expect(result.err).toContain("schemaVersion 2 is newer than the 1 this package reads");
    expect(result.err).toContain("Update @jclaw-labs/musician-site");
    expect(readDef("future").schemaVersion).toBe(2);
    expect(readDef("shows").schemaVersion).toBe(1);
  });

  it("fails on invalid JSON and on a step that throws", () => {
    writeDef("broken", "{nope");
    writeDef("ancient", { schemaVersion: -5 });
    const result = migrate();
    expect(result.code).toBe(1);
    expect(result.err).toContain("broken/_collection.json: not valid JSON");
    expect(result.err).toContain("ancient/_collection.json: schemaVersion -5 is older than 0");
  });

  it("fails when there are no collections", () => {
    expect(migrate()).toMatchObject({ code: 1, err: expect.stringContaining("no collections under src/content") });
  });

  it("reads another content directory", () => {
    writeDef("shows", { schemaVersion: 0, plural: "shows" }, "content");
    expect(migrate(["--content-dir", "content"]).code).toBe(0);
    expect(readDef("shows", "content").schemaVersion).toBe(1);
  });

  it("prints its usage, and rejects an unknown option", () => {
    expect(migrate(["--help"])).toEqual({ code: 0, out: MIGRATE_CONTENT_USAGE, err: "" });
    const bad = migrate(["--force"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('unknown option "--force"');
    expect(migrate(["--content-dir"]).err).toContain('unknown option "--content-dir"');
  });

  it("targets the package's schemaVersion by default", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"));
    expect(packageSchemaVersion()).toBe(pkg.stagecraft.schemaVersion);
  });

  it("is a command of the CLI", () => {
    let out = "";
    expect(run(["migrate-content", "--help"], { out: (t) => (out += t), err: () => {} })).toBe(0);
    expect(out).toBe(MIGRATE_CONTENT_USAGE);
  });
});
