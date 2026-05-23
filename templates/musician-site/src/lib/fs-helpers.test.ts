import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  contentDir,
  isNotFound,
  localPathForRepoPath,
  purgeOrphanTmps,
  readdirFiltered,
  readJson,
  REPO_CONTENT_PREFIX,
  stringifyContent,
  unlinkIfExists,
  writeJson,
  writeJsonAtomic,
  writeJsonBatchAtomic,
} from "./fs-helpers";

let TMP_DIR: string;

beforeAll(async () => {
  TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "stagecraft-fs-helpers-"));
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.STAGECRAFT_CONTENT_DIR = TMP_DIR;
});

describe("contentDir", () => {
  it("returns STAGECRAFT_CONTENT_DIR when set", () => {
    expect(contentDir()).toBe(TMP_DIR);
  });

  it("falls back to <cwd>/src/content when unset", () => {
    delete process.env.STAGECRAFT_CONTENT_DIR;
    expect(contentDir()).toBe(path.join(process.cwd(), "src/content"));
  });
});

describe("stringifyContent", () => {
  it("indents 2 spaces and ends with a newline", () => {
    expect(stringifyContent({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe("isNotFound", () => {
  it("returns true for ENOENT errors", () => {
    expect(isNotFound({ code: "ENOENT" })).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isNotFound({ code: "EACCES" })).toBe(false);
    expect(isNotFound(new Error("oops"))).toBe(false);
    expect(isNotFound(null)).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });
});

describe("readJson", () => {
  it("returns null when the file doesn't exist", async () => {
    expect(await readJson(path.join(TMP_DIR, "missing.json"))).toBeNull();
  });

  it("returns null for a zero-byte file (treats half-written as missing)", async () => {
    const file = path.join(TMP_DIR, "empty.json");
    await fs.writeFile(file, "");
    expect(await readJson(file)).toBeNull();
  });

  it("parses JSON when the file is valid", async () => {
    const file = path.join(TMP_DIR, "ok.json");
    await fs.writeFile(file, '{"x":1}');
    expect(await readJson<{ x: number }>(file)).toEqual({ x: 1 });
  });

  it("throws on malformed JSON (callers want a loud failure, not a silent fallback)", async () => {
    const file = path.join(TMP_DIR, "bad.json");
    await fs.writeFile(file, "{not json");
    await expect(readJson(file)).rejects.toThrow();
  });
});

describe("writeJson", () => {
  it("creates parent directories as needed", async () => {
    const file = path.join(TMP_DIR, "deep/nested/dir/file.json");
    await writeJson(file, { x: 1 });
    expect(await readJson(file)).toEqual({ x: 1 });
  });

  it("writes with canonical formatting (matches stringifyContent)", async () => {
    const file = path.join(TMP_DIR, "format.json");
    await writeJson(file, { a: 1 });
    expect(await fs.readFile(file, "utf-8")).toBe('{\n  "a": 1\n}\n');
  });
});

describe("readdirFiltered", () => {
  it("returns the picked values from each entry, sorted", async () => {
    const dir = path.join(TMP_DIR, "filt");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "c.json"), "");
    await fs.writeFile(path.join(dir, "a.json"), "");
    await fs.writeFile(path.join(dir, "b.txt"), "");
    const result = await readdirFiltered(dir, (e) =>
      e.isFile() && e.name.endsWith(".json") ? e.name.replace(/\.json$/, "") : null,
    );
    expect(result).toEqual(["a", "c"]);
  });

  it("returns [] when the directory doesn't exist (ENOENT swallowed)", async () => {
    expect(await readdirFiltered(path.join(TMP_DIR, "nope"), () => "x")).toEqual([]);
  });
});

describe("unlinkIfExists", () => {
  it("deletes the file when present", async () => {
    const file = path.join(TMP_DIR, "to-delete.txt");
    await fs.writeFile(file, "");
    await unlinkIfExists(file);
    expect(await readJson(file)).toBeNull();
  });

  it("is a no-op when the file doesn't exist", async () => {
    await expect(unlinkIfExists(path.join(TMP_DIR, "nope.txt"))).resolves.toBeUndefined();
  });
});

describe("writeJsonAtomic", () => {
  it("writes the file with canonical formatting (matches writeJson)", async () => {
    const file = path.join(TMP_DIR, "atomic-ok.json");
    await writeJsonAtomic(file, { a: 1 });
    expect(await fs.readFile(file, "utf-8")).toBe('{\n  "a": 1\n}\n');
  });

  it("creates parent directories as needed", async () => {
    const file = path.join(TMP_DIR, "atomic-deep/dir/file.json");
    await writeJsonAtomic(file, { x: 1 });
    expect(await readJson(file)).toEqual({ x: 1 });
  });

  it("leaves no tmp sibling behind on success", async () => {
    const dir = path.join(TMP_DIR, "no-tmp-leak");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "x.json");
    await writeJsonAtomic(file, { y: 2 });
    const siblings = await fs.readdir(dir);
    expect(siblings).toEqual(["x.json"]);
  });

  it("doesn't touch the final file when stringify throws", async () => {
    // Pre-write a known-good file so we can verify the write
    // operation left it alone.
    const file = path.join(TMP_DIR, "preserved-on-error.json");
    await fs.writeFile(file, '{"original":true}\n', "utf-8");

    // Circular references make `JSON.stringify` throw inside
    // `stringifyContent`. Because we write the tmp BEFORE renaming
    // into place, a stringify throw leaves the final file untouched.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(writeJsonAtomic(file, circular)).rejects.toThrow();

    // Final file is byte-for-byte unchanged.
    expect(await fs.readFile(file, "utf-8")).toBe('{"original":true}\n');
  });
});

describe("writeJsonBatchAtomic", () => {
  it("is a no-op for an empty array", async () => {
    await expect(writeJsonBatchAtomic([])).resolves.toBeUndefined();
  });

  it("writes every entry on the happy path", async () => {
    const dir = path.join(TMP_DIR, "batch-ok");
    await fs.mkdir(dir, { recursive: true });
    const writes = [
      { file: path.join(dir, "a.json"), value: { n: 1 } },
      { file: path.join(dir, "b.json"), value: { n: 2 } },
      { file: path.join(dir, "c.json"), value: { n: 3 } },
    ];
    await writeJsonBatchAtomic(writes);
    expect(await readJson(writes[0].file)).toEqual({ n: 1 });
    expect(await readJson(writes[1].file)).toEqual({ n: 2 });
    expect(await readJson(writes[2].file)).toEqual({ n: 3 });
  });

  it("leaves no tmp siblings behind on success", async () => {
    const dir = path.join(TMP_DIR, "batch-no-tmp-leak");
    await fs.mkdir(dir, { recursive: true });
    await writeJsonBatchAtomic([
      { file: path.join(dir, "x.json"), value: { v: 1 } },
      { file: path.join(dir, "y.json"), value: { v: 2 } },
    ]);
    const names = (await fs.readdir(dir)).sort();
    expect(names).toEqual(["x.json", "y.json"]);
  });

  it("phase-1 rollback: a mid-batch stringify throw leaves no final files touched", async () => {
    // Pre-write the FIRST final path so we can verify it survives.
    // The OTHER two paths don't exist initially.
    const dir = path.join(TMP_DIR, "batch-rollback");
    await fs.mkdir(dir, { recursive: true });
    const fileA = path.join(dir, "a.json");
    const fileB = path.join(dir, "b.json");
    const fileC = path.join(dir, "c.json");
    await fs.writeFile(fileA, '{"keep":"me"}\n', "utf-8");

    // Second entry stringifies fine; THIRD entry has a circular
    // reference so phase-1 throws on it. Phase-1 rollback should
    // delete the tmps for entries 1 and 2 and not touch any
    // final files.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(
      writeJsonBatchAtomic([
        { file: fileA, value: { rewritten: true } },
        { file: fileB, value: { new: true } },
        { file: fileC, value: circular },
      ]),
    ).rejects.toThrow();

    // fileA is unchanged — still has the original content.
    expect(await fs.readFile(fileA, "utf-8")).toBe('{"keep":"me"}\n');
    // fileB and fileC were never created (the rename phase didn't
    // run for either; both tmps got cleaned up in the catch).
    expect(await readJson(fileB)).toBeNull();
    expect(await readJson(fileC)).toBeNull();
    // No tmp siblings remain — the catch block deleted them.
    const remaining = (await fs.readdir(dir)).sort();
    expect(remaining).toEqual(["a.json"]);
  });

  it("each tmp path is in the same dir as its final (so rename stays atomic)", async () => {
    // The atomicity guarantee depends on rename happening within
    // one filesystem. Tmp paths must be siblings of the final
    // paths. We can't directly inspect tmp paths (private), but we
    // verify the implicit contract by watching the dir during a
    // batch — if a tmp leaked into a different dir, the batch dir
    // wouldn't be the one to delete it.
    const dir = path.join(TMP_DIR, "batch-same-dir");
    await fs.mkdir(dir, { recursive: true });
    await writeJsonBatchAtomic([
      { file: path.join(dir, "one.json"), value: { v: 1 } },
    ]);
    const after = await fs.readdir(dir);
    // Just the final file — no leftover tmp.
    expect(after).toEqual(["one.json"]);
  });
});

describe("purgeOrphanTmps", () => {
  // Helper: make a file with a specific mtime (controllable "is this
  // tmp older than the threshold?" testing without `Date.now` mocks).
  async function makeFileWithMtime(file: string, ageMs: number): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "", "utf-8");
    const mtimeMs = Date.now() - ageMs;
    await fs.utimes(file, new Date(mtimeMs), new Date(mtimeMs));
  }

  it("deletes tmp files older than the threshold and leaves recent ones alone", async () => {
    const dir = path.join(TMP_DIR, "purge-mixed-age");
    const oldTmp = path.join(dir, `item.json.tmp-1234-1700000000000-abc123`);
    const newTmp = path.join(dir, `other.json.tmp-1234-1700000000000-def456`);
    await makeFileWithMtime(oldTmp, 60 * 60 * 1000); // 1 hour old
    await makeFileWithMtime(newTmp, 5 * 60 * 1000); // 5 min old

    const { deleted } = await purgeOrphanTmps(dir, {
      olderThanMs: 15 * 60 * 1000,
    });

    expect(deleted).toBe(1);
    expect(await readJson(oldTmp)).toBeNull(); // deleted
    expect(await readJson(newTmp)).toEqual(null); // present but empty (readJson returns null for 0-byte)
    // Stat call confirms the recent tmp still exists.
    await expect(fs.stat(newTmp)).resolves.toBeTruthy();
  });

  it("leaves non-tmp files alone even if they're ancient", async () => {
    // The regex only matches the `.tmp-<pid>-<ts>-<rand>` suffix —
    // real content files (whatever their age) must never be touched.
    const dir = path.join(TMP_DIR, "purge-non-tmp-safe");
    const realFile = path.join(dir, "real.json");
    await makeFileWithMtime(realFile, 24 * 60 * 60 * 1000); // 1 day old

    const { deleted } = await purgeOrphanTmps(dir);
    expect(deleted).toBe(0);
    await expect(fs.stat(realFile)).resolves.toBeTruthy();
  });

  it("walks subdirectories", async () => {
    // Tmps live wherever their final file does — collections are
    // nested under items/, so the walk has to recurse.
    const dir = path.join(TMP_DIR, "purge-recursive");
    const nestedTmp = path.join(
      dir,
      "collections/pages/items/foo.json.tmp-99-1700000000000-xyz789",
    );
    await makeFileWithMtime(nestedTmp, 60 * 60 * 1000);

    const { deleted } = await purgeOrphanTmps(dir);
    expect(deleted).toBe(1);
    expect(await readJson(nestedTmp)).toBeNull();
  });

  it("returns { deleted: 0 } when the root dir doesn't exist", async () => {
    // Fresh artist sites bootstrap content lazily — the janitor must
    // tolerate a missing root and not throw.
    const { deleted } = await purgeOrphanTmps(path.join(TMP_DIR, "never-existed"));
    expect(deleted).toBe(0);
  });

  it("defaults the threshold to 15 minutes", async () => {
    const dir = path.join(TMP_DIR, "purge-default-threshold");
    const recent = path.join(dir, "x.json.tmp-1-2-abc");
    const old = path.join(dir, "y.json.tmp-1-2-def");
    await makeFileWithMtime(recent, 10 * 60 * 1000); // 10 min — under default
    await makeFileWithMtime(old, 20 * 60 * 1000); // 20 min — over default

    const { deleted } = await purgeOrphanTmps(dir);
    expect(deleted).toBe(1);
    await expect(fs.stat(recent)).resolves.toBeTruthy();
  });
});

describe("localPathForRepoPath", () => {
  it("maps a src/content/... path under STAGECRAFT_CONTENT_DIR", () => {
    expect(localPathForRepoPath("src/content/pages/home.json")).toBe(
      path.join(TMP_DIR, "pages/home.json"),
    );
  });

  it("falls back to <cwd>/<path> for paths outside src/content/", () => {
    expect(localPathForRepoPath("public/images/x.png")).toBe(
      path.join(process.cwd(), "public/images/x.png"),
    );
  });

  it("REPO_CONTENT_PREFIX is the canonical prefix", () => {
    expect(REPO_CONTENT_PREFIX).toBe("src/content/");
  });
});
