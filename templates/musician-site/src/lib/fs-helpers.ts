/**
 * Filesystem helpers shared by every content-store layer (pages,
 * singletons, collections) and the publish flow.
 *
 *   - `contentDir()` resolves the content root, honouring the
 *     `STAGECRAFT_CONTENT_DIR` env override so parallel test files can
 *     isolate per-worker tmpdirs.
 *   - `localPathForRepoPath()` is the canonical "repo path →
 *     local filesystem path" conversion. Stores and the publish flow
 *     share it so write paths stay consistent across both paths.
 *   - `readJson` returns `null` on ENOENT (not throws) so callers can
 *     fall back to defaults without try/catch around every read.
 *   - `stringifyContent` is the canonical serializer (2-space indent +
 *     trailing newline) so re-saves produce minimal diffs.
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Every repo-relative path we write today lives under this prefix
 * (pages, singletons, collections). Files outside `src/content/` are
 * mapped relative to the repo root — kept open for future targets
 * like committed image variants under `public/`.
 */
export const REPO_CONTENT_PREFIX = "src/content/";

export function contentDir(): string {
  return process.env.STAGECRAFT_CONTENT_DIR ?? path.join(process.cwd(), "src/content");
}

/**
 * Map a `src/content/...` repo path to its local filesystem path,
 * honouring `STAGECRAFT_CONTENT_DIR`. The publish flow and the
 * filesystem stores both go through here so a single source dictates
 * where content lives on disk.
 */
export function localPathForRepoPath(repoPath: string): string {
  if (repoPath.startsWith(REPO_CONTENT_PREFIX)) {
    return path.join(contentDir(), repoPath.slice(REPO_CONTENT_PREFIX.length));
  }
  return path.join(process.cwd(), repoPath);
}

export function stringifyContent(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export function isNotFound(cause: unknown): boolean {
  return Boolean(
    cause &&
      typeof cause === "object" &&
      "code" in cause &&
      (cause as { code: string }).code === "ENOENT",
  );
}

export async function readJson<T>(file: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
  // A zero-byte file isn't a valid JSON payload but isn't worth crashing
  // the public renderer over either — treat it the same as missing and
  // let the caller fall back to its default. Persists across restarts of
  // a half-failed write.
  if (raw.trim().length === 0) return null;
  return JSON.parse(raw) as T;
}

/**
 * Write a UTF-8 string to `file`, creating parent directories as
 * needed. The mkdir+writeFile pair is repeated across every store that
 * persists files; centralising avoids forgetting one.
 */
export async function writeText(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf-8");
}

/**
 * Write `value` to `file` with canonical JSON formatting. Equivalent to
 * `writeText(file, stringifyContent(value))`; preferred over the raw
 * pair so re-saves keep diffing minimally.
 *
 * Prefer `writeJsonAtomic` for content writes — `writeJson` doesn't
 * protect against torn writes if the process crashes mid-write.
 * `writeJson` stays exported for the rare callers that need bare-
 * write semantics (test fixtures, the bootstrap path).
 */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeText(file, stringifyContent(value));
}

/**
 * Atomic single-file write: write to a tmp sibling, then `rename` it
 * into place. POSIX rename is atomic for files within the same
 * filesystem, so a reader either sees the old contents or the fully-
 * written new contents — never a half-written file.
 *
 * Catches:
 *   - Process crash mid-write (the tmp file is incomplete; the
 *     final file is untouched).
 *   - Disk-full during write (the tmp write throws; the final file
 *     is untouched).
 *   - Stringify failures (the content is written to tmp first; if
 *     it threw we'd never reach the rename).
 *
 * Does NOT catch:
 *   - A crash between rename steps in a multi-file batch — see
 *     `writeJsonBatchAtomic` for the batched variant with phase-1
 *     protection.
 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = tmpPathFor(file);
  await writeText(tmp, stringifyContent(value));
  try {
    await fs.rename(tmp, file);
  } catch (cause) {
    // Rename failed — try to clean up the tmp file so it doesn't
    // accumulate. Swallow cleanup errors so the caller sees the
    // original rename error.
    await unlinkIfExists(tmp).catch(() => {});
    throw cause;
  }
}

/**
 * Multi-file atomic-ish write. Two phases:
 *
 *   1. Write every entry to a tmp sibling. If any phase-1 write
 *      throws, clean up the tmp files written so far and re-throw.
 *      No final files have been touched at this point.
 *   2. Rename each tmp into place. Per-file atomic, but NOT
 *      all-or-nothing as a group — a crash mid-phase-2 leaves some
 *      files new and some old. We accept this limit because true
 *      transactional cross-file atomicity needs a journal /
 *      WAL-style log; for the schema-save batch (one def +
 *      typically <100 migrated items) the phase-2 window is
 *      sub-second and a meaningful improvement over the previous
 *      non-atomic loop.
 *
 * Used by the schema-save endpoint to commit the new
 * `_collection.json` + any per-item migrations as a unit. A
 * mid-batch failure during phase 1 (the common failure mode —
 * disk full, stringify error, validation slip) leaves the previous
 * state intact.
 */
