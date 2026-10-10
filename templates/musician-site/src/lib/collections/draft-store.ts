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
 * **Cache.** Per-process `Map<branchKey, { sha, entries }>` where
 * entries hold the in-flight `Promise` (not the resolved value) keyed
 * by path. Two concurrent reads of the same path at the same SHA see
 * the same promise — only one GitHub call fires. On each fetch:
 *   1. Cheap `getRef(heads/<branch>)` → current SHA.
 *   2. If different from the cached SHA, drop the branch's entries.
 *   3. If the path is in entries, await the cached promise.
 *   4. Otherwise install a new promise and await it; cache result.
 *
 * Branch SHAs are stable across reads of the same tree, so once a
 * collection is warm, only the cheap SHA check fires until the artist
 * saves again. List operations amortise: `listItemsInOrderFromDraft`
 * fetches the SHA once and threads it through every per-item read,
 * avoiding N+1 `getRef` calls.
 *
 * **Errors.** 404 on a path is "not present" — returned as `null` /
 * empty array, same as the FS layer. Other errors get wrapped in
 * `DraftReadError` with a discriminated `code` so the facade can
 * decide whether to surface 5xx or degrade to the baked-in FS
 * snapshot. Branch-missing (404 on `getRef`) is its own code, since
 * a fresh site without a `draft` branch yet is a legitimate empty
 * state, not an outage.
 *
 * **Server-only.** Imports `@octokit/rest` and uses the `Buffer` Node
 * global, so any attempt to import this from a `"use client"`
 * component fails at build time. Sibling client-safe modules
 * (`filter-schema.ts`, `field-classification.ts`, etc.) exist for
 * the types/values shared with the editor surface.
 */

import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

