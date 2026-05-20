import { randomUUID } from "node:crypto";

import {
  collectionDefRepoPath,
  collectionDefSchema,
  itemFileShellSchema,
  itemRepoPath,
  itemSlugSchema,
  orderFileSchema,
  orderRepoPath,
  slugSchema,
  type CollectionDef,
} from "./collections";
import {
  localPathForRepoPath,
  stringifyContent,
  unlinkIfExists,
  writeText,
} from "./fs-helpers";
import {
  commitFiles,
  ensureBranchExists,
  squashBranchInto,
  type FileToCommit,
} from "./git-commit";
import { publishTokenResponseSchema } from "./publish-types";

/**
 * Persistent companion branch for ADR-010's two-branch publish model.
 * Always at or ahead of `main`; admin commits land here; the squash
 * step on Publish merges it into `main` and FF's it back to match.
 */
export const DRAFT_BRANCH = "draft";

export class PublishError extends Error {
  constructor(
    public code:
      | "broker-unreachable"
      | "broker-rejected"
      | "github-failed"
      | "no-platform-configured",
    message: string,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

/**
 * Targets the publish flow can write. Each target maps to a known
 * repo path under `src/content/collections/<slug>/...`. Item payloads
 * are validated against the collection's dynamic schema at the API-
 * route level (which has the CollectionDef in hand); this layer only
 * enforces the structural shell (`{ id, createdAt, updatedAt, values }`)
 * so an obviously malformed payload fails before commit.
 *
 * The legacy `page` / `site-config` / `header-config` / `appearance` /
 * `delete-page` kinds were removed in ADR-009 PR 3 — every editable
 * surface is now a collection, and `content.ts` translates the legacy
 * API into `collection-item` writes.
 */
export type PublishTarget =
  | { kind: "collection-def"; collectionSlug: string; data: CollectionDef }
  | {
      kind: "collection-item";
      collectionSlug: string;
      itemSlug: string;
      /** Pre-validated against the collection's schema by the caller. */
      data: unknown;
    }
  | { kind: "delete-collection-item"; collectionSlug: string; itemSlug: string }
  | { kind: "collection-order"; collectionSlug: string; data: string[] };

export type PublishArgs = {
  targets: PublishTarget[];
  authorEmail: string;
  authorName?: string;
  /** Human-readable subject for the commit. Defaults to a generated summary. */
  commitSubject?: string;
};

export type PublishResult = {
  /** SHA of the commit on the artist's repo, or null when in dev fallback mode. */
  commitSha: string | null;
  /** Whether this publish went through GitHub or the local-disk dev fallback. */
  mode: "github" | "local";
};

const STAGECRAFT_PLATFORM_URL_DEFAULT = "https://stagecraft.website";

export type Env = {
  platformUrl: string;
  siteId: string | undefined;
  brokerSecret: string | undefined;
  branch: string;
};

export function readEnv(): Env {
  const overridden = process.env.STAGECRAFT_PLATFORM_URL?.replace(/\/$/, "");
  return {
    platformUrl:
      overridden && overridden.length > 0
        ? overridden
        : STAGECRAFT_PLATFORM_URL_DEFAULT,
    siteId: process.env.STAGECRAFT_SITE_ID,
    brokerSecret: process.env.STAGECRAFT_BROKER_SECRET,
    branch: process.env.SITE_GIT_BRANCH ?? "main",
  };
}

export function isPlatformConfigured(env: Env = readEnv()): boolean {
  return Boolean(env.siteId && env.brokerSecret);
}

export async function fetchPublishToken(env: Env): Promise<{
  token: string;
  owner: string;
  repo: string;
}> {
  let response: Response;
  try {
    response = await fetch(`${env.platformUrl}/api/publish-token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.brokerSecret}`,
      },
      body: JSON.stringify({ siteId: env.siteId }),
    });
  } catch (cause) {
    throw new PublishError(
      "broker-unreachable",
      `Could not reach token broker: ${String(cause)}`,
    );
  }

  if (!response.ok) {
    throw new PublishError(
      "broker-rejected",
      `Token broker returned ${response.status} ${response.statusText}`,
    );
  }

  const parsed = publishTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new PublishError(
      "broker-rejected",
      `Token broker returned malformed response: ${parsed.error.message}`,
    );
  }
  return {
    token: parsed.data.token,
    owner: parsed.data.repo.owner,
    repo: parsed.data.repo.name,
  };
}

/**
 * Validate + normalise every target into a {repoPath, content} pair we can
 * hand to the commit flow. Each target's schema is parsed here so a bad
 * payload from the API fails before the GitHub call.
 *
 * Returns `delete-page` slugs separately because git-commit's `commitFiles`
 * only adds files; deletions need a different tree entry.
 */
