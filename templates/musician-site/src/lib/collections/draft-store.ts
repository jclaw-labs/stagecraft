/**
 * GitHub-backed read layer for the `draft` branch (ADR-010 §5).
 *
 * Background: in production (serverless), the admin's filesystem is
 * whatever `main` was at build time — read-only and a snapshot. After
 * an artist saves to `draft`, a different serverless container can
 * still serve admin reads from the old main snapshot, silently showing
 * stale state until the next deploy. This module is the parallel read
 * path that fetches from `draft` over GitHub's Contents API so admin
 * reads see the live pending state regardless of container lifecycle.
 *
 * What's in this PR: the module + its per-process cache + tests.
 * Callers (the admin server components) aren't migrated yet — that's
 * the next slice. The seam is `getReadStore()`-shaped at a higher
 * level once a caller wants to switch.
 *
 * **Cache.** Per-process `Map<branchKey, { sha, entries }>`. On each
 * fetch:
 *   1. Cheap `getRef(heads/<branch>)` → current SHA.
 *   2. If different from the cached SHA, drop the branch's entries.
 *   3. If the path is in entries, serve from cache.
 *   4. Otherwise fetch from GitHub, cache, return.
 *
 * Branch SHAs are stable across reads of the same tree, so once a
 * collection is warm, only the cheap SHA check fires until the artist
 * saves again. After a save, the branch SHA changes → entries drop →
 * next read repopulates lazily.
 *
 * **Errors.** 404 on a path is "not present" — returned as `null` /
 * empty array, same as the FS layer. Other errors (rate limit,
 * outage) bubble; the caller decides whether to surface as a 5xx or
 * degrade to the baked-in FS snapshot.
 */

import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

import {
  buildItemFileSchema,
  collectionDefSchema,
  orderFileSchema,
  slugSchema,
  ORDER_FILE_NAME,
  SINGLETON_ITEM_SLUG,
  type CollectionDef,
  type Item,
  type ItemFile,
} from "./schema";
import {
  collectionDefRepoPath,
  itemRepoPath,
  orderRepoPath,
} from "./store";

// ---------------------------------------------------------------------------
// Context + cache
// ---------------------------------------------------------------------------

export type DraftStoreContext = {
  /** GitHub installation token. */
  token: string;
  owner: string;
  repo: string;
  /** Source branch — typically `draft`. */
  branch: string;
};

type Entry = unknown; // parsed JSON object or string[] for dir listings
type BranchCache = { sha: string; entries: Map<string, Entry> };

const caches = new Map<string, BranchCache>();

function cacheKey(ctx: DraftStoreContext): string {
  return `${ctx.owner}/${ctx.repo}@${ctx.branch}`;
}

/**
 * Drop every cached entry. Tests call this between cases; production
 * code never needs to — the SHA-based invalidation handles staleness.
 */
export function resetDraftStoreCache(): void {
  caches.clear();
}

// ---------------------------------------------------------------------------
// Core fetch — checks SHA, hits cache, falls back to GitHub
// ---------------------------------------------------------------------------

/**
 * Get-or-fetch one path's contents. Returns whatever the fetcher
 * yielded (object for `getContent` files, array for directory
 * listings, null for 404s). Callers wrap the typed parse on top.
 */
async function fetchCached<T>(
  ctx: DraftStoreContext,
  path: string,
  fetcher: (octokit: Octokit) => Promise<T>,
): Promise<T> {
  const octokit = new Octokit({ auth: ctx.token });

  // Get the current branch SHA. If the cache is fresh (same SHA),
  // serve from it. If stale (SHA changed), drop the branch's entries
  // and refetch.
  const ref = await octokit.git.getRef({
    owner: ctx.owner,
    repo: ctx.repo,
    ref: `heads/${ctx.branch}`,
  });
  const headSha = ref.data.object.sha;

  const key = cacheKey(ctx);
  let cache = caches.get(key);
  if (!cache || cache.sha !== headSha) {
    cache = { sha: headSha, entries: new Map() };
    caches.set(key, cache);
  }

  if (cache.entries.has(path)) {
    return cache.entries.get(path) as T;
  }

  const value = await fetcher(octokit);
  cache.entries.set(path, value);
  return value;
}

/**
 * Wrap a getContent call: return the decoded JSON object, or `null`
 * if the path doesn't exist on the branch. Other errors bubble.
 */
async function getJsonFile<T>(
  ctx: DraftStoreContext,
  path: string,
): Promise<T | null> {
  return fetchCached(ctx, path, async (octokit) => {
    try {
      const res = await octokit.repos.getContent({
        owner: ctx.owner,
        repo: ctx.repo,
        path,
        ref: ctx.branch,
      });
      // For files, getContent returns a single object with
      // `type: "file"` and base64-encoded content. Arrays mean we
      // accidentally hit a directory.
      const data = res.data;
      if (Array.isArray(data) || data.type !== "file") {
        throw new Error(
          `draft-store: getContent("${path}") returned non-file shape`,
        );
      }
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return JSON.parse(content) as T;
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 404) {
        return null;
      }
      throw cause;
    }
  });
}