import {
  buildItemFileSchema,
  collectionDefSchema,
  orderFileSchema,
  slugSchema,
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
import { sortByField, sortByManualOrder } from "./sort-key";

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

/**
 * Typed errors so the facade can pattern-match on cause rather than
 * `RequestError.status`. Mirrors `PublishError` in `publish.ts`.
 */
export class DraftReadError extends Error {
  constructor(
    public code:
      | "branch-missing"
      | "rate-limited"
      | "auth-failed"
      | "github-unreachable"
      | "github-failed",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "DraftReadError";
  }
}

function wrapRequestError(cause: unknown, context: string): DraftReadError {
  if (!(cause instanceof RequestError)) {
    return new DraftReadError("github-unreachable", `${context}: ${String(cause)}`, cause);
  }
  if (cause.status === 401 || cause.status === 403) {
    return new DraftReadError("auth-failed", `${context}: ${cause.message}`, cause);
  }
  if (cause.status === 429 || cause.message.toLowerCase().includes("rate limit")) {
    return new DraftReadError("rate-limited", `${context}: ${cause.message}`, cause);
  }
  return new DraftReadError("github-failed", `${context}: ${cause.message}`, cause);
}

// In-flight promises keyed by path. Caching the promise (not the
// resolved value) lets concurrent readers of the same path at the
// same SHA share one GitHub call without a race-to-install-cache
// foot-gun.
type BranchCache = { sha: string; entries: Map<string, Promise<unknown>> };

const caches = new Map<string, BranchCache>();
const octokits = new Map<string, Octokit>();

function cacheKey(ctx: DraftStoreContext): string {
  return `${ctx.owner}/${ctx.repo}@${ctx.branch}`;
}

function getOctokit(token: string): Octokit {
  // Reuse one Octokit per token so its connection pool + throttle
  // plugin state survives across calls. A per-call `new Octokit()`
  // defeats both. Bounded by the number of distinct tokens the
  // container ever sees, which is 1 in practice (the per-site
  // broker-minted installation token).
  let octokit = octokits.get(token);
  if (!octokit) {
    octokit = new Octokit({ auth: token });
    octokits.set(token, octokit);
  }
  return octokit;
}

/**
 * Drop every cached entry. Tests call this between cases; production
 * code never needs to — the SHA-based invalidation handles staleness.
 */
export function resetDraftStoreCache(): void {
  caches.clear();
  octokits.clear();
}

// ---------------------------------------------------------------------------
// Core fetch — checks SHA, hits cache, falls back to GitHub
// ---------------------------------------------------------------------------

/**
 * Resolve the current head SHA for `ctx.branch`. Wrapped errors
 * include a `branch-missing` code when the branch itself 404s
 * (fresh site without a draft branch — legit empty state, not an
 * outage).
 */
async function resolveHeadSha(ctx: DraftStoreContext): Promise<string> {
  const octokit = getOctokit(ctx.token);
  try {
    const ref = await octokit.git.getRef({
      owner: ctx.owner,
      repo: ctx.repo,
      ref: `heads/${ctx.branch}`,
    });
    return ref.data.object.sha;
  } catch (cause) {
    if (cause instanceof RequestError && cause.status === 404) {
      throw new DraftReadError(
        "branch-missing",
        `draft-store: branch "${ctx.branch}" does not exist on ${ctx.owner}/${ctx.repo}`,
        cause,
      );
    }
    throw wrapRequestError(cause, "draft-store: getRef");
  }
}

/**
 * Look up or install the per-branch cache pinned to `headSha`. If the
 * stored SHA differs (branch has moved), drops the prior entries.
 */
function getBranchCache(ctx: DraftStoreContext, headSha: string): BranchCache {
  const key = cacheKey(ctx);
  let cache = caches.get(key);
  if (!cache || cache.sha !== headSha) {
    cache = { sha: headSha, entries: new Map() };
    caches.set(key, cache);
  }
  return cache;
}

/**
 * Get-or-fetch one path's contents at a pinned SHA. Returns whatever
 * the fetcher yielded (object for `getContent` files, array for dir
 * listings, null for 404s). Cache holds the promise so two concurrent
 * callers at the same SHA + path share one network call.
 *
 * Pass `headSha` to amortise the `getRef` across a list/batch
 * operation; pass `undefined` (or call `fetchCached`) to do the
 * cheap `getRef` per call.
 */
async function fetchCachedAtSha<T>(
  ctx: DraftStoreContext,
  headSha: string,
  path: string,
  fetcher: (octokit: Octokit) => Promise<T>,
): Promise<T> {
  const cache = getBranchCache(ctx, headSha);
  const existing = cache.entries.get(path);
  if (existing) {
    return (await existing) as T;
  }
  // Install the promise BEFORE awaiting so a parallel call hits the
  // cache mid-flight. `getOctokit` is sync, the fetcher does the
  // I/O. If the fetcher rejects, drop the failed promise so a
  // retry isn't stuck on a stale rejection.
  const octokit = getOctokit(ctx.token);
  const promise = fetcher(octokit);
  cache.entries.set(path, promise);
  try {
    return await promise;
  } catch (err) {
    if (cache.entries.get(path) === promise) cache.entries.delete(path);
    throw err;
  }
}

/**
 * Public-facing single-path fetch: resolve the SHA then delegate.
 * Used by individual reads (read*FromDraft); list operations pin the
 * SHA once and pass it explicitly.
 */
async function fetchCached<T>(
  ctx: DraftStoreContext,
  path: string,
  fetcher: (octokit: Octokit) => Promise<T>,
): Promise<T> {
  const headSha = await resolveHeadSha(ctx);
  return fetchCachedAtSha(ctx, headSha, path, fetcher);
}

/**
 * Wrap a getContent call: return the decoded JSON object, or `null`
 * if the path doesn't exist on the branch. Files over GitHub's
 * Contents API size limit (~1 MB) come back with `encoding: "none"`
 * and an empty content string; those are re-read through the Git
 * Blob API by the SHA the Contents response carries (see
 * `readBlobUtf8`), so an oversized file is read live from the draft
 * rather than from the stale build snapshot.
 */
async function getJsonFileAtSha<T>(
  ctx: DraftStoreContext,
  headSha: string,
  path: string,
): Promise<T | null> {
  return fetchCachedAtSha(ctx, headSha, path, async (octokit) => {
    try {
      const res = await octokit.repos.getContent({
        owner: ctx.owner,
        repo: ctx.repo,
        path,
        ref: ctx.branch,
      });
      const data = res.data;
      if (Array.isArray(data) || data.type !== "file") {
        throw new DraftReadError(
          "github-failed",
          `draft-store: getContent("${path}") returned non-file shape "${
            Array.isArray(data) ? "array" : data.type
          }"`,
        );
      }
      // Above ~1 MB GitHub returns `encoding: "none"` with empty
      // content and expects the caller to switch to the Git Blob
      // API, which serves blobs up to 100 MB. The Contents response
      // still carries the blob SHA, so one extra call reads it.
      const content =
        data.encoding === "base64"
          ? Buffer.from(data.content, "base64").toString("utf-8")
          : await readBlobUtf8(octokit, ctx, path, data.sha);
      return JSON.parse(content) as T;
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 404) {
        return null;
      }
      if (cause instanceof DraftReadError) throw cause;
      throw wrapRequestError(cause, `draft-store: getContent("${path}")`);
    }
  });
}