function planFiles(targets: PublishTarget[]): {
  writes: FileToCommit[];
  deletePaths: string[];
} {
  const writes: FileToCommit[] = [];
  const deletePaths: string[] = [];

  for (const target of targets) {
    switch (target.kind) {
      case "collection-def": {
        const collectionSlug = slugSchema.parse(target.collectionSlug);
        const parsed = collectionDefSchema.parse(target.data);
        if (parsed.slug !== collectionSlug) {
          throw new Error(
            `collection-def: def.slug (${parsed.slug}) must match collectionSlug (${collectionSlug})`,
          );
        }
        writes.push({
          path: collectionDefRepoPath(collectionSlug),
          content: stringifyContent(parsed),
        });
        break;
      }
      case "collection-item": {
        const collectionSlug = slugSchema.parse(target.collectionSlug);
        const itemSlug = itemSlugSchema.parse(target.itemSlug);
        // Per-field validation (maxLength, options, etc.) requires the
        // CollectionDef and happens at the API-route level. Here we
        // enforce the structural shell — `{ id, values }` — so a
        // malformed payload (missing id, wrong wrapper, an entire
        // CollectionDef pasted by mistake) fails before commit rather
        // than at the next read.
        const shellChecked = itemFileShellSchema.parse(target.data);
        writes.push({
          path: itemRepoPath(collectionSlug, itemSlug),
          content: stringifyContent(shellChecked),
        });
        break;
      }
      case "delete-collection-item": {
        const collectionSlug = slugSchema.parse(target.collectionSlug);
        const itemSlug = itemSlugSchema.parse(target.itemSlug);
        deletePaths.push(itemRepoPath(collectionSlug, itemSlug));
        break;
      }
      case "collection-order": {
        const collectionSlug = slugSchema.parse(target.collectionSlug);
        const parsed = orderFileSchema.parse(target.data);
        writes.push({
          path: orderRepoPath(collectionSlug),
          content: stringifyContent(parsed),
        });
        break;
      }
    }
  }

  return { writes, deletePaths };
}

function summariseTargets(targets: PublishTarget[]): string {
  // Stable order so re-runs produce the same commit subject.
  const parts: string[] = [];
  const collectionDefs = targets
    .filter((t): t is Extract<PublishTarget, { kind: "collection-def" }> => t.kind === "collection-def")
    .map((t) => t.collectionSlug);
  if (collectionDefs.length) parts.push(`collection defs: ${collectionDefs.join(", ")}`);
  const collectionItems = targets
    .filter((t): t is Extract<PublishTarget, { kind: "collection-item" }> => t.kind === "collection-item")
    .map((t) => `${t.collectionSlug}/${t.itemSlug}`);
  if (collectionItems.length) parts.push(`items: ${collectionItems.join(", ")}`);
  const orders = targets
    .filter((t): t is Extract<PublishTarget, { kind: "collection-order" }> => t.kind === "collection-order")
    .map((t) => t.collectionSlug);
  if (orders.length) parts.push(`order: ${orders.join(", ")}`);
  const itemDeletes = targets
    .filter((t): t is Extract<PublishTarget, { kind: "delete-collection-item" }> => t.kind === "delete-collection-item")
    .map((t) => `${t.collectionSlug}/${t.itemSlug}`);
  if (itemDeletes.length) parts.push(`delete items: ${itemDeletes.join(", ")}`);
  return parts.length ? `Update ${parts.join(" + ")}` : "Update content";
}

async function writeLocal(targets: PublishTarget[]): Promise<PublishResult> {
  const { writes, deletePaths } = planFiles(targets);
  await Promise.all(
    writes.map((file) => writeText(localPathForRepoPath(file.path), file.content)),
  );
  await Promise.all(deletePaths.map((p) => unlinkIfExists(localPathForRepoPath(p))));
  return { commitSha: null, mode: "local" };
}

export async function publish(args: PublishArgs): Promise<PublishResult> {
  if (args.targets.length === 0) {
    throw new PublishError("github-failed", "publish: no targets supplied");
  }
  const env = readEnv();
  if (!isPlatformConfigured(env)) {
    return writeLocal(args.targets);
  }

  const { writes, deletePaths } = planFiles(args.targets);
  const { token, owner, repo } = await fetchPublishToken(env);
  const publishId = randomUUID();
  const subject = args.commitSubject ?? summariseTargets(args.targets);
  const message = `${subject}\n\nStagecraft-Publish-Id: ${publishId}`;
  const author = { name: args.authorName ?? "Artist", email: args.authorEmail };

  // `commitThroughDraft` already wraps each step in a labelled
  // PublishError; don't double-wrap or the step name gets lost.
  const commitSha = await commitThroughDraft({
    token,
    owner,
    repo,
    mainBranch: env.branch,
    message,
    files: writes,
    deletePaths,
    author,
  });

  return { commitSha, mode: "github" };
}

