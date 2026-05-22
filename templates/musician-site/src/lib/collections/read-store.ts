/**
 * Per-request read facade — ADR-010 §5.
 *
 * In production (platform configured), admin reads need to see the
 * live `draft` branch state regardless of which serverless container
 * handles the request. The deployed snapshot of `main` lags whatever
 * an artist just saved through `publish.ts`. This facade lets every
 * admin reader call one API (`getReadStore()`) and transparently:
 *
 *   - **dev / unconfigured** → return a FS-backed store (`./store`).
 *     `npm run dev` keeps the existing happy path; no GitHub round-
 *     trip, no broker token mint.
 *
 *   - **production** → mint a per-request draft token via the broker,
 *     return a `draft-store`-backed store that fetches from GitHub.
 *     Wrapped with a graceful FS fallback on the recoverable
 *     `DraftReadError` codes (`branch-missing`, `github-unreachable`,
 *     `rate-limited`). The FS snapshot is the build-time checkout of
 *     `main` — stale by design, but better than a 5xx during a
 *     transient outage.
 *
 *   - **broker unreachable at token-mint time** → fall back to FS
 *     entirely for this request. Next request retries the broker.
 *
 * Non-recoverable codes (`auth-failed`, `github-failed`) re-throw so
 * the route handler can surface a 5xx. Successful reads that return
 * `null` (file genuinely missing on `draft`) flow through unchanged
 * — fallback only fires on typed errors, never on absence. Masking
 * a deletion would be worse than seeing it. `too-large` is treated
 * as recoverable: the live draft has grown past the Contents-API
 * limit and we can't fetch it via this path, but the FS snapshot
 * has a (stale-but-parseable) copy. Better that than 5xx until a
 * Git-Blob-API fallback ships.
 *
 * Per-request lifecycle: prefer `getRequestReadStore()` over
 * `getReadStore()` for server-component / route-handler callers —
 * it wraps the async factory in `React.cache()` so multiple callers
 * within one request share one broker-minted token. Calling
 * `getReadStore()` directly from N components mints N tokens, which
 * pressures the platform broker. The underlying draft-store module-
 * level cache (`./draft-store`'s SHA-keyed promise map) handles
 * cross-call dedup within the container.
 *
 * Cache invalidation: ADR-010 §5 specifies "after any admin write,
 * the writer's process updates its own cache synchronously." This
 * facade doesn't expose an invalidation hook; instead, the SHA-
 * check-on-every-read in draft-store kicks in — the next read after
 * a write sees a new branch SHA and drops the prior cache entries.
 * One extra `getRef` of latency vs synchronous invalidation, but no
 * cross-module coupling between `publish.ts` and `draft-store.ts`.
 * Worth revisiting if the per-write `getRef` cost shows up in real
 * traffic profiles.
 *
 * Server-only. Imports `./store` (node:fs) and `./draft-store`
 * (@octokit/rest). Don't reach for this from a `"use client"` file.
 */

import { cache } from "react";

import { DraftReadError, type DraftStoreContext } from "./draft-store";
import * as draftStore from "./draft-store";
import * as fsStore from "./store";
import type { CollectionDef, Item } from "./schema";
import {
  DRAFT_BRANCH,
  fetchPublishToken,
  isPlatformConfigured,
  PublishError,
  readEnv,
} from "../publish";

export type ReadStoreMode = "fs" | "draft+fs-fallback";

/**
 * The unified read API every admin caller consumes. Mirrors the
 * read-side of `./store` one-to-one — methods, arg order, return
 * shapes. Migrating a caller from `./store` to this facade is a
 * one-line import change plus an `await getReadStore()` at the top.
 */
export interface ReadStore {
  readCollectionDef(slug: string): Promise<CollectionDef | null>;
  readItem(slug: string, itemSlug: string, def: CollectionDef): Promise<Item | null>;
  readSingleton(slug: string, def: CollectionDef): Promise<Item | null>;
  listItemSlugs(slug: string): Promise<string[]>;
  listItemsInOrder(slug: string, def: CollectionDef): Promise<Item[]>;
  readOrder(slug: string): Promise<string[] | null>;
  listCollectionSlugs(): Promise<string[]>;
  /** Which backend the store ended up using. Useful for logging / debugging. */
  readonly mode: ReadStoreMode;
}

/**
 * `DraftReadError` codes the facade treats as "transient, fall back
 * to the FS snapshot for this request." Non-listed codes
 * (`auth-failed`, `github-failed`) re-throw to the caller — those
 * are bugs or auth-state issues the operator needs to see.
 *
 * - `branch-missing`: fresh site without a `draft` branch yet. The
 *   FS snapshot is the truth in that case.
 * - `github-unreachable`: network blip or DNS issue. Fall back, log,
 *   recover on the next request.
 * - `rate-limited`: hammered the App's quota. Fall back rather than
 *   surface 5xx; the cache + amortisation in draft-store should
 *   normally keep us under, so hitting this is itself a signal.
 * - `too-large`: draft has a file past the Contents-API ~1 MB
 *   limit. We can't fetch the live version via the existing path,
 *   but the FS snapshot has a (stale-but-parseable) copy. Falling
 *   back keeps the admin usable until a Git-Blob-API fallback
 *   ships in `draft-store`.
 */
