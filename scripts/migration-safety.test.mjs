import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, classifyDiff, main, maskSql, scanSql } from "./migration-safety.mjs";

const kinds = (sql) => scanSql(sql, "m.sql").map((f) => f.kind);

describe("scanSql — flagged patterns", () => {
  it.each([
    ["drop-table", 'DROP TABLE "Site";'],
    ["drop-table", 'DROP TABLE IF EXISTS "Site" CASCADE;'],
    ["drop-column", 'ALTER TABLE "Site" DROP COLUMN "netlifyAdminUrl";'],
    ["alter-column-type", 'ALTER TABLE "AssetUpload" ALTER COLUMN "ref" TYPE TEXT;'],
    ["alter-column-type", 'ALTER TABLE "AssetUpload" ALTER COLUMN "ref" SET DATA TYPE VARCHAR(10);'],
    ["alter-column-type", 'ALTER TABLE "AssetUpload" ALTER "ref" TYPE TEXT USING "ref"::text;'],
    ["set-not-null", 'ALTER TABLE "Site" ALTER COLUMN "slug" SET NOT NULL;'],
    ["add-not-null-without-default", 'ALTER TABLE "Site" ADD COLUMN "slug" TEXT NOT NULL;'],
    ["add-not-null-without-default", 'ALTER TABLE "Site" ADD "slug" TEXT NOT NULL;'],
    ["rename", 'ALTER TABLE "Site" RENAME COLUMN "name" TO "title";'],
    ["rename", 'ALTER TABLE "Site" RENAME TO "ArtistSite";'],
    ["rename", 'ALTER TABLE "Site" RENAME "name" TO "title";'],
    ["rename", 'ALTER TYPE "JobStatus" RENAME TO "JobStatus_old";'],
    ["rename", "ALTER TYPE \"JobStatus\" RENAME VALUE 'queued' TO 'pending';"],
  ])("flags %s: %s", (kind, sql) => {
    expect(kinds(sql)).toEqual([kind]);
  });

  it("is case-insensitive", () => {
    expect(kinds('drop table "Site";')).toEqual(["drop-table"]);
    expect(kinds('alter table "Site" Drop Column "x";')).toEqual(["drop-column"]);
    expect(kinds('alter table "a" alter column "b" type text;')).toEqual(["alter-column-type"]);
    expect(kinds('alter table "a" alter column "b" set not null;')).toEqual(["set-not-null"]);
    expect(kinds('alter table "a" add column "b" text not null;')).toEqual(["add-not-null-without-default"]);
    expect(kinds('alter table "a" rename column "b" to "c";')).toEqual(["rename"]);
  });

  it("matches across line breaks", () => {
    expect(kinds('ALTER TABLE "Site"\n  DROP\n  COLUMN "x";')).toEqual(["drop-column"]);
  });

  it("flags SET NOT NULL even after a backfill and default in the same migration", () => {
    const sql = [
      'ALTER TABLE "Site" ALTER COLUMN "slug" SET DEFAULT \'\';',
      'UPDATE "Site" SET "slug" = "id" WHERE "slug" IS NULL;',
      'ALTER TABLE "Site" ALTER COLUMN "slug" SET NOT NULL;',
    ].join("\n");
    expect(scanSql(sql, "m.sql")).toEqual([
      expect.objectContaining({ kind: "set-not-null", line: 3, file: "m.sql" }),
    ]);
  });

  it("reports each finding with its line", () => {
    const sql = '-- header\nALTER TABLE "a" DROP COLUMN "b";\n\nDROP TABLE "c";\n';
    expect(scanSql(sql, "m.sql").map((f) => [f.kind, f.line])).toEqual([
      ["drop-column", 2],
      ["drop-table", 4],
    ]);
  });

  it("flags only the NOT NULL action without a default in a multi-action ALTER", () => {
    const sql = [
      'ALTER TABLE "Site"',
      "  ADD COLUMN \"a\" TEXT NOT NULL DEFAULT 'x',",
      '  ADD COLUMN "b" DECIMAL(10,2),',
      '  ADD COLUMN "c" INTEGER NOT NULL;',
    ].join("\n");
    expect(scanSql(sql, "m.sql").map((f) => [f.kind, f.line])).toEqual([["add-not-null-without-default", 4]]);
  });
});