/**
 * Wrap a getContent call on a directory: return the names of every
 * `.json` file whose slug matches `slugSchema`. Returns an empty
 * array when the directory doesn't exist.
 */
async function listDirSlugs(
  ctx: DraftStoreContext,
  path: string,
): Promise<string[]> {
  const cached = await fetchCached<string[] | null>(ctx, `${path}/`, async (octokit) => {
    try {
      const res = await octokit.repos.getContent({
        owner: ctx.owner,
        repo: ctx.repo,
        path,
        ref: ctx.branch,
      });
      if (!Array.isArray(res.data)) {
        // The path exists but isn't a directory. Treat as empty.
        return [];
      }
      const slugs: string[] = [];
      for (const entry of res.data) {
        if (entry.type !== "file") continue;
        if (!entry.name.endsWith(".json")) continue;
        const slug = entry.name.replace(/\.json$/, "");
        if (slugSchema.safeParse(slug).success) slugs.push(slug);
      }
      slugs.sort();
      return slugs;
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 404) {
        return null;
      }
      throw cause;
    }
  });
  return cached ?? [];
}

// ---------------------------------------------------------------------------
// Typed reads — mirror the store.ts API one-to-one
// ---------------------------------------------------------------------------

export async function readCollectionDefFromDraft(
  ctx: DraftStoreContext,
  collectionSlug: string,
): Promise<CollectionDef | null> {
  slugSchema.parse(collectionSlug);
  const raw = await getJsonFile<unknown>(ctx, collectionDefRepoPath(collectionSlug));
  return raw === null ? null : collectionDefSchema.parse(raw);
}

export async function readItemFromDraft(
  ctx: DraftStoreContext,
  collectionSlug: string,
  itemSlug: string,
  def: CollectionDef,
): Promise<Item | null> {
  slugSchema.parse(collectionSlug);
  const raw = await getJsonFile<unknown>(ctx, itemRepoPath(collectionSlug, itemSlug));
  if (raw === null) return null;
  const file = buildItemFileSchema(def.fields).parse(raw);
  return { ...file, slug: itemSlug };
}

export async function readSingletonFromDraft(
  ctx: DraftStoreContext,
  collectionSlug: string,
  def: CollectionDef,
): Promise<Item | null> {
  return readItemFromDraft(ctx, collectionSlug, SINGLETON_ITEM_SLUG, def);
}

export async function listItemSlugsFromDraft(
  ctx: DraftStoreContext,
  collectionSlug: string,
): Promise<string[]> {
  slugSchema.parse(collectionSlug);
  // The directory is at `items/`; listDirSlugs handles missing dirs
  // (fresh collection without items yet) as an empty array.
  return listDirSlugs(ctx, `src/content/collections/${collectionSlug}/items`);
}

export async function listItemsInOrderFromDraft(
  ctx: DraftStoreContext,
  collectionSlug: string,
  def: CollectionDef,
): Promise<Item[]> {
  const slugs = await listItemSlugsFromDraft(ctx, collectionSlug);
  const fileSchema = buildItemFileSchema(def.fields);
  const items = (
    await Promise.all(
      slugs.map(async (slug) => {
        const raw = await getJsonFile<unknown>(ctx, itemRepoPath(collectionSlug, slug));
        if (raw === null) return null;
        const file = fileSchema.parse(raw) as ItemFile;
        const item: Item = { ...file, slug };
        return item;
      }),
    )
  ).filter((item): item is Item => item !== null);

  // For listing order, fall back to slug order. The full
  // _order.json / fieldSort handling lives in store.ts's
  // listItemsInOrder and gets ported separately when callers
  // need it — listItemSlugsFromDraft already returns slugs sorted
  // alphabetically, which matches store.ts's "no defaultSort"
  // case.
  return items;
}

export async function readOrderFromDraft(
  ctx: DraftStoreContext,
  collectionSlug: string,
): Promise<string[] | null> {
  slugSchema.parse(collectionSlug);
  const raw = await getJsonFile<unknown>(ctx, orderRepoPath(collectionSlug));
  return raw === null ? null : orderFileSchema.parse(raw);
}

export async function listCollectionSlugsFromDraft(
  ctx: DraftStoreContext,
): Promise<string[]> {
  const cached = await fetchCached<string[] | null>(
    ctx,
    "src/content/collections/",
    async (octokit) => {
      try {
        const res = await octokit.repos.getContent({
          owner: ctx.owner,
          repo: ctx.repo,
          path: "src/content/collections",
          ref: ctx.branch,
        });
        if (!Array.isArray(res.data)) return [];
        const slugs: string[] = [];
        for (const entry of res.data) {
          if (entry.type !== "dir") continue;
          if (slugSchema.safeParse(entry.name).success) slugs.push(entry.name);
        }
        slugs.sort();
        return slugs;
      } catch (cause) {
        if (cause instanceof RequestError && cause.status === 404) return null;
        throw cause;
      }
    },
  );
  return cached ?? [];
}

// Suppress unused-import warning if a downstream caller doesn't need
// `ORDER_FILE_NAME` — it's re-exported only for symmetry with store.ts.
void ORDER_FILE_NAME;