export type CommitThroughDraftArgs = {
  token: string;
  owner: string;
  repo: string;
  /** The published branch — typically `main`. From the env config. */
  mainBranch: string;
  /** Commit message subject + optional body. `[skip ci]` is appended internally. */
  message: string;
  files: FileToCommit[];
  deletePaths?: string[];
  author: { name: string; email: string };
};

/**
 * Commit a set of file changes through the draft branch and squash
 * up to main in one round-trip (ADR-010's "Save + immediate Publish"
 * intermediate behaviour during PR 1 of the rollout).
 *
 * Flow:
 *   1. Ensure `draft` exists (no-op after first call per artist).
 *   2. Commit the changes to `draft` with `[skip ci]` so the host
 *      doesn't run a production build for this commit.
 *   3. Squash `draft` into `main` — a single commit on main whose
 *      tree comes from draft's HEAD. Triggers the deploy.
 *
 * Returns the SHA of the squash commit on `main` — that's the one
 * that triggers the deploy, and the SHA callers / deploy-status
 * pollers care about. The per-save commit on draft becomes
 * unreachable as soon as draft FF's to main, which is fine for the
 * transitional behaviour: PR 2 of the rollout flips the wiring so
 * `commitToDraft` is called without `squashBranchInto`, and the
 * per-save draft commits accumulate until an explicit Publish.
 */
export async function commitThroughDraft(
  args: CommitThroughDraftArgs,
): Promise<string> {
  const { token, owner, repo, mainBranch, message, files, deletePaths, author } = args;
  // Wrap each step with a step label so a failure tells you whether
  // ensure / commit / squash blew up. This becomes load-bearing in
  // PR 2 of ADR-010, where retry behavior depends on knowing which
  // step failed (squash failure with draft already at the new SHA
  // can be retried as just the squash; commit failure can't).
  try {
    await ensureBranchExists({
      token,
      owner,
      repo,
      branch: DRAFT_BRANCH,
      fromBranch: mainBranch,
    });
  } catch (cause) {
    throw new PublishError("github-failed", `ensure draft branch: ${String(cause)}`);
  }
  try {
    await commitFiles({
      token,
      owner,
      repo,
      branch: DRAFT_BRANCH,
      message: `${message}\n\n[skip ci]`,
      files,
      deletePaths,
      author,
    });
  } catch (cause) {
    throw new PublishError("github-failed", `commit to draft: ${String(cause)}`);
  }
  let squash: { commitSha: string; alreadyInSync: boolean };
  try {
    squash = await squashBranchInto({
      token,
      owner,
      repo,
      fromBranch: DRAFT_BRANCH,
      toBranch: mainBranch,
      message,
      author,
    });
  } catch (cause) {
    throw new PublishError("github-failed", `squash draft → main: ${String(cause)}`);
  }
  return squash.commitSha;
}

/**
 * Convenience for the Puck editor's onPublish handler: write a page
 * locally via the wrapper layer (so the editor sees fresh values on
 * the next read) and then push a `collection-item` commit through the
 * broker / GitHub. Local writes happen before the commit so a publish
 * failure leaves the artist with a saved-but-undeployed page rather
 * than nothing.
 *
 * Splitting "local write" from "commit" matches the existing
 * `/api/publish` semantics: a `publishWarning` in the response means
 * the local write succeeded but the commit didn't.
 */
export async function publishPage(args: {
  pageSlug: string;
  /** Legacy PuckData shape: `{ content, root: { props: {...} } }`. */
  data: unknown;
  authorEmail: string;
  authorName?: string;
}): Promise<PublishResult> {
  const { writePage, readPage } = await import("./content");
  await writePage(args.pageSlug, args.data as Parameters<typeof writePage>[1]);
  // Read back to capture the canonical id + createdAt + updatedAt
  // that `writePage` either preserved or generated, so the published
  // commit reflects the on-disk state exactly.
  const fresh = await readPage(args.pageSlug);
  const { readItem } = await import("./collections");
  const { pagesCollectionDef } = await import("./collections/seeds");
  const item = await readItem("pages", args.pageSlug, pagesCollectionDef);
  if (!item) {
    throw new PublishError("github-failed", `Page ${args.pageSlug} disappeared after write`);
  }
  return publish({
    targets: [
      {
        kind: "collection-item",
        collectionSlug: "pages",
        itemSlug: args.pageSlug,
        data: { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, values: item.values },
      },
    ],
    authorEmail: args.authorEmail,
    authorName: args.authorName,
    commitSubject: `Update ${args.pageSlug}`,
  });
  // `fresh` is fetched to assert the round-trip but isn't returned
  // — callers re-read via the wrapper layer if they need the data.
  void fresh;
}