export async function writeJsonBatchAtomic(
  writes: ReadonlyArray<{ file: string; value: unknown }>,
): Promise<void> {
  const staged: Array<{ tmp: string; final: string }> = [];
  try {
    for (const w of writes) {
      const tmp = tmpPathFor(w.file);
      await writeText(tmp, stringifyContent(w.value));
      staged.push({ tmp, final: w.file });
    }
  } catch (cause) {
    // Phase-1 failure: roll back by deleting any tmp files written
    // so far. None of the final files have been touched.
    await Promise.all(staged.map((s) => unlinkIfExists(s.tmp).catch(() => {})));
    throw cause;
  }
  for (const s of staged) {
    await fs.rename(s.tmp, s.final);
  }
}

/**
 * Sibling tmp path used by the atomic helpers. Same directory so
 * `rename` stays within one filesystem (the atomicity guarantee
 * doesn't cross mount points). PID + timestamp + random suffix so
 * concurrent writers don't collide on the tmp filename.
 */
function tmpPathFor(file: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${file}.tmp-${process.pid}-${Date.now()}-${random}`;
}

/** Matches the tmp suffix `tmpPathFor` produces. Exported only so the
 * janitor below can recognise its own droppings. */
const TMP_SUFFIX_PATTERN = /\.tmp-\d+-\d+-[a-z0-9]+$/;

/**
 * Walk `rootDir` recursively and delete any `<file>.tmp-...` artifact
 * older than `olderThanMs` (default 15 minutes). Cleans up orphan tmp
 * files that the atomic helpers couldn't remove because the process
 * was hard-killed (OOM, SIGKILL, host reboot) — the in-process
 * catch blocks rely on JS-level throws and can't run during a crash.
 *
 * Called once per process from the content-bootstrap path, so an
 * artist site that crashed mid-write self-heals on the next boot.
 *
 * Threshold is deliberately conservative: an in-flight write that's
 * been going for >15 minutes is almost certainly orphaned, but
 * within that window we leave tmps alone so a long write isn't
 * sniped by a concurrent janitor pass.
 */
export async function purgeOrphanTmps(
  rootDir: string,
  options: { olderThanMs?: number } = {},
): Promise<{ deleted: number }> {
  const threshold = Date.now() - (options.olderThanMs ?? 15 * 60 * 1000);
  let deleted = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (cause) {
      // ENOENT — directory doesn't exist; nothing to clean.
      if (isNotFound(cause)) return;
      throw cause;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!TMP_SUFFIX_PATTERN.test(entry.name)) continue;
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs < threshold) {
          await unlinkIfExists(full);
          deleted++;
        }
      } catch (cause) {
        // Stat / unlink race with another process — silently move on.
        if (isNotFound(cause)) continue;
        throw cause;
      }
    }
  }
  await walk(rootDir);
  return { deleted };
}

/**
 * `unlink` that swallows ENOENT — useful when the caller's intent is
 * "make sure this file is gone" rather than "delete this specific file
 * that I know is there." The store layers all delete this way.
 */
export async function unlinkIfExists(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
  }
}

/**
 * Read a directory and return the values from `pick` that aren't null.
 * Treats ENOENT as an empty directory so callers don't branch on
 * "directory might not exist yet." Result is sorted alphabetically.
 *
 * Used to enumerate collections, items, etc. — wherever the pattern is
 * "list directory entries that match a slug shape."
 */
export async function readdirFiltered<T extends string>(
  dir: string,
  pick: (entry: import("node:fs").Dirent) => T | null,
): Promise<T[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if (isNotFound(cause)) return [];
    throw cause;
  }
  const out: T[] = [];
  for (const entry of entries) {
    const value = pick(entry);
    if (value !== null) out.push(value);
  }
  return out.sort();
}