describe("scanSql — ignored", () => {
  it("ignores line and block comments", () => {
    expect(kinds('-- DROP TABLE "Site";\nSELECT 1;')).toEqual([]);
    expect(kinds('/* ALTER TABLE "a" DROP COLUMN "b"; */ SELECT 1;')).toEqual([]);
    expect(kinds('/* outer /* nested */ DROP TABLE "x"; */ SELECT 1;')).toEqual([]);
    expect(kinds('ALTER TABLE "a" ADD COLUMN "b" TEXT; -- later: SET NOT NULL')).toEqual([]);
  });

  it("ignores keywords inside string literals and quoted identifiers", () => {
    expect(kinds("ALTER TABLE \"a\" ADD COLUMN \"b\" TEXT NOT NULL DEFAULT 'drop table; rename';")).toEqual([]);
    expect(kinds('ALTER TABLE "a" ADD COLUMN "DROP COLUMN" TEXT;')).toEqual([]);
    expect(kinds("INSERT INTO \"a\" VALUES ('it''s -- not; DROP TABLE');")).toEqual([]);
  });

  it.each([
    ['ALTER TABLE "Site" ADD COLUMN "archivedAt" TIMESTAMP(3);'],
    ['ALTER TABLE "Site" ADD COLUMN "deployTarget" TEXT NOT NULL DEFAULT \'netlify\';'],
    ['ALTER TABLE "SiteJob" ADD COLUMN "repairAttempts" INTEGER NOT NULL DEFAULT 0;'],
    ['ALTER TABLE "a" ADD COLUMN "n" INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY;'],
    ['ALTER TABLE "a" ADD COLUMN IF NOT EXISTS "b" TEXT;'],
    ['ALTER TABLE "a" ALTER COLUMN "b" DROP NOT NULL;'],
    ['ALTER TABLE "a" ALTER COLUMN "b" SET DEFAULT 0;'],
    ['ALTER TABLE "a" ADD CONSTRAINT "a_b_fkey" FOREIGN KEY ("b") REFERENCES "c"("id") ON DELETE CASCADE;'],
    ['ALTER TABLE "a" DROP CONSTRAINT "a_b_fkey";'],
    ['CREATE TABLE "W" ("id" TEXT NOT NULL, "type" TEXT NOT NULL, CONSTRAINT "W_pkey" PRIMARY KEY ("id"));'],
    ['CREATE UNIQUE INDEX "W_id_key" ON "W"("id");'],
    ['DROP INDEX "W_id_key";'],
    ['ALTER INDEX "a_old" RENAME TO "a_new";'],
    ["ALTER TYPE \"JobStatus\" ADD VALUE 'paused';"],
  ])("allows %s", (sql) => {
    expect(kinds(sql)).toEqual([]);
  });
});

describe("maskSql", () => {
  it("keeps length and newlines", () => {
    const sql = "a -- c\n'x\ny' \"q\" /* z\n */ b";
    const masked = maskSql(sql);
    expect(masked).toHaveLength(sql.length);
    expect(masked.split("\n")).toHaveLength(sql.split("\n").length);
    expect(masked).toBe("a     \n'_\n_' \"_\"     \n    b");
  });
});

describe("classifyDiff", () => {
  const dir = MIGRATIONS_DIR;
  it("scans added .sql files and flags edits to existing ones", () => {
    const out = classifyDiff(
      [
        `A\t${dir}/20270101000000_new/migration.sql`,
        `M\t${dir}/20260408034026_init/migration.sql`,
        `D\t${dir}/20260409030217_x/migration.sql`,
        `R100\t${dir}/20260410120000_a/migration.sql\t${dir}/20260410120001_a/migration.sql`,
        `M\t${dir}/migration_lock.toml`,
        `A\t${dir}/README.md`,
        "",
      ].join("\n"),
    );
    expect(out.added).toEqual([`${dir}/20270101000000_new/migration.sql`]);
    expect(out.edited.map((f) => [f.kind, f.file, f.message.split(";")[0]])).toEqual([
      ["edited-migration", `${dir}/20260408034026_init/migration.sql`, "existing migration modified"],
      ["edited-migration", `${dir}/20260409030217_x/migration.sql`, "existing migration deleted"],
      ["edited-migration", `${dir}/20260410120000_a/migration.sql`, "existing migration renamed"],
    ]);
  });

  it("returns nothing for an empty diff", () => {
    expect(classifyDiff("")).toEqual({ added: [], edited: [] });
  });
});

