/**
 * Pending-changes summary used by the admin chrome.
 *
 * Supersedes the earlier `draft-status` utility, which only returned
 * a boolean. The indicator wants a count ("3 unpublished changes");
 * the publish modal wants the per-item list. Both come from one
 * GitHub `compareCommitsWithBasehead` call so we pay for the diff
 * once.
 *
 * The compare API truncates `files` at 300 entries; this is the
 * documented behavior. Artist sites that exceed it between publishes
 * are an outlier — when that does come up we'll either show "300+"
 * or page through the files. The boolean / "anything pending?"
 * signal stays accurate either way because the array is non-empty
 * whenever there is anything pending (see ADR-010 deferred work).
 *
 * Image variants are collapsed before the list goes out — one
 * upload produces seven files (original + three widths × two
 * formats), and showing seven entries in the modal would mislead
 * the artist into thinking they made seven changes. The count
 * reflects the collapsed list so it stays consistent with the
 * modal.
 */

import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

import {
  DRAFT_BRANCH,
  fetchPublishToken,
  isPlatformConfigured,
  PublishError,
  readEnv,
  type Env,
} from "./publish";
import { ORDER_FILE_NAME, SINGLETON_ITEM_SLUG } from "./collections";

/**
 * Normalized per-file change shape. Discriminated by `kind` so the
 * modal can dispatch on category without re-parsing the path.
 *
 * `status` is mapped from GitHub's compare-file status values:
 *   - `added` / `removed` / `renamed` pass through verbatim.
 *   - `modified` / `changed` / `copied` collapse to `modified`.
 *   - `unchanged` is filtered out (compare doesn't return unchanged
 *     files in the diff, but we accept and drop defensively).
 */
export type DraftChangeStatus = "added" | "modified" | "removed" | "renamed";

export type DraftChange =
  | {
      kind: "item";
      status: DraftChangeStatus;
      collectionSlug: string;
      itemSlug: string;
      path: string;
      previousPath?: string;
      // Parsed-from-previousPath slug when GitHub flags this as a
      // rename AND the previous path matches the item-shape regex.
      // The modal renders "previousItemSlug → itemSlug" for renames.
      // Unset when previous path is missing or in a non-item shape
      // (cross-directory move, etc.).
      previousItemSlug?: string;
    }
  | {
      kind: "singleton";
      status: DraftChangeStatus;
      collectionSlug: string;
      path: string;
    }
  | {
      kind: "def";
      status: DraftChangeStatus;
      collectionSlug: string;
      path: string;
    }
  | {
      kind: "order";
      status: DraftChangeStatus;
      collectionSlug: string;
      path: string;
    }
  | {
      kind: "image";
      status: DraftChangeStatus;
      contentSlug: string;
      imageId: string;
      path: string;
    }
  | {
      kind: "other";
      status: DraftChangeStatus;
      path: string;
    };

/**
 * Cross-container draft summary.
 *
 * - `mode: "local"` — dev / unconfigured. There's no draft branch to
 *   diff against; `count` is always 0 and `changes` is empty.
 * - `mode: "github"` — production. `count` is the length of
 *   `changes` (image variants collapsed). A fresh site with no
 *   `draft` branch yet resolves to `count: 0`, `changes: []`.
 *
 * `truncated` flips to `true` when the compare API's file list hits
 * its hard cap (`COMPARE_FILES_PAGE_SIZE`, 300). The cap is documented
 * GitHub behaviour with no pagination on this endpoint; consumers
 * should render "300+" rather than "300" and surface the cap in the
 * Publish modal so the artist understands the diff preview is
 * incomplete. The actual publish commits the full draft tree
 * regardless — the cap only affects what we can show, not what we
 * push.
 */
export type DraftChanges = {
  count: number;
  changes: DraftChange[];
  mode: "local" | "github";
  truncated: boolean;
};

const ITEM_PATH = /^src\/content\/collections\/([^/]+)\/items\/([^/]+)\.json$/;
const DEF_PATH = /^src\/content\/collections\/([^/]+)\/_collection\.json$/;
const IMAGE_PATH = /^public\/images\/([^/]+)\/([^/]+)\//;

/**
 * GitHub's `compareCommitsWithBasehead` returns at most this many
 * file entries — documented + observed behaviour, no pagination
 * available on this endpoint. We treat any response whose
 * `files.length` hits this exactly as "truncated" defensively
 * (a real 300-change diff renders as "300+", a 301-change diff
 * renders as "300+"; we can't tell them apart from a single
 * compare call).
 */
const COMPARE_FILES_PAGE_SIZE = 300;

function normalizeStatus(s: string): DraftChangeStatus | null {
  if (s === "added") return "added";
  if (s === "removed") return "removed";
  if (s === "renamed") return "renamed";
  if (s === "unchanged") return null;
  // "modified", "changed", "copied" — collapse to modified so the
  // UI doesn't surface GitHub's distinction between "changed" (file
  // mode changed) and "modified" (contents changed).
  return "modified";
}

