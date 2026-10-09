/**
 * One save path for every admin content write (issue #345).
 *
 * Admin save routes used to write the change to
 * `process.cwd()/src/content` first and then commit it to the draft
 * branch, returning `ok: true` + `publishWarning` when the commit
 * failed. On a serverless host that directory is read-only or thrown
 * away with the instance, so the "saved locally" copy was a lie: the
 * artist's change existed nowhere.
 *
 * The contract now:
 *
 *   - **Platform configured (production)** — the change is built and
 *     validated in memory and committed to the editor's draft branch.
 *     Nothing touches local disk. A failed commit is a failed save:
 *     the route answers with `saveFailureResponse` (502, or 409 for a
 *     concurrent edit), never `ok: true`.
 *   - **Platform not configured (dev)** — local disk *is* the content
 *     store, so the route's `writeLocal` runs before the (local-mode)
 *     publish call.
 *
 * "Platform configured" is `isPlatformConfigured()` from `./publish`:
 * both `STAGECRAFT_SITE_ID` and `STAGECRAFT_BROKER_SECRET` are set, which
 * is what lets the site mint a GitHub token from the platform broker.
 */

import { NextResponse } from "next/server";

import {
  prepareItemFileWrite,
  type CollectionDef,
  type Item,
  type ReadStore,
} from "./collections";
import { writeJsonAtomic } from "./fs-helpers";
import {
  isPlatformConfigured,
  publish,
  PublishError,
  readEnv,
  saveToDraft,
  type Env,
  type PublishArgs,
  type PublishResult,
  type PublishTarget,
} from "./publish";

export type SaveContentArgs = PublishArgs & {
  /**
   * Dev-only: apply the change to local disk. Never called when the
   * platform is configured — production content lives on the draft
   * branch, not on the server's filesystem.
   */
  writeLocal: () => Promise<void>;
  /**
   * `"draft"` (default) commits to the editor's draft branch only;
   * `"main"` also publishes the draft to `main` in the same call (the
   * welcome wizard's one-shot onboarding commit).
   */
  publishTo?: "draft" | "main";
};

/**
 * Persist one admin save. Writes locally only in dev; in production
 * commits the in-memory targets and lets any `PublishError` propagate
 * so the route can turn it into a failure response.
 */
export async function saveContent(
  args: SaveContentArgs,
  env: Env = readEnv(),
): Promise<PublishResult> {
  const { writeLocal, publishTo = "draft", ...publishArgs } = args;
  if (!isPlatformConfigured(env)) {
    await writeLocal();
  }
  return publishTo === "main" ? publish(publishArgs) : saveToDraft(publishArgs);
}

/**
 * HTTP status for a save whose commit failed. A stale-ref race is
 * recoverable client-side (reload + retry) so it's a 409; anything
 * else means the upstream (broker / GitHub) didn't take the change,
 * which is a 502.
 */
export function saveFailureStatus(code: PublishError["code"]): 409 | 502 {
  return code === "concurrent-edit" ? 409 : 502;
}

/**
 * The response every save route returns when the commit fails. Shares
 * the `{ ok: false, code, error }` envelope with `/api/publish-draft`
 * so the admin clients' existing `ok: false` handling shows `error`.
 */
export function saveFailureResponse(cause: PublishError): NextResponse {
  return NextResponse.json(
    { ok: false, code: cause.code, error: `Save failed: ${cause.message}` },
    { status: saveFailureStatus(cause.code) },
  );
}

export type PlannedItemWrite = {
  /** The canonical item — exactly what lands on disk / in the commit. */
  item: Item;
  /** `collection-item` target for the commit. */
  target: PublishTarget;
  /** Dev-only local write of the same bytes. Pass to `saveContent`. */
  writeLocal: () => Promise<void>;
};

/**
 * Build + validate one item file in memory. Runs the item through the
 * collection's full per-field schema (the same `prepareItemFileWrite`
 * the store uses) and pins `updatedAt` so the response, the commit and
 * the dev-mode disk write all carry identical bytes — no post-write
 * re-read from disk needed.
 *
 * Throws (ZodError) when the item doesn't satisfy `def` — callers that
 * accept artist input validate first and surface a 400; a throw here
 * means server-built data is wrong.
 */
export function planItemWrite(
  collectionSlug: string,
  itemSlug: string,
  item: Item,
  def: CollectionDef,
  updatedAt: string = item.updatedAt,
): PlannedItemWrite {
  const { file, value } = prepareItemFileWrite(collectionSlug, itemSlug, item, def, updatedAt);
  return {
    item: { ...value, slug: itemSlug },
    target: { kind: "collection-item", collectionSlug, itemSlug, data: value },
    writeLocal: () => writeJsonAtomic(file, value),
  };
}

/**
 * Save a page from the Puck editor's `onPublish` handler: build the
 * pages item in memory (preserving id / createdAt / showInNav from the
 * draft-aware `store`), then save it through `saveContent`. A
 * `PublishError` propagates — `/api/publish` maps it to a failure
 * response; there is no "saved locally" fallback.
 */
export async function publishPage(args: {
  pageSlug: string;
  /** Legacy PuckData shape: `{ content, root: { props: {...} } }`. */
  data: unknown;
  authorEmail: string;
  authorName?: string;
  /** Draft-aware store used to look up the existing item's identity. */
  store: ReadStore;
}): Promise<PublishResult> {
  const { buildPageItem } = await import("./content");
  const { pagesCollectionDef } = await import("./collections/seeds");
  const page = await buildPageItem(
    args.pageSlug,
    args.data as Parameters<typeof buildPageItem>[1],
    args.store,
  );
  const planned = planItemWrite("pages", args.pageSlug, page, pagesCollectionDef);
  return saveContent({
    targets: [planned.target],
    writeLocal: planned.writeLocal,
    authorEmail: args.authorEmail,
    authorName: args.authorName,
    commitSubject: `Update ${args.pageSlug}`,
  });
}