/**
 * Read one blob through the Git Blob API
 * (`GET /repos/{owner}/{repo}/git/blobs/{sha}`) and decode it as UTF-8.
 * Used for files past the Contents API's ~1 MB limit.
 *
 * Errors are wrapped into `DraftReadError` here rather than left to the
 * caller's catch: that catch maps a bare 404 to "file absent", and a
 * 404 on a blob SHA GitHub just handed us is a GitHub-side failure, not
 * a deletion.
 */
async function readBlobUtf8(
  octokit: Octokit,
  ctx: DraftStoreContext,
  path: string,
  blobSha: string,
): Promise<string> {
  const context = `draft-store: getBlob("${path}", ${blobSha})`;
  let blob: Awaited<ReturnType<Octokit["git"]["getBlob"]>>;
  try {
    blob = await octokit.git.getBlob({
      owner: ctx.owner,
      repo: ctx.repo,
      file_sha: blobSha,
    });
  } catch (cause) {
    throw wrapRequestError(cause, context);
  }
  const { content, encoding } = blob.data;
  if (encoding === "base64") return Buffer.from(content, "base64").toString("utf-8");
  if (encoding === "utf-8") return content;
  throw new DraftReadError("github-failed", `${context}: unexpected encoding "${encoding}"`);
}

async function getJsonFile<T>(
  ctx: DraftStoreContext,
  path: string,
): Promise<T | null> {
  const headSha = await resolveHeadSha(ctx);
  return getJsonFileAtSha<T>(ctx, headSha, path);
}

/**
 * Wrap a getContent call on a directory: return the names of every
 * `.json` file whose slug matches `slugSchema`. Returns an empty
 * array when the directory doesn't exist.
 */
async function listDirSlugsAtSha(
  ctx: DraftStoreContext,
  headSha: string,
  path: string,
): Promise<string[]> {
  const cached = await fetchCachedAtSha<string[] | null>(
    ctx,
    headSha,
    `${path}/`,
    async (octokit) => {
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
        throw wrapRequestError(cause, `draft-store: list("${path}")`);
      }
    },
  );
  return cached ?? [];
}

async function listDirSlugs(
  ctx: DraftStoreContext,
  path: string,
): Promise<string[]> {
  const headSha = await resolveHeadSha(ctx);
  return listDirSlugsAtSha(ctx, headSha, path);
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
  // Amortise the SHA fetch: one getRef for the whole list operation,
  // pinned through every per-item read (and the _order.json read on
  // the manual path). Without this, listing N items costs N+1 getRef
  // calls (~50ms each — 25s for 500 items).
  const headSha = await resolveHeadSha(ctx);
  const slugs = await listDirSlugsAtSha(
    ctx,
    headSha,
    `src/content/collections/${collectionSlug}/items`,
  );
  const fileSchema = buildItemFileSchema(def.fields);
  const items = (
    await Promise.all(
      slugs.map(async (slug) => {
        const raw = await getJsonFileAtSha<unknown>(
          ctx,
          headSha,
          itemRepoPath(collectionSlug, slug),
        );
        if (raw === null) return null;
        const file = fileSchema.parse(raw) as ItemFile;
        const item: Item = { ...file, slug };
        return item;
      }),
    )
  ).filter((item): item is Item => item !== null);

  // Match store.ts's defaultSort semantics. The sort helpers
  // (`sortByManualOrder` / `sortByField`) live in `sort-key.ts`
  // alongside `compareItemsByField` — filesystem-agnostic and shared
  // between both stores.
  if (def.defaultSort?.mode === "manual") {
    const rawOrder = await getJsonFileAtSha<unknown>(
      ctx,
      headSha,
      orderRepoPath(collectionSlug),
    );
    let order: string[] | null = null;
    if (rawOrder !== null) {
      // Wrap the parse so a malformed `_order.json` surfaces as a typed
      // DraftReadError the facade can pattern-match on (same contract
      // as the other GitHub-fetched errors in this module).
      try {
        order = orderFileSchema.parse(rawOrder);
      } catch (cause) {
        throw new DraftReadError(
          "github-failed",
          `draft-store: malformed _order.json in "${collectionSlug}"`,
          cause,
        );
      }
    }
    return sortByManualOrder(items, order);
  }
  if (def.defaultSort?.mode === "fieldSort") {
    return sortByField(items, def.defaultSort.fieldId, def.defaultSort.direction);
  }
  // `defaultSort: null` → alphabetic. `listDirSlugsAtSha` returns
  // slugs sorted, and we walk them in order, so the resulting
  // `items` array is already in slug order. No re-sort needed.
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
        throw wrapRequestError(cause, "draft-store: list(collections)");
      }
    },
  );
  return cached ?? [];
}