describe("main", () => {
  function tmpdir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "migration-safety-"));
  }
  function run(argv, cwd) {
    const lines = [];
    const code = main(argv, { cwd, log: (s) => lines.push(s) });
    return { code, out: lines.join("\n") };
  }

  it("validates arguments", () => {
    expect(() => main([])).toThrow(/--base REF/);
    expect(() => main(["--base"])).toThrow(/needs a value/);
    expect(() => main(["--base", "main", "x.sql"])).toThrow(/--base REF/);
    expect(() => main(["--bogus"])).toThrow(/unknown option/);
  });

  it("scans explicit files and emits GitHub annotations", () => {
    const cwd = tmpdir();
    fs.writeFileSync(path.join(cwd, "bad.sql"), '\nDROP TABLE "x";\n');
    fs.writeFileSync(path.join(cwd, "ok.sql"), 'ALTER TABLE "x" ADD COLUMN "y" TEXT;\n');
    const bad = run(["bad.sql", "ok.sql"], cwd);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("::error file=bad.sql,line=2,title=Backward-incompatible migration (drop-table)::");
    expect(bad.out).toContain("migration:destructive-ok");
    expect(run(["ok.sql"], cwd)).toEqual({ code: 0, out: "ok: no backward-incompatible migration changes" });
  });

  describe("--base", () => {
    function git(cwd, ...args) {
      const r = spawnSync("git", args, { cwd, encoding: "utf8" });
      if (r.status !== 0) throw new Error(r.stderr);
      return r.stdout;
    }
    function write(cwd, rel, content) {
      fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
      fs.writeFileSync(path.join(cwd, rel), content);
    }
    function repo() {
      const cwd = tmpdir();
      git(cwd, "init", "-q", "-b", "main");
      git(cwd, "config", "user.email", "t@example.com");
      git(cwd, "config", "user.name", "t");
      write(cwd, `${MIGRATIONS_DIR}/1_init/migration.sql`, 'CREATE TABLE "a" ("id" TEXT NOT NULL);\n');
      write(cwd, `${MIGRATIONS_DIR}/2_old_drop/migration.sql`, 'ALTER TABLE "a" DROP COLUMN "x";\n');
      git(cwd, "add", ".");
      git(cwd, "commit", "-q", "-m", "base");
      git(cwd, "checkout", "-q", "-b", "pr");
      return cwd;
    }

    it("checks only migrations added since the merge base", () => {
      const cwd = repo();
      write(cwd, `${MIGRATIONS_DIR}/3_add/migration.sql`, 'ALTER TABLE "a" ADD COLUMN "b" TEXT;\n');
      git(cwd, "add", ".");
      git(cwd, "commit", "-q", "-m", "pr");
      const r = run(["--base", "main"], cwd);
      expect(r.code).toBe(0);
      expect(r.out).toContain("1 new migration file(s)");
    });

    it("flags destructive SQL in a new migration", () => {
      const cwd = repo();
      write(cwd, `${MIGRATIONS_DIR}/3_drop/migration.sql`, 'DROP TABLE "a";\n');
      git(cwd, "add", ".");
      git(cwd, "commit", "-q", "-m", "pr");
      const r = run(["--base", "main"], cwd);
      expect(r.code).toBe(1);
      expect(r.out).toContain(`file=${MIGRATIONS_DIR}/3_drop/migration.sql,line=1`);
      expect(r.out).not.toContain("2_old_drop");
    });

    it("flags an edit to an existing migration", () => {
      const cwd = repo();
      write(cwd, `${MIGRATIONS_DIR}/1_init/migration.sql`, 'CREATE TABLE "a" ("id" TEXT);\n');
      git(cwd, "commit", "-q", "-am", "pr");
      const r = run(["--base", "main"], cwd);
      expect(r.code).toBe(1);
      expect(r.out).toContain("(edited-migration)::existing migration modified");
    });

    it("throws when the base ref is unknown", () => {
      expect(() => main(["--base", "nope"], { cwd: repo(), log: () => {} })).toThrow(/merge-base/);
    });
  });
});