const RECOVERABLE_CODES: ReadonlySet<DraftReadError["code"]> = new Set([
  "branch-missing",
  "github-unreachable",
  "rate-limited",
  "too-large",
]);

function isRecoverable(err: unknown): err is DraftReadError {
  return err instanceof DraftReadError && RECOVERABLE_CODES.has(err.code);
}

/**
 * Build a read store for the current request. In dev / unconfigured
 * environments, returns a FS-only store immediately (no network).
 * In production, mints a draft token + returns a draft-backed store
 * with FS fallback wired in.
 *
 * Token-mint failures fall through to FS for this request — same
 * shape as a per-method `github-unreachable`. The next request will
 * retry the broker.
 */
export async function getReadStore(): Promise<ReadStore> {
  const env = readEnv();
  if (!isPlatformConfigured(env)) {
    return fsReadStore();
  }
  let ctx: DraftStoreContext;
  try {
    const { token, owner, repo } = await fetchPublishToken(env);
    ctx = { token, owner, repo, branch: DRAFT_BRANCH };
  } catch (cause) {
    // Fall back only on `broker-unreachable` (transient network /
    // platform outage). `broker-rejected` typically means the
    // platform returned 4xx — the per-site secret is wrong or the
    // siteId is unknown. Silently falling back there would mask a
    // permanent configuration error as a recoverable blip for the
    // life of the deployment; better to surface so the operator
    // notices. Programmer errors (unexpected throw shape) also
    // re-throw so they're visible.
    if (cause instanceof PublishError && cause.code === "broker-unreachable") {
      console.warn(
        `[read-store] Broker unreachable; falling back to FS snapshot for this request: ${cause.message}`,
      );
      return fsReadStore();
    }
    throw cause;
  }
  return draftReadStoreWithFallback(ctx);
}

/**
 * Per-request memoised wrapper around `getReadStore`. Use this from
 * server components and route handlers so multiple readers in the
 * same request share one broker-minted token. React's `cache()`
 * keys by argument list — `getRequestReadStore()` has no arguments,
 * so every call within one request returns the same promise.
 */
export const getRequestReadStore = cache(getReadStore);

/**
 * FS-only store. Just re-binds each method from `./store` so callers
 * can use the facade in dev without paying for a network round-trip.
 */
function fsReadStore(): ReadStore {
  return {
    mode: "fs",
    readCollectionDef: (slug) => fsStore.readCollectionDef(slug),
    readItem: (slug, itemSlug, def) => fsStore.readItem(slug, itemSlug, def),
    readSingleton: (slug, def) => fsStore.readSingleton(slug, def),
    listItemSlugs: (slug) => fsStore.listItemSlugs(slug),
    listItemsInOrder: (slug, def) => fsStore.listItemsInOrder(slug, def),
    readOrder: (slug) => fsStore.readOrder(slug),
    listCollectionSlugs: () => fsStore.listCollectionSlugs(),
  };
}

/**
 * Draft-first store: try GitHub, fall back to FS on the recoverable
 * error codes. Non-recoverable errors bubble.
 */
function draftReadStoreWithFallback(ctx: DraftStoreContext): ReadStore {
  async function wrap<T>(
    draftCall: () => Promise<T>,
    fsCall: () => Promise<T>,
  ): Promise<T> {
    try {
      return await draftCall();
    } catch (err) {
      if (isRecoverable(err)) {
        console.warn(
          `[read-store] Draft fetch failed (${err.code}); falling back to FS snapshot.`,
        );
        return fsCall();
      }
      throw err;
    }
  }

  return {
    mode: "draft+fs-fallback",
    readCollectionDef: (slug) =>
      wrap(
        () => draftStore.readCollectionDefFromDraft(ctx, slug),
        () => fsStore.readCollectionDef(slug),
      ),
    readItem: (slug, itemSlug, def) =>
      wrap(
        () => draftStore.readItemFromDraft(ctx, slug, itemSlug, def),
        () => fsStore.readItem(slug, itemSlug, def),
      ),
    readSingleton: (slug, def) =>
      wrap(
        () => draftStore.readSingletonFromDraft(ctx, slug, def),
        () => fsStore.readSingleton(slug, def),
      ),
    listItemSlugs: (slug) =>
      wrap(
        () => draftStore.listItemSlugsFromDraft(ctx, slug),
        () => fsStore.listItemSlugs(slug),
      ),
    listItemsInOrder: (slug, def) =>
      wrap(
        () => draftStore.listItemsInOrderFromDraft(ctx, slug, def),
        () => fsStore.listItemsInOrder(slug, def),
      ),
    readOrder: (slug) =>
      wrap(
        () => draftStore.readOrderFromDraft(ctx, slug),
        () => fsStore.readOrder(slug),
      ),
    listCollectionSlugs: () =>
      wrap(
        () => draftStore.listCollectionSlugsFromDraft(ctx),
        () => fsStore.listCollectionSlugs(),
      ),
  };
}