function parseChange(file: {
  filename: string;
  status: string;
  previous_filename?: string;
}): DraftChange | null {
  const status = normalizeStatus(file.status);
  if (status === null) return null;
  const path = file.filename;

  const itemMatch = path.match(ITEM_PATH);
  if (itemMatch) {
    const [, collectionSlug, slug] = itemMatch;
    if (slug === SINGLETON_ITEM_SLUG) {
      return { kind: "singleton", status, collectionSlug, path };
    }
    if (slug === ORDER_FILE_NAME) {
      return { kind: "order", status, collectionSlug, path };
    }
    const out: Extract<DraftChange, { kind: "item" }> = {
      kind: "item",
      status,
      collectionSlug,
      itemSlug: slug,
      path,
    };
    if (file.previous_filename) {
      out.previousPath = file.previous_filename;
      // Best-effort parse so the modal can render the source slug
      // for renames. Non-item-shaped previous paths (cross-directory
      // moves, etc.) flow through as `previousPath` only.
      const prevItemMatch = file.previous_filename.match(ITEM_PATH);
      if (prevItemMatch) {
        const [, , prevSlug] = prevItemMatch;
        if (prevSlug !== SINGLETON_ITEM_SLUG && prevSlug !== ORDER_FILE_NAME) {
          out.previousItemSlug = prevSlug;
        }
      }
    }
    return out;
  }

  const defMatch = path.match(DEF_PATH);
  if (defMatch) {
    return { kind: "def", status, collectionSlug: defMatch[1], path };
  }

  const imageMatch = path.match(IMAGE_PATH);
  if (imageMatch) {
    return {
      kind: "image",
      status,
      contentSlug: imageMatch[1],
      imageId: imageMatch[2],
      path,
    };
  }

  return { kind: "other", status, path };
}

/**
 * Parse the compare API's file list into typed changes, collapsing
 * image variants so one upload counts as one change. Exported for
 * tests; the route handler only consumes the full `getDraftChanges`.
 */
export function parseChanges(
  files: Array<{ filename: string; status: string; previous_filename?: string }>,
): DraftChange[] {
  const out: DraftChange[] = [];
  const seenImages = new Set<string>();
  for (const file of files) {
    const parsed = parseChange(file);
    if (!parsed) continue;
    if (parsed.kind === "image") {
      const key = `${parsed.contentSlug}/${parsed.imageId}`;
      if (seenImages.has(key)) continue;
      seenImages.add(key);
    }
    out.push(parsed);
  }
  return out;
}

/**
 * Errors `getDraftChanges` can throw. Same code set as the prior
 * `DraftStatusError`, plus we re-use the broker error mapping so
 * admin code that switches over this matches the publish-error
 * pattern.
 *
 * - `broker-unreachable`: network blip at token-mint time.
 *   Recoverable next request.
 * - `broker-rejected`: per-site secret bad / siteId unknown.
 *   Permanent config error; surface it.
 * - `github-failed`: a non-404 error talking to GitHub. Bug or
 *   transient outage.
 */
export class DraftChangesError extends Error {
  constructor(
    public code: "broker-unreachable" | "broker-rejected" | "github-failed",
    message: string,
  ) {
    super(message);
    this.name = "DraftChangesError";
  }
}

/**
 * Pull the most-useful one-liner out of an unknown thrown value
 * without baking the Error's name into the message (which
 * `String(cause)` would do: `"RequestError: Not Found"` rather
 * than just `"Not Found"`). The route handler hides these from
 * the indicator, so the noise only ever lands in dev logs — but
 * a clean log is cheap and helps the next person debugging a
 * `github-failed` 5xx.
 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function getDraftChanges(env: Env = readEnv()): Promise<DraftChanges> {
  if (!isPlatformConfigured(env)) {
    return { count: 0, changes: [], mode: "local", truncated: false };
  }

  let token: string;
  let owner: string;
  let repo: string;
  try {
    ({ token, owner, repo } = await fetchPublishToken(env));
  } catch (cause) {
    if (cause instanceof PublishError) {
      if (cause.code === "broker-unreachable" || cause.code === "broker-rejected") {
        throw new DraftChangesError(cause.code, cause.message);
      }
    }
    throw new DraftChangesError("github-failed", errorMessage(cause));
  }

  const octokit = new Octokit({ auth: token });

  try {
    const compare = await octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${env.branch}...${DRAFT_BRANCH}`,
    });
    const files = compare.data.files ?? [];
    const changes = parseChanges(files);
    return {
      count: changes.length,
      changes,
      mode: "github",
      truncated: files.length >= COMPARE_FILES_PAGE_SIZE,
    };
  } catch (cause) {
    // Fresh site: no `draft` branch yet → compare 404s on the head.
    // Saving the first item is what creates the branch; until then
    // there's nothing to publish.
    if (cause instanceof RequestError && cause.status === 404) {
      return { count: 0, changes: [], mode: "github", truncated: false };
    }
    throw new DraftChangesError(
      "github-failed",
      `compare ${env.branch}...${DRAFT_BRANCH}: ${errorMessage(cause)}`,
    );
  }
}
